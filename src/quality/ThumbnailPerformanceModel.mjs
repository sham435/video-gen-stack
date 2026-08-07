// ThumbnailPerformanceModel — C3: turn extracted thumbnail features into a
// predicted CTR with confidence, plus actionable recommendations.
//
// Cold start is a strict no-op: with no learned samples the model returns
// predictedCTR 0 and confidence 0, so generation is unchanged. Once rollups
// pass the sample + impression gates, per-style / per-family lifts bias the
// prediction and drive recommendations.

import { ThumbnailIntelligence, colorFamily } from '../analytics/ThumbnailIntelligence.mjs'

const EMPTY = {
  predictedCTR: 0,
  confidence: 0,
  learned: false,
  recommendations: [],
}

export class ThumbnailPerformanceModel {
  constructor({ intelligence = null, minSamples = 2, minImpressions = 300 } = {}) {
    this.intelligence = intelligence || new ThumbnailIntelligence()
    this.minSamples = minSamples
    this.minImpressions = minImpressions
  }

  close() { this.intelligence.close() }

  /**
   * Predict CTR for a candidate described by its style + accent color family
   * + extracted features. Returns { predictedCTR, confidence, learned, recs }.
   */
  predict({ style = null, accentColor = null, features = null, headline = '' } = {}) {
    // Tolerate a partial/mock intelligence (e.g. in tests) → cold start.
    let styles, colors, baseline = null
    try {
      styles = this.intelligence.styles(this.minSamples, this.minImpressions)
    } catch { styles = [] }
    try {
      colors = this.intelligence.colorFamilies(this.minSamples, this.minImpressions)
    } catch { colors = [] }
    try { baseline = this.intelligence.baseline() } catch { baseline = null }

    // Cold start: no *gated* rollups means no learnable signal → strict no-op
    // regardless of whether a weak baseline exists.
    if (!styles?.length && !colors?.length) {
      return { ...EMPTY, recommendations: [] }
    }

    const base = baseline || 0
    const styleRow = style ? styles?.find(s => s.style === style) : null
    const styleLift = styleRow?.lift || 0
    const fam = accentColor ? colorFamily(accentColor) : null
    const colorRow = fam ? colors?.find(c => c.family === fam) : null
    const colorLift = colorRow?.lift || 0

    const predictedCTR = Math.max(0, base + styleLift + colorLift)

    // Confidence grows with the max sample count across gated rollups.
    const maxSamples = Math.max(
      0,
      ...(styles || []).map(s => s.samples),
      ...(colors || []).map(c => c.samples),
    )
    const confidence = Math.min(1, maxSamples / 10)

    return {
      predictedCTR: +predictedCTR.toFixed(4),
      confidence: +confidence.toFixed(2),
      learned: confidence > 0,
      recommendations: this._recommend({ styleRow, styleLift, fam, colorRow, colorLift, base, features }),
    }
  }

  _recommend({ style, styleLift, fam, colorLift, base, features }) {
    const recs = []
    const styleRaised = style && styleLift > 0 && fam === null
    if (styleRaised) recs.push(`keep this layout: +${styleLift.toFixed(1)}pp vs baseline`)
    if (fam && colorLift < 0) recs.push(`reduce ${fam} accent color (underperforms)`)
    if (fam && colorLift >= 1) recs.push(`lean into ${fam} accent (+${colorLift.toFixed(1)}pp)`)

    const contrast = features?.colors?.contrast
    if (typeof contrast === 'number' && contrast < 0.4) recs.push('increase headline contrast')
    const wordCount = features?.typography?.wordCount
    if (typeof wordCount === 'number' && wordCount > 5) recs.push('reduce headline to 3 words')
    return recs
  }
}