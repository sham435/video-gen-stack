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
    `)
  }

  /** Upsert an image record. Returns the row. */
  upsert(image) {
    const stmt = this.db.prepare(`
      INSERT INTO images (sha256, dHash, url, entity, tags, license, source, quality, usage_count, first_seen, last_used)
      VALUES (@sha256, @dHash, @url, @entity, @tags, @license, @source, @quality, 0, datetime('now'), NULL)
      ON CONFLICT(sha256) DO UPDATE SET
        dHash   = COALESCE(excluded.dHash, images.dHash),
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

  /** Close() the underlying handle. */
  close() { try { this.db.close() } catch { /* already closed */ } }
}
