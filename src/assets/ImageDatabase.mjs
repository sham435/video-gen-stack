// ImageDatabase — persistent asset index (SQLite).
//
// Every image seen by the pipeline is indexed here:
//
//   images: sha256 (PK), dHash, url, entity, tags, license, quality score,
//           usage_count, last_used, first_seen
//   usage : asset_hash -> { video_id, scene_index, used_at, outcome }
//
// Two responsibilities:
//   1. Duplicate detection across the whole history (query by dHash range).
//   2. Asset usage tracking for freshness/reuse policies (ImageRanker).
//
// Schema is idempotent; the DB file lives at data/image-database.sqlite.

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

export const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'image-database.sqlite')

export class ImageDatabase {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this._migrate()
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        sha256       TEXT PRIMARY KEY,
        dHash        TEXT,
        pHash        TEXT,
        url          TEXT,
        entity       TEXT,
        tags         TEXT DEFAULT '[]',
        license      TEXT,
        source       TEXT,
        quality      REAL DEFAULT 0,
        usage_count  INTEGER DEFAULT 0,
        first_seen   TEXT DEFAULT (datetime('now')),
        last_used    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_images_dhash ON images(dHash);
      CREATE INDEX IF NOT EXISTS idx_images_entity ON images(entity);
      CREATE TABLE IF NOT EXISTS usage (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        sha256      TEXT,
        video_id    TEXT,
        scene_index INTEGER,
        used_at     TEXT DEFAULT (datetime('now')),
        outcome     TEXT,
        FOREIGN KEY (sha256) REFERENCES images(sha256)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_hash ON usage(sha256);
      CREATE INDEX IF NOT EXISTS idx_usage_video ON usage(video_id);
      CREATE INDEX IF NOT EXISTS idx_usage_time ON usage(used_at);

      -- Music reuse tracking: which track was used per published video so the
      -- last-50-videos policy can keep each underscore fresh (no repeat tracks).
      CREATE TABLE IF NOT EXISTS music_usage (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id    TEXT,
        track       TEXT,
        family      TEXT,
        used_at     TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_music_usage_video ON music_usage(video_id);
      CREATE INDEX IF NOT EXISTS idx_music_usage_track ON music_usage(track);
      CREATE INDEX IF NOT EXISTS idx_music_usage_time ON music_usage(used_at);

      -- Milestone B: analytics-driven learning tables
      CREATE TABLE IF NOT EXISTS video_performance (
        video_id          TEXT PRIMARY KEY,
        title             TEXT,
        category          TEXT,
        published_at      TEXT,
        impressions       INTEGER DEFAULT 0,
        ctr               REAL,
        avg_view_duration REAL,
        retention         REAL,
        watch_time        REAL,
        views             INTEGER DEFAULT 0,
        likes             INTEGER DEFAULT 0,
        comments          INTEGER DEFAULT 0,
        shares            INTEGER DEFAULT 0,
        collected_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_video_perf_cat ON video_performance(category);

      CREATE TABLE IF NOT EXISTS scene_assets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id    TEXT,
        scene_index INTEGER,
        entity      TEXT,
        asset_id    TEXT,
        url         TEXT,
        headline    TEXT,
        retention   REAL,
        UNIQUE(video_id, scene_index)
      );
      CREATE INDEX IF NOT EXISTS idx_scene_assets_video ON scene_assets(video_id);
      CREATE INDEX IF NOT EXISTS idx_scene_assets_asset ON scene_assets(asset_id);

      CREATE TABLE IF NOT EXISTS image_performance (
        sha256         TEXT PRIMARY KEY,
        entity         TEXT,
        category       TEXT,
        videos_used    INTEGER DEFAULT 0,
        avg_ctr        REAL DEFAULT 0,
        avg_retention  REAL DEFAULT 0,
        avg_watch_time REAL DEFAULT 0,
        likes          INTEGER DEFAULT 0,
        comments       INTEGER DEFAULT 0,
        shares         INTEGER DEFAULT 0,
        last_used      TEXT,
        score          REAL DEFAULT 0,
        confidence     REAL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS thumbnail_performance (
        thumbnail_hash  TEXT PRIMARY KEY,
        ctr             REAL DEFAULT 0,
        impressions     INTEGER DEFAULT 0,
        clicks          INTEGER DEFAULT 0,
        entity          TEXT,
        style           TEXT,
        dominant_color  TEXT,
        headline_style  TEXT,
        sample_size     INTEGER DEFAULT 0,
        updated_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_thumb_perf_style ON thumbnail_performance(style);
      CREATE INDEX IF NOT EXISTS idx_thumb_perf_color ON thumbnail_performance(dominant_color);

      CREATE TABLE IF NOT EXISTS entity_performance (
        entity         TEXT PRIMARY KEY,
        category       TEXT,
        videos         INTEGER DEFAULT 0,
        avg_ctr        REAL DEFAULT 0,
        avg_retention  REAL DEFAULT 0,
        avg_watch_time REAL DEFAULT 0,
        score          REAL DEFAULT 0,
        confidence     REAL DEFAULT 0,
        updated_at     TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_entity_perf_cat ON entity_performance(category);

      -- Milestone C3: autonomous thumbnail refresh history. One row per
      -- replacement event, so the lifecycle loop knows when a video's
      -- thumbnail last changed (anti-churn gate) and can audit whether a
      -- refresh actually moved CTR.
      CREATE TABLE IF NOT EXISTS thumbnail_versions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id        TEXT NOT NULL,
        old_hash        TEXT,
        new_hash        TEXT,
        style           TEXT,
        category        TEXT,
        entity          TEXT,
        headline_style  TEXT,
        ctr_before      REAL,
        ctr_after       REAL,
        impressions     INTEGER DEFAULT 0,
        watch_time      REAL,
        retention       REAL,
        refresh_policy  TEXT,
        status          TEXT DEFAULT 'attempted',
        attempted_at    TEXT DEFAULT (datetime('now')),
        replaced        INTEGER DEFAULT 0,
        result          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_thumb_versions_video ON thumbnail_versions(video_id);
    `)

    this._addColumn('thumbnail_performance', 'features', 'TEXT')
    this._addColumn('thumbnail_performance', 'ctr_score', 'REAL DEFAULT 0')
    this._addColumn('thumbnail_performance', 'confidence', 'REAL DEFAULT 0')
    this._addColumn('image_performance', 'features', 'TEXT')
    // Milestone: DCT perceptual hash (phash) column on pre-existing DBs.
    this._addColumn('images', 'pHash', 'TEXT')
    try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_images_phash ON images(pHash)') } catch { /* table may be empty/new — non-fatal */ }
  }

  /** Idempotent ADD COLUMN (SQLite lacks IF NOT EXISTS for columns). */
  _addColumn(table, column, type) {
    try {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
      if (!cols.includes(column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      }
    } catch { /* table may not exist yet — non-fatal */ }
  }

  /** Upsert an image record. Returns the row. */
  upsert(image) {
    const stmt = this.db.prepare(`
      INSERT INTO images (sha256, dHash, pHash, url, entity, tags, license, source, quality, usage_count, first_seen, last_used)
      VALUES (@sha256, @dHash, @pHash, @url, @entity, @tags, @license, @source, @quality, 0, datetime('now'), NULL)
      ON CONFLICT(sha256) DO UPDATE SET
        dHash   = COALESCE(excluded.dHash, images.dHash),
        pHash   = COALESCE(excluded.pHash, images.pHash),
        url     = COALESCE(excluded.url, images.url),
        entity  = COALESCE(excluded.entity, images.entity),
        tags    = excluded.tags,
        license = COALESCE(excluded.license, images.license),
        source  = COALESCE(excluded.source, images.source),
        quality = MAX(images.quality, COALESCE(excluded.quality, 0))
    `)
    const row = {
      sha256: image.sha256,
      dHash: image.dHash || '',
      pHash: image.pHash || '',
      url: image.url || null,
      entity: image.entity || null,
      tags: JSON.stringify(image.tags || []),
      license: image.license || null,
      source: image.source || null,
      quality: image.quality || 0,
    }
    stmt.run(row)
    return this.get(image.sha256)
  }

  get(sha256) {
    return this.db.prepare('SELECT * FROM images WHERE sha256 = ?').get(sha256) || null
  }

  getByUrl(url) {
    if (!url) return null
    return this.db.prepare('SELECT * FROM images WHERE url = ?').get(url) || null
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM images').get().n
  }

  /** Assets seen in the last `hours` (for freshness/reuse policy). */
  recent(hours = 48) {
    return this.db.prepare(`
      SELECT * FROM images
      WHERE last_used IS NOT NULL AND last_used >= datetime('now', ?)
      ORDER BY last_used DESC
    `).all(`-${hours} hours`)
  }

  /** Assets whose entity/tags/url mention `term` (DB-first retrieval hit). */
  searchByTerm(term, { limit = 4 } = {}) {
    const like = `%${term.toLowerCase()}%`
    return this.db.prepare(`
      SELECT * FROM images
      WHERE entity LIKE ? OR tags LIKE ? OR url LIKE ?
      ORDER BY COALESCE(last_used, first_seen) DESC
      LIMIT ?
    `).all(like, like, like, limit)
  }

  /**
   * Assets whose entity or tags mention `category` (e.g. 'sports', 'politics',
   * 'ai', 'science'). Category is stored in the tags array by the pipeline;
   * entity matches are a secondary, weaker signal.
   */
  searchCategory(category, { limit = 6 } = {}) {
    if (!category) return []
    const cat = category.toLowerCase()
    const like = `%${cat}%`
    return this.db.prepare(`
      SELECT * FROM images
      WHERE tags LIKE ?
      ORDER BY COALESCE(usage_count, 0) DESC, COALESCE(last_used, first_seen) DESC
      LIMIT ?
    `).all(like, limit)
  }

  /**
   * Random unused (or least-used) assets — the diversity escape hatch the
   * ranking engine calls when an entity has no strong candidates. Prefers
   * never-used images first, then least-used, so fresh content wins.
   */
  randomUnused({ limit = 6 } = {}) {
    return this.db.prepare(`
      SELECT * FROM images
      WHERE usage_count = 0
      ORDER BY RANDOM()
      LIMIT ?
    `).all(limit)
  }

  /** Top assets by usage_count (for reporting / long-tail avoidance). */
  mostUsed(limit = 50) {
    return this.db.prepare('SELECT * FROM images ORDER BY usage_count DESC LIMIT ?').all(limit)
  }

  /**
   * Record that an image was used in a video scene.
   * Updates usage_count + last_used on the image row.
   */
  recordUsage(sha256, { videoId = null, sceneIndex = null, outcome = null } = {}) {
    const img = this.get(sha256)
    if (!img) return null
    this.db.prepare(`
      INSERT INTO usage (sha256, video_id, scene_index, used_at, outcome)
      VALUES (?, ?, ?, datetime('now'), ?)
    `).run(sha256, videoId, sceneIndex, outcome)
    this.db.prepare(`
      UPDATE images SET usage_count = usage_count + 1, last_used = datetime('now')
      WHERE sha256 = ?
    `).run(sha256)
    return this.get(sha256)
  }

  /** Usage history for one asset. */
  usageHistory(sha256, limit = 20) {
    return this.db.prepare('SELECT * FROM usage WHERE sha256 = ? ORDER BY used_at DESC LIMIT ?')
      .all(sha256, limit)
  }

  /**
   * IDs of the most recent `n` distinct videos that have used any asset —
   * the "last N videos" reuse window. Returns an ordered array (newest first).
   */
  recentVideoIds(n = 50) {
    return this.db.prepare(`
      SELECT video_id, MAX(used_at) AS last_used
      FROM usage
      WHERE video_id IS NOT NULL AND video_id != ''
      GROUP BY video_id
      ORDER BY last_used DESC
      LIMIT ?
    `).all(n).map(r => r.video_id)
  }

  /**
   * Whether an asset (or an exact-twin URL) appears in the given video ids.
   * @param {string} sha256 asset hash
   * @param {string[]} videoIds recent video id window
   * @returns {boolean}
   */
  usedInVideos(sha256, videoIds) {
    if (!sha256 || !videoIds?.length) return false
    const marks = this.db.prepare(`
      SELECT DISTINCT video_id FROM usage WHERE sha256 = ?
    `).all(sha256).map(r => r.video_id)
    return marks.some(id => videoIds.includes(id))
  }

  /** Record which music track was used for a published video. */
  recordMusicUsage(videoId, track, family = null) {
    if (!videoId || !track) return null
    this.db.prepare(`
      INSERT INTO music_usage (video_id, track, family, used_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(videoId, track, family)
    return { videoId, track, family }
  }

  /**
   * Track filenames used in the most recent `n` distinct published videos —
   * the music equivalent of recentVideoIds(). Newest first.
   */
  recentMusicTracks(n = 50) {
    return this.db.prepare(`
      SELECT track, family, MAX(used_at) AS last_used
      FROM music_usage
      WHERE track IS NOT NULL AND track != ''
      GROUP BY track
      ORDER BY last_used DESC
      LIMIT ?
    `).all(n).map(r => ({ track: r.track, family: r.family }))
  }

  /** Track used in any of the given video ids (reuse-window check). */
  musicUsedInVideos(track, videoIds) {
    if (!track || !videoIds?.length) return false
    const marks = this.db.prepare(`
      SELECT DISTINCT video_id FROM music_usage WHERE track = ?
    `).all(track).map(r => r.video_id)
    return marks.some(id => videoIds.includes(id))
  }

  /** Close() the underlying handle. */
  close() { try { this.db.close() } catch { /* already closed */ } }
}
