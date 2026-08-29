/**
 * PublicationArtifact — immutable publication unit after RENDER + THUMBNAIL + C2PA.
 * One video, one thumbnail, one metadata set. Consumed by all distribution destinations.
 */

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

export class PublicationArtifact {
  constructor(options = {}) {
    this.artifactId = options.artifactId || null
    this.media = {
      type: options.mediaType || 'short',
      width: options.mediaWidth || 2160,
      height: options.mediaHeight || 3840,
      aspectRatio: options.mediaAspectRatio || '9:16',
    }
    this.video = {
      path: options.videoPath || null,
      size: options.videoSize || null,
      duration: options.videoDuration || null,
      youtubeVideoId: null,
    }
    this.thumbnail = {
      path: options.thumbnailPath || null,
      sha256: options.thumbnailSha256 || null,
      width: options.thumbnailWidth || null,
      height: options.thumbnailHeight || null,
      mimeType: options.thumbnailMimeType || null,
      aspectRatio: options.thumbnailAspectRatio || null,
    }
    this.metadata = {
      title: options.title || null,
      description: options.description || null,
      tags: options.tags || [],
      category: options.category || null,
      source: options.source || null,
      categoryKey: options.categoryKey || null,
    }
    this.destinations = {
      youtube: { state: 'PENDING', videoId: null, url: null, thumbnail: { state: 'PENDING', sha256: null } },
      githubPages: { state: 'PENDING', deployment: null },
      linkedin: { state: 'PENDING', postId: null },
    }
    this.createdAt = new Date().toISOString()
  }

  /** Build artifact from production pipeline results */
  static async fromProductionResults(results, outDir) {
    const videoPath = results.THUMBNAIL?.selected?.videoPath || `${outDir}/final.mp4`
    const thumbnailPath = results.THUMBNAIL?.selected?.path || null

    // Canonical thumbnail identity: sha256 + geometry + mime. These flow into
    // destinations and are compared against the remote asset YouTube serves.
    let thumbnailMeta = {
      sha256: null, width: null, height: null, mimeType: null, aspectRatio: null,
    }
    if (thumbnailPath) {
      try {
        const { inspectThumbnailFile } = await import('../thumbnail/ThumbnailMetadata.mjs')
        thumbnailMeta = await inspectThumbnailFile(thumbnailPath)
      } catch (e) {
        // fall back to integrity-only hashing (geometry left null)
        const { createHash } = await import('node:crypto')
        const { readFileSync, existsSync } = await import('node:fs')
        if (existsSync(thumbnailPath)) {
          thumbnailMeta.sha256 = createHash('sha256').update(readFileSync(thumbnailPath)).digest('hex')
        }
        console.warn(`[ARTIFACT] thumbnail metadata fallback: ${e.message}`)
      }
    }

    // The artifact's media contract must reflect what was ACTUALLY rendered,
    // proven by the render engine's RenderProfile — not assumed from the
    // thumbnail or a hardcoded default. If the render profile (and therefore
    // the physical output it produced) is unavailable, fail rather than guess.
    const { resolveRenderProfile } = await import('../video/RenderProfile.mjs')
    const engine = results.RENDER?.engine
    const renderedOutput = engine?.renderProfile?.output
      || resolveRenderProfile(engine?.renderProfile || {}).output
    if (!renderedOutput || !renderedOutput.width || !renderedOutput.height) {
      throw new Error('RENDER_MEDIA_METADATA_MISSING: could not resolve the rendered video geometry')
    }
    const profile = {
      mediaType: engine?.renderProfile?.type === 'video' ? 'video' : 'short',
      width: renderedOutput.width,
      height: renderedOutput.height,
      aspectRatio: engine?.renderProfile?.aspectRatio || `${renderedOutput.width}:${renderedOutput.height}`,
    }

    const article = results.DISCOVER?.article || {}
    return new PublicationArtifact({
      artifactId: results.UNIQUENESS?.assetId || results.UPLOAD?.videoId || null,
      mediaType: profile.mediaType,
      mediaWidth: profile.width,
      mediaHeight: profile.height,
      mediaAspectRatio: profile.aspectRatio,
      videoPath,
      thumbnailPath,
      thumbnailSha256: thumbnailMeta.sha256,
      thumbnailWidth: thumbnailMeta.width,
      thumbnailHeight: thumbnailMeta.height,
      thumbnailMimeType: thumbnailMeta.mimeType,
      thumbnailAspectRatio: thumbnailMeta.aspectRatio,
      title: article.title || 'News Update',
      description: article.description || null,
      tags: article.tags || [],
      category: article.category || null,
      source: article.source || null,
      categoryKey: results.UPLOAD?.nicheDecision?.key || null,
    })
  }

  /** Serialize for ledger persistence */
  toJSON() {
    return {
      artifactId: this.artifactId,
      media: { ...this.media },
      video: { ...this.video },
      thumbnail: { ...this.thumbnail },
      metadata: { ...this.metadata },
      destinations: {
        youtube: { ...this.destinations.youtube, thumbnail: { ...(this.destinations.youtube.thumbnail || {}) } },
        githubPages: { ...this.destinations.githubPages },
        linkedin: { ...this.destinations.linkedin },
      },
      createdAt: this.createdAt,
    }
  }

  /**
   * Propagate the canonical thumbnail identity into every destination that
   * carries the thumbnail, so the ledger never reports sha256:null.
   */
  blessDestinations() {
    const t = this.thumbnail
    const yt = this.destinations.youtube.thumbnail
    yt.sha256 = t.sha256 || yt.sha256 || null
    yt.width = t.width || yt.width || null
    yt.height = t.height || yt.height || null
    yt.mimeType = t.mimeType || yt.mimeType || null
    yt.aspectRatio = t.aspectRatio || yt.aspectRatio || null
    return this
  }

  /** Restore from ledger persistence */
  static fromJSON(data) {
    const a = new PublicationArtifact()
    Object.assign(a, data)
    return a
  }
}
