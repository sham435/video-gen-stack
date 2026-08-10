import { SocialDistributionStore } from './SocialDistributionStore.mjs'
import { SocialPostGenerator } from './SocialPostGenerator.mjs'
import { LinkedInPublisher } from './LinkedInPublisher.mjs'
import { YouTubeCommunityPublisher } from './YouTubeCommunityPublisher.mjs'

// SocialDistributionManager — post-publish distribution layer.
//
// Receives a successful published-video result and dispatches the promotional
// post to each platform independently:
//   LinkedIn promotional post (image/text)
//   YouTube Community post (official API unsupported -> manual queue)
//
// Rules:
//   - runs ONLY after the video is confirmed published on YouTube
//   - one platform failure never fails the video publication or other platforms
//   - idempotent per (videoId, platform, distributionType) via the DB UNIQUE
//     constraint — a restarted worker cannot double-post
//   - persists status: pending | publishing | published | failed | unsupported

const DISTRIBUTION_TYPE = 'promotional_post'

export class SocialDistributionManager {
  constructor({ store = null, generator = null, linkedIn = null, youtubeCommunity = null } = {}) {
    this.store = store || new SocialDistributionStore()
    this.generator = generator || new SocialPostGenerator()
    this.linkedIn = linkedIn || new LinkedInPublisher()
    this.youtubeCommunity = youtubeCommunity || new YouTubeCommunityPublisher()
  }

  /** Close the store (only when we own it — tests pass their own). */
  close() {
    try { this.store.close?.() } catch {}
  }

  /**
   * Distribute a successfully published video to all social platforms.
   * video: { videoId, title, videoUrl, thumbnailPath, category, hook, summary }
   * Returns { videoId, results: { linkedin, 'youtube-community' } } — never
   * throws for a platform failure; the VIDEO publish is untouched.
   */
  async distribute(video) {
    if (!video?.videoId) throw new Error('SocialDistributionManager: videoId required')

    const post = this.generator.build(video)
    post.thumbnailPath = post.thumbnailPath || video.thumbnailPath || null
    // Platform payloads reuse the shared post metadata.
    post.platforms.linkedin.thumbnailPath = post.thumbnailPath
    post.platforms.youtubeCommunity.thumbnailPath = post.thumbnailPath

    const results = {}
    results.linkedin = await this._dispatchPlatform({
      platform: 'linkedin',
      videoId: video.videoId,
      post: post.platforms.linkedin,
      publish: () => this.linkedIn.publish({ videoId: video.videoId, post: post.platforms.linkedin }),
    })
    results['youtube-community'] = await this._dispatchPlatform({
      platform: 'youtube-community',
      videoId: video.videoId,
      post: post.platforms.youtubeCommunity,
      publish: () => this.youtubeCommunity.publish({ videoId: video.videoId, post: post.platforms.youtubeCommunity }),
    })
    return { videoId: video.videoId, results }
  }

  /** Idempotent per-platform dispatch with status persistence. */
  async _dispatchPlatform({ platform, videoId, post, publish }) {
    const row = this.store.begin({ videoId, platform, distributionType: DISTRIBUTION_TYPE, payload: post })

    // Already final on this video? Never re-publish.
    if (row.status === 'published') {
      return { platform, status: 'published', postId: row.post_id, url: row.post_url, duplicate: true }
    }
    if (row.status === 'unsupported') {
      return { platform, status: 'unsupported', reason: row.error, queued: true }
    }
    if (row.status === 'failed') {
      // Clear the failed state and retry this run (fresh decision).
      this.store.markPending(videoId, platform, DISTRIBUTION_TYPE)
    }
    if (row.status === 'publishing') {
      // A concurrent worker owns it; treat as duplicate safe-return.
      return { platform, status: 'publishing', postId: null }
    }

    const claimed = this.store.claim(videoId, platform, DISTRIBUTION_TYPE)
    if (!claimed) {
      // Concurrent claim lost — the winner's row exists.
      const cur = this.store.get(videoId, platform, DISTRIBUTION_TYPE)
      return {
        platform,
        status: cur?.status || 'skipped',
        postId: cur?.post_id || null,
        url: cur?.post_url || null,
        duplicate: cur?.status === 'published',
      }
    }

    try {
      const result = await publish()
      if (result.status === 'published' && result.postId) {
        const url = result.url || (result.postId ? `https://www.linkedin.com/feed/update/${result.postId}` : null)
        this.store.markPublished(videoId, platform, DISTRIBUTION_TYPE, { postId: result.postId, postUrl: url })
        return { platform, status: 'published', postId: result.postId, url }
      }
      if (result.status === 'unsupported') {
        this.store.markUnsupported(videoId, platform, DISTRIBUTION_TYPE, result.reason || 'unsupported')
        return { platform, status: 'unsupported', reason: result.reason, queued: result.queued }
      }
      if (result.status === 'skipped') {
        this.store.markSkipped(videoId, platform, DISTRIBUTION_TYPE, result.reason || 'skipped')
        return { platform, status: 'skipped', reason: result.reason }
      }
      // failed (or unknown)
      this.store.markFailed(videoId, platform, DISTRIBUTION_TYPE, result.error || result.reason || 'distribution failed')
      return { platform, status: 'failed', error: result.error || result.reason }
    } catch (e) {
      this.store.markFailed(videoId, platform, DISTRIBUTION_TYPE, e.message)
      return { platform, status: 'failed', error: e.message }
    }
  }
}