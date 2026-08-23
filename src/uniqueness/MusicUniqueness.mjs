// MusicUniqueness — ensures background music tracks are not reused.
//
// At 48/day, music selection must rotate across the library. This checker
// verifies that the selected track was not used in any recent video.
//
// Policy: track that appears in a recent video = REJECT.
// The audio pipeline must select a different track/family.
//
// Cross-references with ImageDatabase.music_usage (SQLite) AND
// AssetRegistry (JSON rolling window).

export class MusicUniqueness {
  constructor(registry, imageDatabase = null) {
    this.registry = registry
    this.imageDb = imageDatabase
  }

  /**
   * Validate a music track for uniqueness.
   *
   * @param {object} music — { trackId, trackHash, family }
   * @param {object} context — { jobId, rollingWindow }
   * @returns {{ pass: boolean, reason: string|null, duplicateOf: object|null }}
   */
  validate(music, context = {}) {
    if (!music?.trackId) {
      return { pass: true, reason: null, duplicateOf: null }
    }

    const window = context.rollingWindow || this.registry.rollingWindow
    const recentVideos = this.registry.state.publishedVideos.slice(-window)

    // Check AssetRegistry (JSON rolling window)
    const regEntry = this.registry.state.music[music.trackId]
    if (regEntry) {
      const inRecentWindow = recentVideos.some(v => v.musicTrackId === music.trackId)
      if (inRecentWindow || regEntry.usageCount > 1) {
        return {
          pass: false,
          reason: `MUSIC_DUPLICATE: track=${music.trackId} used ${regEntry.usageCount}x`,
          duplicateOf: regEntry,
        }
      }
    }

    // Check ImageDatabase (SQLite historical)
    if (this.imageDb) {
      const recentTrackers = this.imageDb.recentVideoIds(window)
      if (this.imageDb.musicUsedInVideos(music.trackId, recentTrackers)) {
        return {
          pass: false,
          reason: `MUSIC_DUPLICATE_DB: track=${music.trackId} found in recent videos`,
          duplicateOf: null,
        }
      }
    }

    return { pass: true, reason: null, duplicateOf: null }
  }

  /**
   * Record a music track as used (call after PUBLISH succeeds).
   */
  record(music, context = {}) {
    if (!music?.trackId) return
    this.registry.recordMusic(music.trackId, {
      trackHash: music.trackHash,
      family: music.family,
      jobId: context.jobId,
    })
  }
}
