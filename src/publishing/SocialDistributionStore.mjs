import { getDb, initSchema } from '../../packages/database/news-engine.mjs'

// SocialDistributionStore — persistence for post-publish distribution state.
//
// One row per (videoId, platform, distributionType). The UNIQUE constraint in
// migration v4 makes idempotency structural: a restarted worker that tries to
// insert a second row for the same key will either get the existing row back
// (INSERT OR IGNORE) or hit the UNIQUE error, which we treat the same way.

export class SocialDistributionStore {
  constructor(db = null) {
    this._ownsDb = !db
    this.db = db || (() => { const d = getDb(); initSchema(d); return d })()
  }

  close() {
    if (this._ownsDb) try { this.db.close() } catch {}
  }

  /** Begin a distribution row; returns existing row if already recorded
   * (idempotent claim). Returns null on insert failure only if concurrent. */
  begin({ videoId, platform, distributionType = 'promotional_post', payload = {} }) {
    const row = this.db.prepare(
      `SELECT * FROM social_distributions WHERE video_id = ? AND platform = ? AND distribution_type = ?`
    ).get(videoId, platform, distributionType)
    if (row) return row

    try {
      this.db.prepare(
        `INSERT OR IGNORE INTO social_distributions
           (video_id, platform, distribution_type, status, payload, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))`
      ).run(videoId, platform, distributionType, JSON.stringify(payload))
    } catch (e) {
      // UNIQUE race from a concurrent worker — the winner's row already exists.
      if (/UNIQUE/.test(e.message)) return this.get(videoId, platform, distributionType)
      throw e
    }
    return this.get(videoId, platform, distributionType)
  }

  get(videoId, platform, distributionType = 'promotional_post') {
    return this.db.prepare(
      `SELECT * FROM social_distributions WHERE video_id = ? AND platform = ? AND distribution_type = ?`
    ).get(videoId, platform, distributionType) || null
  }

  /** Atomically claim a pending row for publishing (pending -> publishing). */
  claim(videoId, platform, distributionType = 'promotional_post') {
    const row = this.db.prepare(
      `UPDATE social_distributions
         SET status = 'publishing', updated_at = datetime('now'), attempts = attempts + 1
       WHERE video_id = ? AND platform = ? AND distribution_type = ? AND status = 'pending'
       RETURNING *`
    ).get(videoId, platform, distributionType)
    return row || null
  }

  markPending(videoId, platform, distributionType = 'promotional_post') {
    this.db.prepare(
      `UPDATE social_distributions SET status = 'pending', error = NULL, updated_at = datetime('now')
       WHERE video_id = ? AND platform = ? AND distribution_type = ?`
    ).run(videoId, platform, distributionType)
  }

  markPublished(videoId, platform, distributionType, { postId = null, postUrl = null } = {}) {
    this.db.prepare(
      `UPDATE social_distributions SET status = 'published', post_id = ?, post_url = ?,
         error = NULL, updated_at = datetime('now')
       WHERE video_id = ? AND platform = ? AND distribution_type = ?`
    ).run(postId, postUrl, videoId, platform, distributionType)
  }

  markFailed(videoId, platform, distributionType, error = 'unknown') {
    this.db.prepare(
      `UPDATE social_distributions SET status = 'failed', error = ?, updated_at = datetime('now')
       WHERE video_id = ? AND platform = ? AND distribution_type = ?`
    ).run(String(error).slice(0, 500), videoId, platform, distributionType)
  }

  markSkipped(videoId, platform, distributionType, reason = '') {
    this.db.prepare(
      `UPDATE social_distributions SET status = 'skipped', error = ?, updated_at = datetime('now')
       WHERE video_id = ? AND platform = ? AND distribution_type = ?`
    ).run(String(reason).slice(0, 500), videoId, platform, distributionType)
  }

  markUnsupported(videoId, platform, distributionType, reason = '') {
    this.db.prepare(
      `UPDATE social_distributions SET status = 'unsupported', error = ?, updated_at = datetime('now')
       WHERE video_id = ? AND platform = ? AND distribution_type = ?`
    ).run(String(reason).slice(0, 500), videoId, platform, distributionType)
  }
}