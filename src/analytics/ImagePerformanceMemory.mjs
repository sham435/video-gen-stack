// ImagePerformanceMemory — Milestone B: learn which assets actually perform.
//
// Consumes AnalyticsCollector snapshots + per-video scene→asset mappings and
// maintains learned scores in SQLite:
//
//   image_performance    per-asset learned stats (score, confidence)
//   entity_performance   per-entity learned stats (Apple Park vs Apple logo)
//   video_performance    raw aggregate per upload
//   scene_assets         which asset appeared in which scene of which video
//   thumbnail_performance  packaging learning (separate from in-video assets)
//
// Scoring model (deterministic, bounded 0..1):
//   score = w_ctr * ctrN + w_ret * retN + w_watch * watchN
//   ctrN  = min(1, avg_ctr / CTR_GOOD)          CTR_GOOD = 20 (%)
//   retN  = min(1, avg_retention / RET_GOOD)    RET_GOOD = 80 (%)
//   watchN= min(1, avg_watch_time / WATCH_GOOD) WATCH_GOOD = 15 (s)
//   confidence = min(1, videos_used / CONFIDENCE_VIDEOS)   cold-start → 0
//
// Cold start: an asset with no performance data gets score 0 / confidence 0,
// so the ranker falls back to pure deterministic heuristics — exactly the
// pre-Milestone-B behavior.

import { ImageDatabase } from '../assets/ImageDatabase.mjs'

export const PERF = {
  wCtr: 0.4,
  wRet: 0.4,
  wWatch: 0.2,
  ctrGood: 20,        // % CTR = excellent
  retGood: 80,        // % retention = excellent
  watchGood: 15,      // seconds average watch = excellent
  confidenceVideos: 6, // 6+ videos = full confidence
}

export class ImagePerformanceMemory {
  constructor(dbPath) {
    this.db = new ImageDatabase(dbPath)
  }

  close() { this.db.close() }

  // ------------------------------------------------------------------
  // Ingestion
  // ------------------------------------------------------------------

  /** Upsert a collected video snapshot. Returns the row. */
  recordVideo(metrics) {
    if (!metrics?.videoId) return null
    this.db.db.prepare(`
      INSERT INTO video_performance
        (video_id, title, category, published_at, impressions, ctr,
         avg_view_duration, retention, watch_time, views, likes, comments, shares)
      VALUES (@videoId, @title, @category, @publishedAt, @impressions, @ctr,
         @avgViewDurationSec, @retention, @watchTimeSec, @views, @likes, @comments, @shares)
      ON CONFLICT(video_id) DO UPDATE SET
        impressions     = COALESCE(excluded.impressions, video_performance.impressions),
        ctr             = COALESCE(excluded.ctr, video_performance.ctr),
        avg_view_duration = COALESCE(excluded.avg_view_duration, video_performance.avg_view_duration),
        retention       = COALESCE(excluded.retention, video_performance.retention),
        watch_time      = COALESCE(excluded.watch_time, video_performance.watch_time),
        views           = COALESCE(excluded.views, video_performance.views),
        likes           = COALESCE(excluded.likes, video_performance.likes),
        comments        = COALESCE(excluded.comments, video_performance.comments),
        shares          = COALESCE(excluded.shares, video_performance.shares),
        collected_at    = datetime('now')
    `).run({
      videoId: metrics.videoId,
      title: metrics.title || null,
      category: metrics.category || null,
      publishedAt: metrics.publishedAt || new Date().toISOString(),
      impressions: metrics.impressions ?? 0,
      ctr: metrics.ctr ?? null,
      avgViewDurationSec: metrics.avgViewDurationSec ?? null,
      retention: metrics.retention ?? null,
      watchTimeSec: metrics.watchTimeSec ?? null,
      views: metrics.views ?? 0,
      likes: metrics.likes ?? 0,
      comments: metrics.comments ?? 0,
      shares: metrics.shares ?? 0,
    })
    return this.video(metrics.videoId)
  }

  /**
   * Record which asset appeared in which scene of a video. Retention per
   * scene comes from the retention curve bucket (best-effort).
   */
  recordSceneAsset(videoId, sceneIndex, { assetId, entity, url, headline, retention } = {}) {
    this.db.db.prepare(`
      INSERT INTO scene_assets (video_id, scene_index, entity, asset_id, url, headline, retention)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id, scene_index) DO UPDATE SET
        entity = COALESCE(excluded.entity, scene_assets.entity),
        asset_id = COALESCE(excluded.asset_id, scene_assets.asset_id),
        url = COALESCE(excluded.url, scene_assets.url),
        retention = COALESCE(excluded.retention, scene_assets.retention)
    `).run(videoId, sceneIndex, entity || null, assetId || null, url || null, headline || null, retention ?? null)
  }

  /** Record many scene assets at once. */
  recordSceneAssets(videoId, entries = []) {
    for (const e of entries) this.recordSceneAsset(videoId, e.sceneIndex, e)
  }

  /** Record a thumbnail measurement (packaging, not in-video). */
  recordThumbnail(thumbnailHash, { ctr, impressions, clicks, entity, style, dominantColor, headlineStyle } = {}) {
    this.db.db.prepare(`
      INSERT INTO thumbnail_performance
        (thumbnail_hash, ctr, impressions, clicks, entity, style, dominant_color, headline_style, sample_size, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(thumbnail_hash) DO UPDATE SET
        ctr             = CASE WHEN thumbnail_performance.sample_size >= 1
                               THEN (thumbnail_performance.ctr * thumbnail_performance.sample_size + excluded.ctr) / (thumbnail_performance.sample_size + 1)
                               ELSE COALESCE(excluded.ctr, thumbnail_performance.ctr) END,
        impressions     = thumbnail_performance.impressions + COALESCE(excluded.impressions, 0),
        clicks          = thumbnail_performance.clicks + COALESCE(excluded.clicks, 0),
        entity          = COALESCE(excluded.entity, thumbnail_performance.entity),
        style           = COALESCE(excluded.style, thumbnail_performance.style),
        dominant_color  = COALESCE(excluded.dominant_color, thumbnail_performance.dominant_color),
        headline_style  = COALESCE(excluded.headline_style, thumbnail_performance.headline_style),
        sample_size     = thumbnail_performance.sample_size + 1,
        updated_at      = datetime('now')
    `).run(thumbnailHash, ctr ?? null, impressions ?? 0, clicks ?? 0, entity || null, style || null, dominantColor || null, headlineStyle || null)
  }

  // ------------------------------------------------------------------
  // Aggregation → learned scores
  // ------------------------------------------------------------------

  /**
   * Recompute all learned scores from video_performance + scene_assets.
   * Call after ingesting new analytics. Returns {images, entities}.
   */
  recomputeAll() {
    const videos = this.db.db.prepare('SELECT * FROM video_performance WHERE views >= 5').all()
    this._recomputeImages(videos)
    this._recomputeEntities(videos)
    return { images: this.db.db.prepare('SELECT * FROM image_performance ORDER BY score DESC').all(), entities: this.db.db.prepare('SELECT * FROM entity_performance ORDER BY score DESC').all() }
  }

  _recomputeImages(videos) {
    this.db.db.prepare('DELETE FROM image_performance').run()
    for (const v of videos) {
      const scenes = this.db.db.prepare('SELECT * FROM scene_assets WHERE video_id = ? AND asset_id IS NOT NULL').all(v.video_id)
      for (const s of scenes) this._accumulate(s, v)
    }
    // Second pass: learned score + confidence from the aggregates.
    const rows = this.db.db.prepare('SELECT * FROM image_performance').all()
    for (const r of rows) {
      const { score, confidence } = this._learnedScore(r)
      this.db.db.prepare('UPDATE image_performance SET score = ?, confidence = ? WHERE sha256 = ?')
        .run(score, confidence, r.sha256)
    }
  }

  /** Deterministic learned score + confidence for an aggregated row. */
  _learnedScore(row) {
    const videosUsed = row.videos_used || 0
    const { score } = this._scoreOf({ ctr: row.avg_ctr, retention: row.avg_retention, watch: row.avg_watch_time })
    // Full confidence once the asset has been seen in >= CONFIDENCE_VIDEOS
    const confidence = Math.min(1, videosUsed / PERF.confidenceVideos)
    return { score: +score.toFixed(4), confidence: +confidence.toFixed(4) }
  }

  _accumulate(scene, video) {
    const row = this.db.db.prepare('SELECT * FROM image_performance WHERE sha256 = ?').get(scene.asset_id)
    const n = row ? row.videos_used : 0
    const avg = (prev, val) => val == null ? prev : (prev * n + val) / (n + 1)
    this.db.db.prepare(`
      INSERT INTO image_performance (sha256, entity, category, videos_used,
        avg_ctr, avg_retention, avg_watch_time, likes, comments, shares, last_used)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sha256) DO UPDATE SET
        videos_used    = image_performance.videos_used + 1,
        avg_ctr        = CASE WHEN ? IS NOT NULL THEN (image_performance.avg_ctr * image_performance.videos_used + ?) / (image_performance.videos_used + 1) ELSE image_performance.avg_ctr END,
        avg_retention  = CASE WHEN ? IS NOT NULL THEN (image_performance.avg_retention * image_performance.videos_used + ?) / (image_performance.videos_used + 1) ELSE image_performance.avg_retention END,
        avg_watch_time = CASE WHEN ? IS NOT NULL THEN (image_performance.avg_watch_time * image_performance.videos_used + ?) / (image_performance.videos_used + 1) ELSE image_performance.avg_watch_time END,
        likes          = image_performance.likes + ?,
        comments       = image_performance.comments + ?,
        shares         = image_performance.shares + ?,
        last_used      = ?
    `).run(
      scene.asset_id, scene.entity || null, video.category || null,
      video.ctr, video.retention, video.watch_time, video.likes, video.comments, video.shares, video.collected_at,
      video.ctr, video.ctr,
      video.retention, video.retention,
      video.watch_time, video.watch_time,
      video.likes, video.comments, video.shares, video.collected_at
    )
  }

  _recomputeEntities(videos) {
    this.db.db.prepare('DELETE FROM entity_performance').run()
    const byEntity = new Map()
    for (const v of videos) {
      const scenes = this.db.db.prepare('SELECT DISTINCT entity FROM scene_assets WHERE video_id = ? AND entity IS NOT NULL').all(v.video_id)
      for (const { entity } of scenes) {
        const key = entity
        const e = byEntity.get(key) || { entity, category: v.category, ctr: [], ret: [], watch: [], videos: 0 }
        e.ctr.push(v.ctr); e.ret.push(v.retention); e.watch.push(v.watch_time); e.videos++
        byEntity.set(key, e)
      }
    }
    for (const e of byEntity.values()) {
      const avg = (arr) => { const f = arr.filter(x => x != null); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null }
      const stmt = this.db.db.prepare(`
        INSERT INTO entity_performance (entity, category, videos, avg_ctr, avg_retention, avg_watch_time, score, confidence, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(entity) DO UPDATE SET
          category = excluded.category, videos = excluded.videos,
          avg_ctr = excluded.avg_ctr, avg_retention = excluded.avg_retention,
          avg_watch_time = excluded.avg_watch_time, score = excluded.score,
          confidence = excluded.confidence, updated_at = datetime('now')
      `)
      const score = this._scoreOf({ ctr: avg(e.ctr), retention: avg(e.ret), watch: avg(e.watch) })
      const confidence = Math.min(1, e.videos / PERF.confidenceVideos)
      stmt.run(e.entity, e.category, e.videos, avg(e.ctr), avg(e.ret), avg(e.watch), score.score, +confidence.toFixed(4))
    }
  }

  // ------------------------------------------------------------------
  // Read paths used by the ranker
  // ------------------------------------------------------------------

  /** Learned stats for one asset (cold start → null). */
  asset(sha256) {
    if (!sha256) return null
    return this.db.db.prepare('SELECT * FROM image_performance WHERE sha256 = ?').get(sha256) || null
  }

  /** Learned stats for one entity (cold start → null). */
  entity(entity) {
    if (!entity) return null
    return this.db.db.prepare('SELECT * FROM entity_performance WHERE entity = ?').get(entity) || null
  }

  video(videoId) {
    return this.db.db.prepare('SELECT * FROM video_performance WHERE video_id = ?').get(videoId) || null
  }

  /** All video snapshots (for the daily job report). */
  videos(limit = 100) {
    return this.db.db.prepare('SELECT * FROM video_performance ORDER BY collected_at DESC LIMIT ?').all(limit)
  }

  /** Deterministic score + confidence for a metrics tuple. */
  _scoreOf({ ctr, retention, watch }) {
    const ctrN = ctr == null ? 0 : Math.min(1, ctr / PERF.ctrGood)
    const retN = retention == null ? 0 : Math.min(1, retention / PERF.retGood)
    const watchN = watch == null ? 0 : Math.min(1, watch / PERF.watchGood)
    const raw = PERF.wCtr * ctrN + PERF.wRet * retN + PERF.wWatch * watchN
    // Normalize: max achievable is 1.0 when all three hit their "good" level
    const score = Math.max(0, Math.min(1, raw))
    return { score: +score.toFixed(4) }
  }
}
