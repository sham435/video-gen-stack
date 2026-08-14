// AssetUsageTracker — thin policy layer over ImageDatabase usage records.
//
// Answers the two questions the ranker needs:
//   - "was this asset (or its near-twin) used recently?" → recency penalty
//   - "which assets are burned out?" → cross-video reuse policy
//
// Works on metadata objects (dHash/sha256), so it can reason about
// near-duplicates — not just exact URL reuse.

import { dHashDistance } from './ImageMetadata.mjs'
import { DUP_THRESHOLD } from './DuplicateDetector.mjs'

export class AssetUsageTracker {
  constructor(database) {
    this.db = database
    this._recentWindow = [] // cached last-N video ids (refreshed per status batch)
  }

  /**
   * Recency info for an asset against the DB history.
   * @returns {{usedInDays:number|null, useCount:number, hot:boolean,
   *   usedInRecentVideos:boolean, nearTwin:boolean}}
   *   usedInDays = days since this asset (or a near-twin) was last used;
   *   hot = used within `cooldownDays` → ranker should deprioritize;
   *   usedInRecentVideos = asset appeared in any of the last `videoWindow`
   *   distinct published videos → ranker hard-excludes (per-channel policy).
   */
  status(asset, { cooldownDays = 7, videoWindow = 50 } = {}) {
    const exact = asset.sha256 ? this.db.get(asset.sha256) : null
    if (exact?.last_used) {
      const days = (Date.now() - new Date(exact.last_used.replace(' ', 'T') + 'Z').getTime()) / 86400000
      return {
        usedInDays: days,
        useCount: exact.usage_count,
        hot: days <= cooldownDays,
        usedInRecentVideos: this._usedInWindow(exact.sha256, videoWindow),
        nearTwin: false,
      }
    }
    // near-twin scan — dHash search across indexed assets
    let nearest = null
    for (const row of this.db.recent(365)) {
      if (!row.dHash || !asset.dHash) continue
      const d = dHashDistance(row.dHash, asset.dHash)
      if (d <= DUP_THRESHOLD.near && (!nearest || d < nearest.d)) {
        nearest = { d, row }
      }
    }
    if (nearest?.row?.last_used) {
      const days = (Date.now() - new Date(nearest.row.last_used.replace(' ', 'T') + 'Z').getTime()) / 86400000
      return {
        usedInDays: days,
        useCount: nearest.row.usage_count,
        hot: days <= cooldownDays,
        usedInRecentVideos: this._usedInWindow(nearest.row.sha256, videoWindow),
        nearTwin: true,
      }
    }
    return { usedInDays: null, useCount: 0, hot: false, usedInRecentVideos: false, nearTwin: false }
  }

  /** Cache the last-N-video window across a ranking batch (one query per batch). */
  _usedInWindow(sha256, videoWindow) {
    if (!sha256 || !videoWindow || videoWindow <= 0) return false
    if (!this._recentWindow.length) {
      this._recentWindow = this.db.recentVideoIds(videoWindow)
    }
    return this._recentWindow.includes(sha256) || this.db.usedInVideos(sha256, this._recentWindow)
  }
}
