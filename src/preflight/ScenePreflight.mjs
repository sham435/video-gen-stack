// Stage: scene — scenes must be built and non-empty before scoring/prep.
export class ScenePreflight {
  static async run(job, options = {}) {
    const errors = []
    const warnings = []
    if (!job?.scenes || job.scenes.length === 0) {
      errors.push('SCENE_EMPTY')
    } else if (job.scenes.length < 3) {
      warnings.push('MIN_SCENES')
    }

    // HEADLINE_EMPHASIS_DUPLICATE — the animated keyword should not repeat a
    // word the headline/BREAKING banner already shows (causes visible
    // duplication; the HeadlineEmphasisResolver picks a better keyword).
    for (const sc of job.scenes || []) {
      const focus = String(sc.caption_focus || sc.captionFocus || '').toUpperCase()
      if (!focus) continue
      const headlineText = String(sc.text || sc.subheadline || '').toUpperCase()
      const words = focus.split(/\s+/)
      if (words.some(w => w && headlineText.includes(w))) {
        warnings.push(`HEADLINE_EMPHASIS_DUPLICATE:${sc.type || 'scene'}:${focus}`)
      }
    }

    return { errors, warnings }
  }
}
