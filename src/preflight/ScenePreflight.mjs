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
    // Close/brand_close scenes are exempt: their keyword IS the CTA and is
    // meant to echo the caption (SUB / "Sub for the next...").
    for (const sc of job.scenes || []) {
      if (sc.type === 'close' || sc.type === 'brand_close') continue
      const focus = String(sc.caption_focus || sc.captionFocus || '').toUpperCase()
      if (!focus) continue
      const headlineText = String(sc.text || sc.subheadline || '').toUpperCase()
      const words = focus.split(/\s+/)
      if (words.some(w => w && headlineText.includes(w))) {
        warnings.push(`HEADLINE_EMPHASIS_DUPLICATE:${sc.type || 'scene'}:${focus}`)
      }
    }

    // TEXT_TOO_SMALL — broadcast minimums: any text layer below 32px on a
    // 1080+ width frame is invisible after compression.
    const width = job?.layout?.width || job?.canvas?.width || 1080
    if (width >= 1080) {
      for (const sc of job.scenes || []) {
        for (const role of ['emphasis', 'headline', 'caption', 'source']) {
          const layout = sc[`${role}Layout`]
          if (layout && layout.fontSize < 32) {
            warnings.push(`TEXT_TOO_SMALL:${role}:${layout.fontSize}px`)
          }
        }
      }
    }

    // TEXT_STACK_COLLISION — no two co-rendered layers above 40% opacity in
    // the same 10% Y-band. Caption and emphasis never co-render (the emphasis
    // layer yields to a visible caption), so only headline-vs-caption is
    // checked when the caption is actually drawn.
    for (const sc of job.scenes || []) {
      const bands = {}
      const coRendered = []
      if (sc.headlineLayout) coRendered.push(['headline', sc.headlineLayout])
      if (sc.captionLayout && sc.caption && sc.captionHidden !== true) coRendered.push(['caption', sc.captionLayout])
      for (const [role, layout] of coRendered) {
        const band = Math.floor(layout.y / 192)
        bands[band] = bands[band] || []
        bands[band].push(role)
        if (bands[band].length > 1) {
          warnings.push(`TEXT_STACK_COLLISION:${bands[band].join('+')}@Y${band * 10}0`)
        }
      }
    }

    return { errors, warnings }
  }
}
