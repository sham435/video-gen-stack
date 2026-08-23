// ThumbnailManifest — production artifact manifest for thumbnails.
//
// Records the full lifecycle of thumbnail production: candidates,
// selection, upload, verification. Single source of truth for the
// production trace.

import fs from 'node:fs'
import path from 'node:path'

export class ThumbnailManifest {
  constructor(productionId) {
    this.productionId = productionId || `prod_${Date.now()}`
    this.record = {
      productionId: this.productionId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      candidates: [],
      selected: null,
      strategy: null,
      youtube: {
        uploaded: false,
        verified: false,
        videoId: null,
        thumbnailUrl: null,
        error: null,
      },
      web: {
        path: null,
        synced: false,
      },
      c2pa: {
        signed: false,
        verified: false,
        manifestId: null,
      },
    }
  }

  setCandidate(candidate) {
    this.record.candidates.push({
      id: candidate.id,
      strategy: candidate.strategy,
      hookScore: candidate.hookScore || 0,
      visualScore: candidate.visualScore || 0,
      textScore: candidate.textScore || 0,
      compositeScore: candidate.compositeScore || 0,
      eligible: candidate.eligible || false,
      path: candidate.path || null,
    })
  }

  setCandidates(candidates) {
    this.record.candidates = candidates.map(c => ({
      id: c.id,
      strategy: c.strategy,
      hookScore: c.hookScore || 0,
      visualScore: c.visualScore || 0,
      textScore: c.textScore || 0,
      compositeScore: c.compositeScore || 0,
      eligible: c.eligible || false,
      path: c.path || null,
    }))
  }

  setSelected(winner) {
    if (!winner) return
    this.record.selected = {
      path: winner.path,
      strategy: winner.strategy,
      compositeScore: winner.compositeScore,
      width: winner.policy?.meta?.width || 0,
      height: winner.policy?.meta?.height || 0,
      aspectRatio: '16:9',
    }
    this.record.strategy = winner.strategy
  }

  setYouTube({ uploaded, verified, videoId, thumbnailUrl, error }) {
    this.record.youtube.uploaded = uploaded || false
    this.record.youtube.verified = verified || false
    this.record.youtube.videoId = videoId || null
    this.record.youtube.thumbnailUrl = thumbnailUrl || null
    this.record.youtube.error = error || null
  }

  setWeb({ path: webPath, synced }) {
    this.record.web.path = webPath || null
    this.record.web.synced = synced || false
  }

  setC2PA({ signed, verified, manifestId }) {
    this.record.c2pa.signed = signed || false
    this.record.c2pa.verified = verified || false
    this.record.c2pa.manifestId = manifestId || null
  }

  finish(status = 'completed') {
    this.record.finishedAt = new Date().toISOString()
    this.record.status = status
    return this.toJSON()
  }

  toJSON() {
    return JSON.parse(JSON.stringify(this.record))
  }

  save(outputDir) {
    const outPath = path.join(outputDir, 'thumbnail-manifest.json')
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, JSON.stringify(this.toJSON(), null, 2))
    return outPath
  }

  emit() {
    console.log(`[THUMBNAIL-MANIFEST] ${JSON.stringify(this.toJSON())}`)
    return this.toJSON()
  }
}
