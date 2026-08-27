/**
 * PublicationArtifact — immutable publication unit after RENDER + THUMBNAIL + C2PA.
 * One video, one thumbnail, one metadata set. Consumed by all distribution destinations.
 */

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

export class PublicationArtifact {
  constructor(options = {}) {
    this.artifactId = options.artifactId || null
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
  static fromProductionResults(results, outDir) {
    const videoPath = results.THUMBNAIL?.selected?.videoPath || `${outDir}/final.mp4`
    const thumbnailPath = results.THUMBNAIL?.selected?.path || null

    let thumbnailSha256 = null
    if (thumbnailPath && existsSync(thumbnailPath)) {
      thumbnailSha256 = createHash('sha256').update(readFileSync(thumbnailPath)).digest('hex')
    }

    const article = results.DISCOVER?.article || {}
    return new PublicationArtifact({
      artifactId: results.UNIQUENESS?.assetId || results.UPLOAD?.videoId || null,
      videoPath,
      thumbnailPath,
      thumbnailSha256,
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
      video: { ...this.video },
      thumbnail: { ...this.thumbnail },
      metadata: { ...this.metadata },
      destinations: {
        youtube: { ...this.destinations.youtube },
        githubPages: { ...this.destinations.githubPages },
        linkedin: { ...this.destinations.linkedin },
      },
      createdAt: this.createdAt,
    }
  }

  /** Restore from ledger persistence */
  static fromJSON(data) {
    const a = new PublicationArtifact()
    Object.assign(a, data)
    return a
  }
}
