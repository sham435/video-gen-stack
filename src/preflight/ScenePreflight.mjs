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
    return { errors, warnings }
  }
}
