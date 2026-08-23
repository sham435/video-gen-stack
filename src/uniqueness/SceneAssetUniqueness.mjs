// SceneAssetUniqueness — ensures scene images are not reused across videos.
//
// Each scene in a production uses a hero image. This checker verifies that
// none of the scene images were used in any recent published video.
//
// Policy: any image hash that appears in a recent video = REJECT.
// The visual pipeline must select different images.
//
// Cross-references with ImageDatabase (SQLite) for historical dedup
// AND with AssetRegistry (JSON) for the rolling window.

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

      // Check ImageDatabase (SQLite historical)
      if (this.imageDb) {
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
