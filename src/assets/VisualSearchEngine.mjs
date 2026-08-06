// VisualSearchEngine — entity-aware image retrieval with a DB-first cache.
//
// Pipeline: entity expansion → asset database lookup (cached hits) → Pexels
// search (entity-expanded queries) → metadata extraction → DB upsert →
// dedup vs history → ranked candidates.
//
// Unlike the old per-scene `_pexelsOne` calls, this engine:
//   - expands a headline entity ("Apple") into concrete subjects
//     ("Apple Park", "Tim Cook", "iPhone factory", "WWDC")
//   - never re-downloads an already-indexed asset
//   - returns BOTH raw candidates and indexed metadata (sha256/dHash) so the
//     ranker and duplicate detector can do their jobs
//   - prefers the highest-quality portrait URL from Pexels response set

import { extractImageMetadata } from './ImageMetadata.mjs'
import { rejectDuplicates } from './DuplicateDetector.mjs'

const PEXELS_BASE = 'https://api.pexels.com/v1'

// entity → concrete visual subjects (extendable; Pexels-friendly terms)
export const ENTITY_EXPANSIONS = {
  apple: ['apple park', 'tim cook', 'apple store', 'iphone', 'macbook', 'wwdc'],
  samsung: ['samsung galaxy', 'samsung factory', 'samsung fold'],
  google: ['google pixel', 'google campus', 'google ai'],
  microsoft: ['microsoft campus', 'xbox', 'microsoft windows'],
  openai: ['openai', 'chatgpt', 'ai robot'],
  tesla: ['tesla factory', 'tesla cybertruck', 'elon musk'],
  nvidia: ['nvidia gpu', 'nvidia h100', 'data center'],
  meta: ['meta campus', 'oculus', 'facebook'],
  amazon: ['amazon warehouse', 'alexa', 'aws data center'],
  'netflix': ['netflix office', 'streaming', 'netflix'],
  'playstation': ['playstation 5', 'ps5 controller', 'playstation'],
  'xbox': ['xbox series x', 'xbox controller', 'microsoft xbox'],
  'pokemon': ['pokemon cards', 'pokemon game', 'pikachu'],
  'iphone': ['iphone 18', 'apple store', 'smartphone'],
  'nintendo': ['nintendo switch', 'switch 2', 'nintendo'],
  'covid': ['covid vaccine', 'lab research', 'medical mask'],
  'ai': ['artificial intelligence', 'ai robot', 'neural network'],
}

// scene type → search query bias (keeps hook/fact/explanation distinct)
const SCENE_BIAS = {
  hook: ['dramatic', 'closeup', 'dark'],
  fact: ['product', 'studio', 'clean'],
  explanation: ['diagram', 'technology', 'detail'],
  retention: ['mystery', 'shadows', 'intense'],
  reveal: ['launch', 'spotlight', 'celebration'],
}

export class VisualSearchEngine {
  /**
   * @param {object} opts
   * @param {import('./ImageDatabase.mjs').ImageDatabase} opts.database
   * @param {string} [opts.pexelsKey]
   * @param {number} [opts.perQuery] photos per query
   * @param {number} [opts.maxQueries] max Pexels queries per scene
   */
  constructor({ database = null, pexelsKey = process.env.PEXELS_API_KEY, perQuery = 8, maxQueries = 2 } = {}) {
    this.db = database
    this.pexelsKey = pexelsKey
    this.perQuery = perQuery
    this.maxQueries = maxQueries
  }

  /**
   * Resolve candidates for a scene.
   * @param {object} intent {subject, entities[], keywords[], sceneType, emotion}
   * @returns {Promise<Array<object>>} candidates [{url, source, keyword, ...metadata}]
   */
  async search(intent) {
    const queries = this._buildQueries(intent)
    const candidates = []

    // 1. DB-first: cached assets matching the top query terms
    if (this.db) {
      for (const term of queries.slice(0, 2)) {
        const cached = this.db.searchByTerm ? this.db.searchByTerm(term) : []
        for (const row of cached) {
          if (!row.url || !row.sha256) continue
          candidates.push({
            url: row.url, source: 'database', keyword: term, sha256: row.sha256,
            dHash: row.dHash, width: null, height: null, entity: row.entity,
            tags: JSON.parse(row.tags || '[]'), quality: row.quality,
          })
        }
      }
    }

    // 2. Pexels — entity-expanded queries
    if (this.pexelsKey) {
      for (const term of queries.slice(0, this.maxQueries)) {
        const urls = await this._pexelsSearch(term)
        for (const url of urls) {
          candidates.push({ url, source: 'pexels', keyword: term })
        }
        if (candidates.length >= 6) break
      }
    }

    // 3. Enrich + index fresh candidates (metadata, dedup vs DB)
    const enriched = []
    for (const c of candidates.slice(0, 12)) {
      try {
        const buf = await this._download(c.url)
        const meta = await extractImageMetadata(buf, {
          url: c.url, entity: intent.entity, tags: this._tagsFor(intent),
          license: 'pexels', source: c.source || 'pexels',
        })
        const full = { ...c, ...meta, quality: c.quality || 0 }
        if (this.db && full.sha256) this.db.upsert(full)
        enriched.push(full)
      } catch {
        enriched.push(c) // keep URL-only candidate as last resort
      }
    }

    // 4. Dedup: never return near-twins within this batch or vs DB history
    let known = []
    if (this.db) {
      known = this.db.recent ? this.db.recent(365) : []
    }
    const deduped = rejectDuplicates(enriched, known)
    return deduped.length ? deduped : enriched.slice(0, 1)
  }

  _buildQueries(intent) {
    const entity = String(intent.entity || intent.brand || '').toLowerCase().trim()
    const expansions = entity ? (ENTITY_EXPANSIONS[entity] || [entity]) : []
    const subject = String(intent.subject || '').toLowerCase().trim()
    const bias = SCENE_BIAS[intent.sceneType] || []
    const q = []

    if (expansions.length) q.push(...expansions)
    else if (subject) q.push(subject)
    if (subject && expansions.length === 0) {
      q.push(...bias.map(b => `${subject} ${b}`))
    }
    // keywords fallback
    for (const k of (intent.keywords || []).slice(0, 2)) {
      if (q.length < 4) q.push(k)
    }
    if (!q.length) q.push('technology', 'innovation')
    return [...new Set(q)].slice(0, 6)
  }

  _tagsFor(intent) {
    const tags = [intent.sceneType, intent.emotion, intent.entity]
    return tags.filter(Boolean)
  }

  async _pexelsSearch(term) {
    try {
      const res = await fetch(
        `${PEXELS_BASE}/search?query=${encodeURIComponent(term)}&per_page=${this.perQuery}&orientation=portrait`,
        { headers: { Authorization: this.pexelsKey }, signal: AbortSignal.timeout(8000) }
      )
      if (!res.ok) return []
      const data = await res.json()
      return (data.photos || []).slice(0, this.perQuery)
        .map(p => p.src?.large2x || p.src?.large || null)
        .filter(Boolean)
    } catch { return [] }
  }

  async _download(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`download failed ${res.status}`)
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  }
}
