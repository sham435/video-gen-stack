// ProductionTrace — structured JSON trace for every production run.
//
// Captures the full lifecycle as a single JSON object, emitted at the end
// of generateFromArticle(). No scattered log strings — one structured record.
//
// Shape:
//   {
//     articleId,
//     startedAt,
//     finishedAt,
//     durationMs,
//     niche: { key, source, confidence },
//     profile: "TESLA",
//     thumbnail: { generated, preflight, uploaded, error },
//     youtube: { videoUploaded, videoId, thumbnailUploaded, thumbnailAttempts, lastError },
//     linkedin: { attempted, success, error },
//     provenance: { c2paSigned, c2paVerified, manifestId, error,
//                    signMs, verifyMs, reason, validationState, failures,
//                    gateBlocked, gateReason },
//     render: { frames, durationSec, sizeBytes },
//     status: "published" | "render_failed" | "publish_failed"
//   }

export class ProductionTrace {
  constructor(articleId) {
    this.record = Object.seal({
      articleId: String(articleId || 'unknown'),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      niche: Object.seal({ key: 'GENERAL', source: 'fallback', confidence: 0 }),
      profile: 'GENERAL',
      thumbnail: Object.seal({ generated: false, preflight: 'skipped', uploaded: false, error: null }),
      youtube: Object.seal({ videoUploaded: false, videoId: null, thumbnailUploaded: false, thumbnailAttempts: 0, lastError: null }),
      linkedin: Object.seal({ attempted: false, success: false, error: null }),
      provenance: Object.seal({
        c2paSigned: false, c2paVerified: false, manifestId: null, error: null,
        signMs: null, verifyMs: null, reason: null,
        validationState: null, failures: [],
        gateBlocked: false, gateReason: null,
      }),
      render: Object.seal({ frames: 0, durationSec: 0, sizeBytes: 0 }),
      status: 'pending',
    })
  }

  // ─── niche ──────────────────────────────────────────────────────────────
  setNiche(decision) {
    this.record.niche.key = decision.key
    this.record.niche.source = decision.source
    this.record.niche.confidence = decision.confidence
    this.record.profile = decision.key
  }

  // ─── thumbnail ──────────────────────────────────────────────────────────
  setThumbnailGenerated() { this.record.thumbnail.generated = true }
  setThumbnailPreflight(result) {
    this.record.thumbnail.preflight = result.ready ? 'passed' : 'failed'
    if (!result.ready) this.record.thumbnail.error = result.errors.join('; ')
  }
  setThumbnailUploaded(uploaded, error = null) {
    this.record.thumbnail.uploaded = uploaded
    this.record.thumbnail.error = error
  }

  // ─── youtube ────────────────────────────────────────────────────────────
  setYouTube(result) {
    this.record.youtube.videoUploaded = result.videoUploaded || false
    this.record.youtube.videoId = result.videoId || null
    this.record.youtube.thumbnailUploaded = result.thumbnailUploaded || false
    this.record.youtube.thumbnailAttempts = result.thumbnailAttempts || 0
    this.record.youtube.lastError = result.lastError || null
  }

  // ─── linkedin ───────────────────────────────────────────────────────────
  setLinkedIn({ attempted, success, error }) {
    this.record.linkedin.attempted = attempted
    this.record.linkedin.success = success
    this.record.linkedin.error = error || null
  }

  // ─── provenance ────────────────────────────────────────────────────────
  setProvenance({ signed, verified, manifestId, error, signMs, verifyMs, reason,
                   validationState, failures, gateBlocked, gateReason }) {
    this.record.provenance.c2paSigned = signed || false
    this.record.provenance.c2paVerified = verified || false
    this.record.provenance.manifestId = manifestId || null
    this.record.provenance.error = error || null
    if (signMs != null) this.record.provenance.signMs = signMs
    if (verifyMs != null) this.record.provenance.verifyMs = verifyMs
    if (reason != null) this.record.provenance.reason = reason
    if (validationState != null) this.record.provenance.validationState = validationState
    if (Array.isArray(failures)) this.record.provenance.failures = failures
    if (gateBlocked != null) this.record.provenance.gateBlocked = gateBlocked
    if (gateReason != null) this.record.provenance.gateReason = gateReason
  }

  // ─── render ─────────────────────────────────────────────────────────────
  setRender({ frames, durationSec, sizeBytes }) {
    this.record.render.frames = frames || 0
    this.record.render.durationSec = durationSec || 0
    this.record.render.sizeBytes = sizeBytes || 0
  }

  // ─── finish ─────────────────────────────────────────────────────────────
  finish(status = 'published') {
    this.record.finishedAt = new Date().toISOString()
    this.record.durationMs = new Date(this.record.finishedAt) - new Date(this.record.startedAt)
    this.record.status = status
    return this.toJSON()
  }

  // ─── output ─────────────────────────────────────────────────────────────
  toJSON() {
    return JSON.parse(JSON.stringify(this.record))
  }

  // ─── log ────────────────────────────────────────────────────────────────
  // Emit the trace as a structured log line. Use for production runs.
  emit() {
    const trace = this.toJSON()
    console.log(`[PRODUCTION-TRACE] ${JSON.stringify(trace)}`)
    return trace
  }
}
