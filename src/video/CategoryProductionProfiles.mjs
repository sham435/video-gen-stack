// Category-specific production profiles — keeps the channel visually diverse
// while maintaining consistent brand identity.
export const CATEGORY_PROFILES = {
  ai: { visual_style: 'futuristic', layout: 'Hero Focus', motion: 'fast zoom', camera: 'push_in', accent: '#00E5FF' },
  technology: { visual_style: 'clean', layout: 'Asymmetric Grid', motion: 'push-in', camera: 'push_in', accent: '#E10600' },
  finance: { visual_style: 'charts + numbers', layout: 'Split Screen', motion: 'slow pan', camera: 'pan', accent: '#FFD700' },
  space: { visual_style: 'cinematic', layout: 'Hero Focus', motion: 'parallax', camera: 'orbit', accent: '#FFFFFF' },
  gaming: { visual_style: 'bold', layout: 'Multi-panel', motion: 'dynamic', camera: 'shake', accent: '#E100FF' },
  politics: { visual_style: 'documentary', layout: 'Magazine Layout', motion: 'subtle', camera: 'stable', accent: '#E10600' },
  health: { visual_style: 'clean & minimal', layout: 'Quote + Hero', motion: 'gentle', camera: 'slow_zoom', accent: '#00FF88' },
  science: { visual_style: 'laboratory', layout: 'Hero Focus', motion: 'slow zoom', camera: 'slow_zoom', accent: '#00E5FF' },
  sports: { visual_style: 'energetic', layout: 'Multi-panel', motion: 'dynamic', camera: 'action_zoom', accent: '#FFD700' },
  default: { visual_style: 'clean', layout: 'Hero Focus', motion: 'push-in', camera: 'push_in', accent: '#E10600' },
}

export class CategoryProductionProfiles {
  static getProfile(category) {
    const key = (category || 'default').toLowerCase()
    return CATEGORY_PROFILES[key] || CATEGORY_PROFILES.default
  }

  static getLayout(category) {
    return this.getProfile(category).layout
  }

  static getCamera(category, sceneType) {
    const prof = this.getProfile(category)
    const sceneCameras = {
      hook: 'push_in', fact: prof.camera, reveal: 'pan', explanation: 'orbit',
      retention: 'shake', close: 'pull_back',
    }
    return sceneCameras[sceneType] || prof.camera
  }

  static getProfiles() { return CATEGORY_PROFILES }
}
