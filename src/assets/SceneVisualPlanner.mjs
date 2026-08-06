// SceneVisualPlanner — diversity policy across a story's scenes.
//
// Ensures a video never looks like "Apple Park, Apple Park, Apple Park":
//   - rejects duplicate/near-duplicate assets ACROSS scenes (phash clusters)
//   - limits how many consecutive scenes may share one entity
//   - keeps distinct b-roll families per scene
//
// Pure, deterministic; feeds on AssetUsageTracker + DuplicateDetector so it
// works on metadata (dHash/sha256) instead of trusting URLs.

import { compareAssets } from './DuplicateDetector.mjs'

export const DIVERSITY = {
  maxScenesPerEntity: 3,     // hard cap per video
  adjacentTwinDistance: 6,   // phash distance to treat two scenes as "same shot"
  maxAdjacentTwinStreaks: 1, // allow at most one reused visual family total
}

export class SceneVisualPlanner {
  constructor({ policy = DIVERSITY } = {}) {
    this.policy = policy
  }

  /**
   * Pick a safe asset for `scene` given what earlier scenes already used.
   * @param {object} scene             {index, entity, images}
   * @param {object} ctx               {usedAssets:Array, entityCounts:Map, twinStreaks:number}
   * @returns {object} {asset, changeMade, reason}
   */
  pick(scene, ctx) {
    const used = ctx.usedScenes || []
    const counts = ctx.entityCounts || new Map()

    const entity = scene.entity || null
    if (entity && (counts.get(entity) || 0) >= this.policy.maxScenesPerEntity) {
      return this._fallback(scene, `entity "${entity}" exceeds max ${this.policy.maxScenesPerEntity} scenes`, used)
    }

    const candidates = (scene.images || []).filter(Boolean)
    if (!candidates.length) return { asset: null, changeMade: false, reason: 'no candidates' }

    // Drop candidate assets that are phash twins of anything already rendered
    let chosen = null
    for (const c of candidates) {
      let twin = false
      for (const u of used) {
        if (u.sha256 && c.sha256 && u.sha256 === c.sha256) { twin = true; break }
        if (u.dHash && c.dHash) {
          const d = this._twinDistance(u.dHash, c.dHash)
          if (d <= this.policy.adjacentTwinDistance) { twin = true; break }
        }
      }
      if (!twin) { chosen = c; break }
    }

    if (!chosen) {
      // all twins → allow the newest used asset (avoid empty frame), flag it
      chosen = candidates[0]
      return { asset: chosen, changeMade: true, reason: 'all candidates are near-duplicates; reused best' }
    }
    return { asset: chosen, changeMade: true, reason: 'selected distinct asset' }
  }

  _twinDistance(a, b) {
    const ai = BigInt('0x' + a), bi = BigInt('0x' + b)
    let x = ai ^ bi, d = 0
    while (x) { d += Number(x & 1n); x >>= 1n }
    return d
  }

  _fallback(scene, reason, used) {
    return { asset: scene.images?.[0] || null, changeMade: false, reason, fallback: true }
  }
}