// ThumbnailLifecycleManager — Milestone C3: the autonomous thumbnail refresh loop.
//
// Closes the feedback cycle publish → measure → learn → improve:
//
//   Published video
//        │
//        ▼
//   AnalyticsCollector (CTR, impressions, retention, watch time)
//        │
//        ▼
//   Refresh Decision Engine  (adaptive policy, anti-churn gating)
//        │  refresh?  ──no──►  done (record observation)
//        ▼ yes
//   Candidate generation (cover A–E variants via CoverGenerator)
//        │
//        ▼
//   Rank candidates (validator CTR + learned style order)
//        │
//        ▼
//   Replace thumbnail on YouTube (setThumbnail)
//        │
//        ▼
//   Record learning (thumbnail_versions row + brand pattern memory)
//
// Everything is best-effort: missing credentials, unpublished videos, or API
// errors return a decision (or no-op) instead of throwing. `dryRun` mode is
// the audit pass — it reports what WOULD change without touching YouTube.
//
// No duplicated logic: metrics come from AnalyticsCollector, learning lives in
// ImagePerformanceMemory / ThumbnailIntelligence / BrandPerformanceMemory,
// candidate art comes from CoverGenerator, replacement from the YouTube
// publisher.

import path from 'node:path'
import { AnalyticsCollector } from '../analytics/AnalyticsCollector.mjs'
import { ImagePerformanceMemory } from '../analytics/ImagePerformanceMemory.mjs'
import { ThumbnailIntelligence } from '../analytics/ThumbnailIntelligence.mjs'
import { BrandPerformanceMemory } from '../pipeline/BrandPerformanceMemory.mjs'
import { PublishEventsStore } from '../publishing/PublishEventsStore.mjs'

export const REFRESH_POLICY = {
  // Adaptive gate (not a flat 4%): only act when the story measurably
  // underperforms its category, has real impressions, is old enough to trust,
  // and hasn't churned recently.
  ctrGapPp: 1.5,          // refresh if CTR < categoryAvg - 1.5pp
  minImpressions: 1000,   // enough eyeballs to trust the signal
  minAgeHours: 24,        // don't touch new videos mid-bump
  minHoursSinceRefresh: 48, // anti-churn: one experiment per 2 days
}

// Thumbnail variant families produced for one refresh round.
export const VARIANT_FAMILIES = [
  { key: 'A', label: 'face', style: 'reaction' },
  { key: 'B', label: 'object', style: 'cinematic' },
  { key: 'C', label: 'headline', style: 'minimal' },
  { key: 'D', label: 'emotion', style: 'breaking' },
  { key: 'E', label: 'breaking', style: 'data' },
]

export class ThumbnailLifecycleManager {
  constructor(options = {}) {
    this.memory = options.memory || new ImagePerformanceMemory()
    this.collector = options.collector || new AnalyticsCollector()
    this.intel = options.intelligence || options.intel || new ThumbnailIntelligence({ memory: this.memory })
    this.brandMemory = options.brandMemory || new BrandPerformanceMemory()
    this.events = options.events || new PublishEventsStore()
    this.generator = options.generator || null // CoverGenerator
    this.publisher = options.publisher || null // { setThumbnail(token, videoId, coverPath) }
    this.policy = { ...REFRESH_POLICY, ...(options.policy || {}) }
    this.now = options.now || (() => Date.now())
    this.dryRun = options.dryRun ?? false
  }

  close() { this.memory.close() }

  // ------------------------------------------------------------------
  // Decision: should this video's thumbnail be refreshed?
  // ------------------------------------------------------------------

  /**
   * Adaptive refresh decision for one published video.
   * @param {object} ev   publish event { videoId, title, category, publishedAt }
   * @param {object|null} metrics  AnalyticsCollector output
   * @returns {{refresh: boolean, reason: string, policy: object}}
   */
  evaluate(ev, metrics) {
    const base = { decision: false, reason: '', policy: { ...this.policy } }
    if (!ev?.videoId) return { ...base, reason: 'no videoId' }
    if (!metrics || metrics.ctr == null) return { ...base, reason: 'no analytics yet (ctr null)' }

    const impressions = metrics.impressions ?? 0
    if (impressions < this.policy.minImpressions) return { ...base, reason: `impressions ${impressions} < ${this.policy.minImpressions}` }

    // Age gate — publishedAt may be the event's local stamp or analytics snapshot.
    const publishedAt = metrics.publishedAt || ev.publishedAt
    const ageH = publishedAt ? (this.now() - new Date(publishedAt).getTime()) / 3600000 : null
    if (ageH == null || ageH < this.policy.minAgeHours) {
      return { ...base, reason: ageH == null ? 'no publishedAt' : `age ${ageH.toFixed(1)}h < ${this.policy.minAgeHours}h` }
    }

    // Anti-churn: no refresh in the last minHoursSinceRefresh hours.
    const last = this.lastRefresh(ev.videoId, 'attempted')
    if (last && (this.now() - new Date(String(last)).getTime()) / 3600000 < this.policy.minHoursSinceRefresh) {
      return { ...base, reason: `refreshed ${hoursAgo(this.now(), last)}h ago (cooldown ${this.policy.minHoursSinceRefresh}h)` }
    }

    const catAvg = this.categoryAvgCtr(ev.category)
    const gap = catAvg == null ? this.policy.ctrGapPp : metrics.ctr - catAvg
    if (catAvg != null && gap >= -this.policy.ctrGapPp) {
      return { ...base, reason: `ctr ${metrics.ctr} ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}pp vs category avg ${catAvg} (ok)` }
    }

    return {
      category: ev.category || null,
      ctr: metrics.ctr,
      ctrGap: catAvg == null ? null : +gap.toFixed(2),
      categoryAvg: catAvg,
      impressions,
      decision: true,
      reason: catAvg == null
        ? `ctr ${metrics.ctr}% (no category baseline yet)`
        : `ctr ${metrics.ctr}% is ${gap.toFixed(2)}pp below category avg ${catAvg}%`,
    }
  }

  /** Category-average CTR across learned videos (or null on cold start). */
  categoryAvgCtr(category) {
    const rows = this.memory.db.db
      .prepare(`SELECT category, AVG(ctr) AS avg, COUNT(*) AS n FROM video_performance WHERE ctr IS NOT NULL GROUP BY category`)
      .all()
    if (!rows.length) return null
    const match = category ? rows.find(r => r.category === category) : null
    return match ? +match.avg.toFixed(2) : +rows.reduce((s, r) => s + r.avg, 0) / rows.length
  }

  /** Last refresh attempt timestamp for a video (any status). */
  lastRefresh(videoId, status = null) {
    const row = status
      ? this.memory.db.db.prepare(`SELECT MAX(attempted_at) AS t FROM thumbnail_versions WHERE video_id = ? AND status = ?`).get(videoId, status)
      : this.memory.db.db.prepare(`SELECT MAX(attempted_at) AS t FROM thumbnail_versions WHERE video_id = ?`).get(videoId)
    return row?.t ?? null
  }

  // ------------------------------------------------------------------
  // Monitor loop — evaluate every published video
  // ------------------------------------------------------------------

  /**
   * Run the full monitor pass. Collects fresh analytics for each published
   * video and returns the evaluation report. Does NOT mutate YouTube;
   * `runRefreshPipeline` is the mutation path (skipped when dryRun).
   *
   * @returns {Promise<{ evaluated: array, candidates: array }>}
   */
  async monitor() {
    const evaluated = []
    const refreshQueue = []
    for (const ev of this.events.recent(500)) {
      if (!ev.videoId) continue
      const metrics = await this.collector.collectFull(ev.videoId)
      const verdict = this.evaluate(ev, metrics)
      evaluated.push({ videoId: ev.videoId, ...verdict })
      if (verdict.decision) refreshQueue.push({ ev, metrics, verdict })
    }
    return { evaluated, refreshQueue }
  }

  // ------------------------------------------------------------------
  // Candidate generation + ranking
  // ------------------------------------------------------------------

  /** Generate A–E variants and select the best by validator CTR + learned order. */
  async generateCandidates(event, outDir) {
    if (!this.generator) return { candidates: [], winner: null }
    const article = event.article || { title: event.title, category: event.category }
    // Returns { winner, winnerCtr, variants: [{style, ctr, ok, path}], path }
    const result = await this.generator.generateTournament(article, outDir, {
      styles: VARIANT_FAMILIES.map(v => v.style),
    })
    const candidates = (result.variants || [])
      .map(v => ({ ...v, family: VARIANT_FAMILIES.find(f => f.style === v.style)?.key || v.style }))
      .filter(v => v.ok)
    return { candidates, winner: result.winner, path: result.path }
  }

  /**
   * Rank candidates by predicted CTR, applying the learned style order as a
   * tie-break so a proven family wins over an equal raw prediction.
   */
  rankCandidates(candidates) {
    const order = this.intel?.styleOrder([]) || []
    const rank = new Map(order.map((s, i) => [s, i]))
    return [...candidates].sort((a, b) => {
      if (a.ctr !== b.ctr) return (b.ctr ?? 0) - (a.ctr ?? 0)
      const ka = rank.get(a.style) ?? 9
      const kb = rank.get(b.style) ?? 9
      return ka - kb
    })
  }

  // ------------------------------------------------------------------
  // Execution
  // ------------------------------------------------------------------

  /**
   * The full loop for one video: generate C beta variants, pick the ranked
   * winner, replace the live thumbnail when not dryRun, and record the
   * version + learning row.
   */
  async run(event) {
    const metrics = await this.collector.collectFull(event.videoId)
    const verdict = this.evaluate(event, metrics)
    if (!verdict.decision) return { videoId: event.videoId, verdict }

    const outDir = event.outDir || path.join(process.cwd(), 'output', 'refresh', event.videoId)
    const fileFs = await import('node:fs')
    fileFs.mkdirSync(outDir, { recursive: true })

    // Old + new hash: identity of the pre/post thumbnail.
    const oldCover = event.coverPath
    const oldHash = oldCover && fileFs.existsSync(oldCover)
      ? this.intel.fileHash(oldCover)
      : null

    let generated = { candidates: [], winner: null, path: null }
    if (this.generator) generated = await this.generateCandidates(event, outDir)
    const winner = this.rankCandidates(generated.candidates)[0] || null

    // Record the attempt + outcome.
    const replaced = !this.dryRun && winner && this.publisher ? await this._replace(event, winner) : this.dryRun
    const newHash = winner?.path && fileFs.existsSync(winner.path) ? this.intel.fileHash(winner.path) : null
    this.recordVersion(event, verdict, { style: winner?.style || null, path: winner?.path || generated.path || null, oldHash, newHash, replaced })

    return { videoId: event.videoId, verdict, winner: winner?.style || null, replaced, candidates: generated.candidates }
  }

  /** Upload the new thumbnail via the YouTube publisher (best-effort). */
  async _replace(event, candidate) {
    if (!this.publisher || !candidate?.path) return false
    try {
      const token = this.publisher.getAccessToken ? await this.publisher.getAccessToken() : null
      const set = this.publisher.setThumbnail || (async () => false)
      await set(token, event.videoId, candidate.path)
      return true
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------------
  // Learning
  // ------------------------------------------------------------------

  /** Persist the refresh experiment to thumbnail_versions. */
  recordVersion(event, verdict, { style, path, oldHash, newHash, replaced, result = null } = {}) {
    const row = {
      video_id: event.videoId,
      old_hash: oldHash || null,
      new_hash: newHash || null,
      style: style || null,
      category: event.category || null,
      entity: event.entity || event.category || null,
      headline_style: event.title ? patternKeyFallback(event.title) : null,
      ctr_before: verdict.ctr ?? null,
      ctr_after: null, // filled on the next collect pass (post-replacement)
      impressions: verdict.impressions ?? 0,
      refresh_policy: JSON.stringify(verdict.policy || this.policy),
      status: this.dryRun ? 'planned' : replaced ? 'replaced' : 'skipped',
      replaced: this.dryRun ? 0 : replaced ? 1 : 0,
      result: result || null,
    }
    this.memory.db.db.prepare(`
      INSERT INTO thumbnail_versions
        (video_id, old_hash, new_hash, style, category, entity, headline_style,
         ctr_before, ctr_after, impressions, refresh_policy, status, replaced, result)
      VALUES (@video_id, @old_hash, @new_hash, @style, @category, @entity, @headline_style,
         @ctr_before, @ctr_after, @impressions, @refresh_policy, @status, @replaced, @result)
    `).run(row)
    // Brand memory: learn the pattern so future packaging avoids repeat losers.
    if (this.brandMemory && verdict?.ctr != null && event.title) {
      this.brandMemory.recordPattern(patternKeyFallback(event.title), {
        category: event.category,
        avgCTR: verdict.ctr,
        impact: Math.round((verdict.ctr - 4.5) * 10),
        signals: {
          ctr: verdict.ctr,
          impressions: verdict.impressions,
          completion: verdict.retention ?? null,
        },
        source: 'lifecycle_refresh',
      })
    }
    return row
  }
}

// Local fallback so the manager does not import the optimizer just for a key.
function patternKeyFallback(text) {
  return (text || '').toUpperCase().split(' ').filter(w => w.length > 3).slice(0, 3).join('_')
}

function hoursAgo(nowMs, iso) {
  return ((nowMs - new Date(iso).getTime()) / 3600000).toFixed(1)
}

export { REFRESH_POLICY as default }