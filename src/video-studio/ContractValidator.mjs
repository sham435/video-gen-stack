const REQUIRED = [
  'story.headline',
  'story.hook',
  'cover.headline',
  'scenes',
  'voice.style',
  'retention.pattern',
]

const SCENE_REQUIRED = ['id', 'duration', 'narration', 'visual_prompt', 'camera', 'emotion']

export class ContractValidator {
  validate(contract) {
    if (!contract || typeof contract !== 'object') {
      return { valid: false, missing: ['contract'], errors: ['contract is not an object'] }
    }

    const missing = REQUIRED.filter(p => !this.get(contract, p))
    const errors = []

    // Scenes must be a non-empty array with required fields
    if (Array.isArray(contract.scenes) && contract.scenes.length > 0) {
      contract.scenes.forEach((s, i) => {
        for (const f of SCENE_REQUIRED) {
          if (s[f] === undefined || s[f] === null || s[f] === '') {
            errors.push(`scenes[${i}].${f} missing`)
          }
        }
      })
      if (contract.scenes.length < 2) errors.push('scenes must contain at least 2 scenes')
    } else if (missing.includes('scenes')) {
      // scenes already flagged missing
    } else {
      errors.push('scenes must be a non-empty array')
    }

    // Voice fields
    if (!contract.voice || typeof contract.voice !== 'object') errors.push('voice must be an object')
    else if (typeof contract.voice.speed !== 'number' || contract.voice.speed <= 0) errors.push('voice.speed must be a positive number')

    // Retention must have a pattern
    if (!contract.retention?.pattern) errors.push('retention.pattern required')

    return {
      valid: missing.length === 0 && errors.length === 0,
      missing,
      errors,
      sceneCount: Array.isArray(contract.scenes) ? contract.scenes.length : 0,
    }
  }

  get(obj, path) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj)
  }
}
