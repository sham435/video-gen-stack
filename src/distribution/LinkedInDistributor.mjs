/**
 * LinkedInDistributor — cross-posts video to LinkedIn.
 * Consumes PublicationArtifact. Returns distribution result with postId.
 */

import { DistributionState, DistributionFailure } from './DistributionState.mjs'

export class LinkedInDistributor {
  constructor(options = {}) {
    this.shareImage = options.shareImage // function({ imageUrl, text, link }) → result
    this.shareVideo = options.shareVideo // function({ videoUrl, text }) → result
    this.postFactory = options.postFactory || null // LinkedInPostFactory
  }

  async distribute(artifact, jobContext = {}) {
    const result = {
      destination: 'linkedin',
      state: DistributionState.PENDING,
      postId: null,
      attempts: 0,
      errors: [],
      durationMs: 0,
    }

    // LinkedIn not configured — skip
    if (!this.shareImage && !this.shareVideo) {
      result.state = DistributionState.SKIPPED
      return result
    }

    const start = Date.now()

    try {
      // Generate LinkedIn post content
      let postText = artifact.metadata.title || 'News Update'
      if (this.postFactory) {
        const post = this.postFactory.create(artifact.metadata)
        postText = post.text || postText
      }

      // Share thumbnail with link to YouTube
      if (this.shareImage && artifact.thumbnail.path) {
        const youtubeUrl = artifact.destinations.youtube?.url || null
        const shareResult = await this.shareImage({
          imageUrl: artifact.thumbnail.path,
          text: postText,
          link: youtubeUrl,
        })
        result.postId = shareResult?.postId || shareResult?.id || null
        result.state = DistributionState.SUCCESS
      } else {
        result.state = DistributionState.SKIPPED
        result.errors.push({ error: 'no shareImage or thumbnail', classification: 'PERMANENT' })
      }

      result.attempts = 1
    } catch (e) {
      result.state = DistributionState.FAILED
      result.errors.push({ error: e.message, classification: DistributionFailure.classify(e) })
      result.attempts = 1
    }

    result.durationMs = Date.now() - start
    return result
  }
}
