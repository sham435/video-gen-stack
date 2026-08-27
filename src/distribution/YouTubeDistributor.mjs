/**
 * YouTubeDistributor — publishes video + thumbnail to YouTube.
 * Consumes PublicationArtifact. Returns distribution result with videoId.
 */

import { readFileSync, existsSync } from 'node:fs'
import { DistributionState, DistributionFailure } from './DistributionState.mjs'

export class YouTubeDistributor {
  constructor(options = {}) {
    this.publishVideo = options.publishVideo // function(videoUrl, title, desc, privacy, coverPath) → result
    this.getAccessToken = options.getAccessToken // function() → token
    this.setThumbnail = options.setThumbnail // function(token, videoId, coverPath) → result
    this.channelController = options.channelController || null
  }

  async distribute(artifact, jobContext = {}) {
    const result = {
      destination: 'youtube',
      state: DistributionState.PENDING,
      videoId: null,
      url: null,
      thumbnail: { state: DistributionState.PENDING, sha256: artifact.thumbnail.sha256 },
      attempts: 0,
      errors: [],
      durationMs: 0,
    }

    const start = Date.now()

    // Reserve channel quota
    if (this.channelController) {
      try {
        await this.channelController.reserve('news')
      } catch (e) {
        result.state = DistributionState.FAILED
        result.errors.push({ error: e.message, classification: 'QUOTA' })
        result.durationMs = Date.now() - start
        return result
      }
    }

    try {
      // Upload video + thumbnail
      const uploadResult = await this.publishVideo({
        videoUrl: `file://${artifact.video.path}`,
        title: artifact.metadata.title,
        description: artifact.metadata.description || '',
        thumbnailPath: artifact.thumbnail.path,
        privacy: 'public',
      })

      result.videoId = uploadResult.videoId
      result.url = uploadResult.url
      result.thumbnail.state = uploadResult.thumbnailUploaded
        ? DistributionState.SUCCESS
        : DistributionState.FAILED
      result.state = DistributionState.SUCCESS
      result.attempts = 1

      // Commit channel reservation
      if (this.channelController) {
        try {
          await this.channelController.commit('news', result.videoId)
        } catch { /* reservation commit non-fatal */ }
      }
    } catch (e) {
      result.state = DistributionState.FAILED
      result.errors.push({ error: e.message, classification: DistributionFailure.classify(e) })
      result.attempts = 1

      // Release channel reservation on failure
      if (this.channelController) {
        try { await this.channelController.release('news') } catch { /* non-fatal */ }
      }
    }

    result.durationMs = Date.now() - start
    return result
  }
}
