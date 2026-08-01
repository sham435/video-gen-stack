import { ArticlePreflight } from '../preflight/ArticlePreflight.mjs'
import { ScenePreflight } from '../preflight/ScenePreflight.mjs'
import { RenderPreflight } from '../preflight/RenderPreflight.mjs'
import { PublishPreflight } from '../preflight/PublishPreflight.mjs'

// Stage-based preflight registry — each pipeline stage owns its own
// validator (src/preflight/*.mjs). Callers declare the stage they are
// entering; the API is frozen at { stage } — no flags.
//
//   stage: 'article'  → article + category present
//   stage: 'scene'    → scenes built and non-empty (MIN_SCENES warning)
//   stage: 'render'   → ffmpeg, output writable, narration (warning)
//   stage: 'publish'  → video exists, YouTube credentials (warning)
//
// Output: [Preflight:ARTICLE] PASS / BLOCKED: REASON
const VALIDATORS = {
  article: ArticlePreflight,
  scene: ScenePreflight,
  render: RenderPreflight,
  publish: PublishPreflight,
}

export class ProductionPreflight {
  static STAGES = Object.keys(VALIDATORS)

  static async check(job, options = {}) {
    // Backward compat: expectScenes: true → stage 'scene'
    let stage = options.stage || (options.expectScenes ? 'scene' : 'article')
    if (!VALIDATORS[stage]) stage = 'article'

    const { errors, warnings } = await VALIDATORS[stage].run(job, options)
    const ready = errors.length === 0
    const label = stage.toUpperCase()
    const warning = warnings.length ? ` (warning: ${warnings.join(', ')})` : ''
    console.log(`[Preflight:${label}] ${ready ? 'PASS' : `BLOCKED: ${errors.join(', ')}`}${warning}`)

    return {
      stage,
      ready,
      errors,
      warnings,
      summary: `${errors.length} errors, ${warnings.length} warnings`,
    }
  }
}
