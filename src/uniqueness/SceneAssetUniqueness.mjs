// SceneAssetUniqueness — ensures scene images are not reused across videos.
//
// Each scene in a production uses a hero image. This checker verifies that
// none of the scene images were used in any recent published video.
//
// Policy: any image hash that appears in a recent video = REJECT.
// The visual pipeline must select different images.
//
// Enforces BOTH cross-video rules at the final-asset boundary:
//   1. Rolling 7-day quarantine (mandatory invariant): an image committed as
//      a final production asset within the previous 7×24 hours is REJECTED,
//      plus any reservation held by another job. Fail-closed when the ledger
//      or a historical timestamp is unavailable/ambiguous.
//   2. Last-N-videos window (existing stronger global policy), exact + the
//      ImageDatabase 7-day window + perceptual near-twin (re-encoded/canonical
//      duplicate) detection via dHash.
//
// Cross-references with ImageDatabase (SQLite) for historical dedup
// AND with AssetRegistry (JSON) for the rolling window + reservation lifecycle.

export class SceneAssetUniqueness {
  constructor(registry, imageDatabase = null) {
    this.registry = registry
    this.imageDb = imageDatabase
  }

  /**
   * Validate all scene images for uniqueness.
   *
   * @param {Array} scenes — [{ sceneIndex, imageHash, sourceId }]
   * @param {object} context — { jobId, rollingWindow }
   * @returns {{ pass: boolean, violations: Array, total: number }}
   */
  validate(scenes, context = {}) {
    const violations = []
    const excludeJobId = context.excludeJobId || null

    for (const scene of scenes) {
      if (!scene.imageHash) continue

      // Check AssetRegistry (committed + reservations from other jobs)
      const isDup = this.registry.isImageDuplicate(scene.imageHash, excludeJobId)
      if (isDup) {
        const regEntry = this.registry.state.images[scene.imageHash]
        violations.push({
          sceneIndex: scene.sceneIndex,
          imageHash: scene.imageHash,
          source: 'AssetRegistry',
          reason: `IMAGE_DUPLICATE: hash=${scene.imageHash}`,
          duplicateOf: regEntry || null,
        })
        continue
      }

      // MANDATORY INVARIANT — rolling 7-day image quarantine at the
      // final-asset boundary. An image committed as a final production asset
      // by ANY video within the previous 7×24 hours is REJECTED. If the
      // ledger/history is unavailable or ambiguous (corrupt file, unparseable
      // timestamp), FAIL CLOSED — never assume an image is fresh because its
      // history cannot be found.
      const quarantine = this.registry.isImageQuarantined(scene.imageHash, { excludeJobId })
      if (quarantine.unknown) {
        violations.push({
          sceneIndex: scene.sceneIndex,
          imageHash: scene.imageHash,
          source: 'AssetRegistry',
          reason: `IMAGE_QUARANTINE_FAIL_CLOSED: history unavailable (${quarantine.reason})`,
          duplicateOf: { unknown: true, reason: quarantine.reason },
        })
        continue
      }
      if (quarantine.quarantined) {
        violations.push({
          sceneIndex: scene.sceneIndex,
          imageHash: scene.imageHash,
          source: 'AssetRegistry',
          reason: `IMAGE_QUARANTINED_7D: ${quarantine.reason}${quarantine.usedAt ? ` usedAt=${quarantine.usedAt}` : ''}${quarantine.reservedBy ? ` reservedBy=${quarantine.reservedBy}` : ''}`,
          duplicateOf: quarantine,
        })
        continue
      }

      // ImageDatabase (SQLite historical) — exact + perceptual within the
      // rolling time window, plus the last-N-videos window.
      if (this.imageDb) {
        // Existing: last-N-videos window (stronger global policy stays).
        const window = context.rollingWindow || this.registry.rollingWindow
        const recentTrackers = this.imageDb.recentVideoIds(window)
        if (this.imageDb.usedInVideos(scene.imageHash, recentTrackers)) {
          violations.push({
            sceneIndex: scene.sceneIndex,
            imageHash: scene.imageHash,
            source: 'ImageDatabase',
            reason: `IMAGE_DUPLICATE_DB: hash=${scene.imageHash} found in recent videos`,
            duplicateOf: null,
          })
          continue
        }
        // Time-based 7-day exact usage.
        if (this.imageDb.usedWithinDays(scene.imageHash, 7)) {
          violations.push({
            sceneIndex: scene.sceneIndex,
            imageHash: scene.imageHash,
            source: 'ImageDatabase',
            reason: `IMAGE_DUPLICATE_DB_7D: hash=${scene.imageHash} used within previous 7 days`,
            duplicateOf: null,
          })
          continue
        }
        // Perceptual near-twin (re-encoded / canonical duplicate) within 7 days.
        const row = this.imageDb.get(scene.imageHash)
        if (row?.dHash) {
          const twin = this.imageDb.nearTwinUsedWithinDays({ sha256: scene.imageHash, dHash: row.dHash }, 7)
          if (twin) {
            violations.push({
              sceneIndex: scene.sceneIndex,
              imageHash: scene.imageHash,
              source: 'ImageDatabase',
              reason: `IMAGE_NEAR_TWIN_7D: hash=${scene.imageHash} near-duplicate of ${twin.sha256} used within previous 7 days (dHash distance ${twin.distance})`,
              duplicateOf: twin,
            })
            continue
          }
        }
      }
    }

    return {
      pass: violations.length === 0,
      violations,
      total: scenes.length,
    }
  }

  /**
   * Record all scene images as used (call after PUBLISH succeeds).
   */
  record(scenes, context = {}) {
    for (const scene of scenes) {
      if (!scene.imageHash) continue
      this.registry.recordImage(scene.imageHash, {
        sourceId: scene.sourceId,
        jobId: context.jobId,
      })
    }
  }
}
