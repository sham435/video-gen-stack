/**
 * GitHubPagesDistributor — generates gallery manifest and copies thumbnail to public/.
 * Consumes PublicationArtifact. Writes deterministic gallery manifest for GitHub Pages.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DistributionState } from './DistributionState.mjs'

export class GitHubPagesDistributor {
  constructor(options = {}) {
    this.publicDir = options.publicDir || 'public'
    this.thumbnailsDir = join(this.publicDir, 'thumbnails')
    this.videosJsonPath = join(this.publicDir, 'videos.json')
  }

  async distribute(artifact, jobContext = {}) {
    const result = {
      destination: 'githubPages',
      state: DistributionState.PENDING,
      deployment: null,
      thumbnailCopied: false,
      manifestUpdated: false,
      attempts: 0,
      errors: [],
      durationMs: 0,
    }

    const start = Date.now()

    try {
      // Ensure directories exist
      if (!existsSync(this.thumbnailsDir)) mkdirSync(this.thumbnailsDir, { recursive: true })

      // Copy canonical thumbnail to public/thumbnails/{artifactId}.png
      const destThumbPath = join(this.thumbnailsDir, `${artifact.artifactId}.png`)
      if (artifact.thumbnail.path && existsSync(artifact.thumbnail.path)) {
        copyFileSync(artifact.thumbnail.path, destThumbPath)
        result.thumbnailCopied = true
      }

      // Read existing manifest
      let manifest = { channelId: 'UC4UC7z16EtqtI-TJzeGZKjQ', updatedAt: new Date().toISOString(), source: 'production-ledger', videos: [] }
      if (existsSync(this.videosJsonPath)) {
        try { manifest = JSON.parse(readFileSync(this.videosJsonPath, 'utf-8')) } catch { /* keep default */ }
      }

      // Upsert entry
      const entry = {
        id: artifact.artifactId,
        youtubeId: artifact.destinations.youtube.videoId || null,
        title: artifact.metadata.title || `Video ${artifact.artifactId}`,
        category: artifact.metadata.category || 'general',
        youtubeUrl: artifact.destinations.youtube.url || null,
        thumbnailUrl: `/thumbnails/${artifact.artifactId}.png`,
        publishedAt: artifact.createdAt,
        publishedLabel: new Date(artifact.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      }

      const existingIdx = manifest.videos.findIndex(v => v.id === artifact.artifactId)
      if (existingIdx >= 0) {
        manifest.videos[existingIdx] = entry
      } else {
        manifest.videos.unshift(entry)
      }

      manifest.updatedAt = new Date().toISOString()
      writeFileSync(this.videosJsonPath, JSON.stringify(manifest, null, 2))

      result.manifestUpdated = true
      result.state = DistributionState.SUCCESS
      result.deployment = 'committed'
      result.attempts = 1
    } catch (e) {
      result.state = DistributionState.FAILED
      result.errors.push({ error: e.message, classification: 'TRANSIENT' })
      result.attempts = 1
    }

    result.durationMs = Date.now() - start
    return result
  }
}
