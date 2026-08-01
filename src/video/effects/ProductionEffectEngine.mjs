// Production Effect Engine — selects Hollywood-style effect pipelines per category.
// Maps each story category to a production plan (visual/motion/audio/virtual layers)
// so the renderer knows which cinematic technology each scene deserves.
export const EFFECT_PROFILES = {
  breaking_news: {
    visual: ['GFX', 'AI-VFX', 'AFX'],
    audio: ['EFX', 'Foley'],
    camera: ['VP'],
  },
  technology: {
    visual: ['CGI', '3DFX', 'NeRF', 'AI-VFX'],
    motion: ['GFX', 'AFX'],
  },
  science: {
    visual: ['3D', 'CGI', 'NeRF', 'VFX'],
    simulation: ['CFX'],
  },
  space: {
    visual: ['CGI', '3DFX', 'VFX', 'NeRF'],
    environment: ['VP'],
  },
  gaming: {
    visual: ['CGI', 'VFX', 'Mocap', 'Facap'],
  },
  finance: {
    visual: ['GFX', 'DataAnimation'],
    audio: ['EFX'],
  },
  health: {
    visual: ['3D', 'CFX', 'CleanMedical'],
    motion: ['GFX'],
  },
  nature: {
    visual: ['CFX', 'VFX', 'NeRF'],
  },
  sports: {
    visual: ['VFX', 'Mocap', 'AFX'],
    motion: ['GFX'],
  },
  default: {
    visual: ['AI-VFX', 'GFX'],
    audio: ['EFX'],
  },
}

const EFFECT_DESCRIPTIONS = {
  CGI: 'computer-generated imagery', '3DFX': '3D effects', NeRF: 'neural radiance environment',
  'AI-VFX': 'AI-generated visual effects', AFX: 'animated effects', GFX: 'graphics/motion GFX',
  VFX: 'visual effects', Mocap: 'motion capture', Facap: 'facial capture', CFX: 'simulation effects',
  VP: 'virtual production', DataAnimation: 'data-driven animation', CleanMedical: 'clinical visualization',
  EFX: 'sound effects', Foley: 'foley sound design',
}

export class ProductionEffectEngine {
  static get(category) {
    return EFFECT_PROFILES[(category || 'default').toLowerCase()] || EFFECT_PROFILES.default
  }

  static buildSceneEffects(scene, category) {
    const profile = this.get(category)
    const describe = (key) => EFFECT_DESCRIPTIONS[key] || key
    return {
      sceneId: scene.id || 0,
      visualPipeline: (profile.visual || []).map(describe),
      motionPipeline: (profile.motion || []).map(describe),
      audioPipeline: (profile.audio || []).map(describe),
      virtualPipeline: (profile.environment || []).map(describe),
      raw: profile,
    }
  }

  static getProfiles() { return EFFECT_PROFILES }
}
