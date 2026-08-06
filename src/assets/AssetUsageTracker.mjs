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
  }

  /**
   * Recency info for an asset against the DB history.
   * @returns {{usedInDays:number|null, useCount:number, hot:boolean}}
   *   usedInDays = days since this asset (or a near-twin) was last used;
   *   hot = used within `cooldownDays` → ranker should deprioritize.
   */
  status(asset, { cooldownDays = 7 } = {}) {
    const exact = asset.sha256 ? this.db.get(asset.sha256) : null
    if (exact?.last_used) {
      const days = (Date.now() - new Date(exact.last_used.replace(' ', 'T') + 'Z').getTime()) / 86400000
      return {
        usedInDays: days,
        useCount: exact.usage_count,
        hot: days <= cooldownDays,
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
        nearTwin: true,
      }
    }
    return { usedInDays: null, useCount: 0, hot: false, nearTwin: false }
  }
}
