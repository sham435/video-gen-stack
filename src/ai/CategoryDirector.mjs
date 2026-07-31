import { DesignSystem } from '../visuals/DesignSystem.mjs'

const DIRECTORS = {
  gaming: {
    layout: {
      hook: { heroSize: 0.7, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.5, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.4, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.6, textPosition: 'center', glassCard: false, borderPulse: true },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'orbit', speed: 1.3, shake: false, zoomRange: [1.0, 1.06] },
    caption: { maxWords: 3, fontSize: 48, y: 0.75, glowColor: '#E100FF' },
    colorGrade: { saturation: 1.3, contrast: 1.1, warmth: 0.5 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: false, scanlines: true, pixelBorder: true },
    animation: { textReveal: 'glitch', logoIntro: 'pixelate' },
    audio: { musicProfile: 'energetic', sfxProfile: '8bit' },
  },
  ai: {
    layout: {
      hook: { heroSize: 0.75, textPosition: 'center', glassCard: false, glitchStart: true },
      fact: { heroSize: 0.55, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.45, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.65, textPosition: 'center', glassCard: false, holographic: true },
      brand_close: { heroSize: 0.35, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'orbit', speed: 0.9, shake: false, zoomRange: [1.0, 1.04] },
    caption: { maxWords: 3, fontSize: 48, y: 0.76, glowColor: '#00E5FF' },
    colorGrade: { saturation: 1.2, contrast: 1.15, warmth: 0.4 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, dataGrid: true, hologram: true },
    animation: { textReveal: 'holographic', logoIntro: 'fade' },
    audio: { musicProfile: 'cinematic_tech', sfxProfile: 'digital' },
  },
  robotics: {
    layout: {
      hook: { heroSize: 0.7, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.5, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.4, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.6, textPosition: 'center', glassCard: true, borderPulse: true },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'push_in', speed: 1.1, shake: false, zoomRange: [1.0, 1.05] },
    caption: { maxWords: 3, fontSize: 50, y: 0.76, glowColor: '#FF6B00' },
    colorGrade: { saturation: 1.25, contrast: 1.2, warmth: 0.6 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, hud: true, mechanicalGrid: true },
    animation: { textReveal: 'mechanical', logoIntro: 'slide' },
    audio: { musicProfile: 'industrial', sfxProfile: 'mechanical' },
  },
  cybersecurity: {
    layout: {
      hook: { heroSize: 0.7, textPosition: 'center', glassCard: false, glitchStart: true },
      fact: { heroSize: 0.5, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.4, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.6, textPosition: 'center', glassCard: false, borderPulse: true },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'shake', speed: 1.5, shake: true, zoomRange: [1.0, 1.07] },
    caption: { maxWords: 2, fontSize: 44, y: 0.74, glowColor: '#00FF41' },
    colorGrade: { saturation: 1.1, contrast: 1.3, warmth: 0.2 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, matrixRain: true, terminal: true },
    animation: { textReveal: 'glitch', logoIntro: 'glitch' },
    audio: { musicProfile: 'cyber_threat', sfxProfile: 'digital_alert' },
  },
  space: {
    layout: {
      hook: { heroSize: 0.8, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.6, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.5, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.7, textPosition: 'center', glassCard: false, starfield: true },
      brand_close: { heroSize: 0.4, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'slow_zoom', speed: 0.5, shake: false, zoomRange: [1.0, 1.03] },
    caption: { maxWords: 3, fontSize: 46, y: 0.77, glowColor: '#FFFFFF' },
    colorGrade: { saturation: 1.0, contrast: 1.2, warmth: 0.3 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, starfield: true, orbitLines: true },
    animation: { textReveal: 'float', logoIntro: 'glow' },
    audio: { musicProfile: 'epic_cinematic', sfxProfile: 'whoosh' },
  },
  sports: {
    layout: {
      hook: { heroSize: 0.75, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.55, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.45, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.65, textPosition: 'center', glassCard: false, borderPulse: true },
      brand_close: { heroSize: 0.35, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'fast_pan', speed: 1.8, shake: false, zoomRange: [1.0, 1.08] },
    caption: { maxWords: 4, fontSize: 52, y: 0.76, glowColor: '#FFD700' },
    colorGrade: { saturation: 1.4, contrast: 1.15, warmth: 0.7 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, scoreboard: true, flash: true },
    animation: { textReveal: 'impact', logoIntro: 'zoom' },
    audio: { musicProfile: 'energetic_stadium', sfxProfile: 'crowd_roar' },
  },
  politics: {
    layout: {
      hook: { heroSize: 0.65, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.45, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.35, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.55, textPosition: 'center', glassCard: false },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'slow_push', speed: 0.7, shake: false, zoomRange: [1.0, 1.03] },
    caption: { maxWords: 4, fontSize: 48, y: 0.75, glowColor: '#E10600' },
    colorGrade: { saturation: 0.9, contrast: 1.1, warmth: 0.5 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, mapOverlay: true, chart: true },
    animation: { textReveal: 'fade', logoIntro: 'fade' },
    audio: { musicProfile: 'professional_news', sfxProfile: 'alert' },
  },
  science: {
    layout: {
      hook: { heroSize: 0.7, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.5, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.4, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.6, textPosition: 'center', glassCard: false },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'slow_zoom', speed: 0.6, shake: false, zoomRange: [1.0, 1.03] },
    caption: { maxWords: 3, fontSize: 46, y: 0.76, glowColor: '#00E5FF' },
    colorGrade: { saturation: 1.0, contrast: 1.15, warmth: 0.35 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, dataGrid: true, chart: true },
    animation: { textReveal: 'float', logoIntro: 'glow' },
    audio: { musicProfile: 'discovery', sfxProfile: 'whoosh' },
  },
  biotech: {
    layout: {
      hook: { heroSize: 0.7, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.5, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.4, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.6, textPosition: 'center', glassCard: false },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'slow_zoom', speed: 0.65, shake: false, zoomRange: [1.0, 1.03] },
    caption: { maxWords: 3, fontSize: 46, y: 0.76, glowColor: '#00FF88' },
    colorGrade: { saturation: 1.05, contrast: 1.1, warmth: 0.4 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, dnaHelix: true, dataGrid: true },
    animation: { textReveal: 'float', logoIntro: 'glow' },
    audio: { musicProfile: 'discovery', sfxProfile: 'whoosh' },
  },
  programming: {
    layout: {
      hook: { heroSize: 0.65, textPosition: 'center', glassCard: false, codeRain: true },
      fact: { heroSize: 0.45, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.35, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.55, textPosition: 'center', glassCard: false, terminal: true },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'push_in', speed: 0.9, shake: false, zoomRange: [1.0, 1.04] },
    caption: { maxWords: 3, fontSize: 44, y: 0.75, glowColor: '#00E5FF' },
    colorGrade: { saturation: 1.15, contrast: 1.2, warmth: 0.35 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, codeEditor: true, terminal: true },
    animation: { textReveal: 'typewriter', logoIntro: 'slide' },
    audio: { musicProfile: 'tech_beats', sfxProfile: 'keyboard' },
  },
  quantum: {
    layout: {
      hook: { heroSize: 0.7, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.5, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.4, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.6, textPosition: 'center', glassCard: false, particleField: true },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'orbit', speed: 0.7, shake: false, zoomRange: [1.0, 1.04] },
    caption: { maxWords: 3, fontSize: 46, y: 0.76, glowColor: '#E100FF' },
    colorGrade: { saturation: 1.3, contrast: 1.2, warmth: 0.25 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, quantumGrid: true, particles: true },
    animation: { textReveal: 'glitch', logoIntro: 'fade' },
    audio: { musicProfile: 'ambient_sci_fi', sfxProfile: 'digital' },
  },
  technology: {
    layout: {
      hook: { heroSize: 0.7, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.5, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.4, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.6, textPosition: 'center', glassCard: false, borderPulse: true },
      brand_close: { heroSize: 0.3, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'push_in', speed: 1.0, shake: false, zoomRange: [1.0, 1.05] },
    caption: { maxWords: 3, fontSize: 52, y: 0.76, glowColor: '#00E5FF' },
    colorGrade: { saturation: 1.2, contrast: 1.15, warmth: 0.45 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, techGrid: true, scanlines: true },
    animation: { textReveal: 'scale', logoIntro: 'zoom' },
    audio: { musicProfile: 'cinematic_tech', sfxProfile: 'impact' },
  },
  lifestyle: {
    layout: {
      hook: { heroSize: 0.75, textPosition: 'center', glassCard: false },
      fact: { heroSize: 0.55, textPosition: 'bottom', glassCard: true, accentLine: true },
      explanation: { heroSize: 0.45, textPosition: 'bottom', glassCard: true },
      retention: { heroSize: 0.65, textPosition: 'center', glassCard: false, bokeh: true },
      brand_close: { heroSize: 0.35, textPosition: 'center', glassCard: true },
    },
    camera: { default: 'smooth_pan', speed: 0.7, shake: false, zoomRange: [1.0, 1.03] },
    caption: { maxWords: 3, fontSize: 44, y: 0.77, glowColor: '#FF6B9D' },
    colorGrade: { saturation: 1.25, contrast: 1.05, warmth: 0.65 },
    overlays: { liveBadge: true, categoryTag: true, sourceTag: true, bokeh: true, minimal: true },
    animation: { textReveal: 'float', logoIntro: 'glow' },
    audio: { musicProfile: 'upbeat_modern', sfxProfile: 'whoosh' },
  },
}

export class CategoryDirector {
  constructor(category) {
    this.category = category || 'technology'
    this.config = DIRECTORS[this.category] || DIRECTORS.technology
  }

  getLayout(sceneType) {
    return this.config.layout[sceneType] || this.config.layout.fact
  }

  getCamera() {
    return { ...this.config.camera }
  }

  getCaption() {
    return { ...this.config.caption }
  }

  getColorGrade() {
    return { ...this.config.colorGrade }
  }

  getOverlays() {
    return { ...this.config.overlays }
  }

  getAnimation() {
    return { ...this.config.animation }
  }

  getAudio() {
    return { ...this.config.audio }
  }

  applyToScene(scene) {
    const layout = this.getLayout(scene.type)
    return {
      ...scene,
      directorLayout: layout,
      directorCamera: this.getCamera(),
      directorCaption: this.getCaption(),
      directorColorGrade: this.getColorGrade(),
      directorOverlays: this.getOverlays(),
      directorAnimation: this.getAnimation(),
    }
  }

  static getDirector(category) {
    return new CategoryDirector(category)
  }
}

export function getDirector(category) {
  return new CategoryDirector(category)
}

export const CATEGORY_DIRECTORS = DIRECTORS