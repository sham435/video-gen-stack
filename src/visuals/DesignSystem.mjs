import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { UIStyleSelector } from '../ai/UIStyleSelector.mjs'
import { RenderProfiles, DEFAULT_PROFILE } from '../video/RenderProfile.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const colors = JSON.parse(readFileSync(join(__dirname, '../../design-system/tokens/colors.json'), 'utf-8'))
const typography = JSON.parse(readFileSync(join(__dirname, '../../design-system/tokens/typography.json'), 'utf-8'))

const styleSelector = new UIStyleSelector()

// The DesignSystem is the SINGLE source of truth for the LOGICAL composition
// canvas. Every visual/layout component reads W/H/dimensions from here, so the
// whole stack is aspect-aware by construction. `setProfile` lets the video
// engine pin the active RenderProfile (SHORT_4K -> 1080x1920, VIDEO_HD ->
// 1280x720) BEFORE any frame is composed; nothing should hardcode 1080x1920.
//
// W/H/sx/sy are LIVE GETTERS that always reflect the active profile. This is
// important: components are statically imported (module load) but the profile
// is only pinned at ENGINE CONSTRUCTION (runtime), so a module-scope `const =
// DesignSystem.W` would freeze the SHORT default. Always read them INSIDE the
// draw function: `const { W, H, sx, sy } = DesignSystem`.
export class DesignSystem {
  static _profile = DEFAULT_PROFILE

  /** Pin the active render profile; logical canvas dims follow it. */
  static setProfile(profile = DEFAULT_PROFILE) {
    this._profile = profile
    return this
  }

  static get profile() {
    return this._profile
  }

  static get W() {
    return this._profile.logical.width
  }

  static get H() {
    return this._profile.logical.height
  }

  /** Scale a 1080px-design-width value into the active logical canvas. */
  static get sx() {
    const base = 1080
    return (v) => (v / base) * this.W
  }

  /** Scale a 1920px-design-height value into the active logical canvas. */
  static get sy() {
    const base = 1920
    return (v) => (v / base) * this.H
  }

  static get sf() {
    return (v) => (v / 1080) * Math.min(this.W, this.H * (1080 / 1920))
  }

  static get dimensions() {
    return { W: this.W, H: this.H, centerX: this.W / 2, centerY: this.H / 2 }
  }

  static get brand() {
    return colors.brand
  }

  static getCategoryStyle(category) {
    const catColors = colors.categories[category] || colors.categories.technology
    const catStyle = styleSelector.getStyle(category)
    return {
      ...catStyle,
      colors: {
        primary: catColors.primary,
        secondary: catColors.secondary,
        accent: catStyle.colors.accent || colors.brand.accent,
        background: catColors.bg,
        text: '#FFFFFF',
      },
    }
  }

  static getCategoryColors(category) {
    return colors.categories[category] || colors.categories.technology
  }

  static getSemantic(type) {
    return colors.semantic[type] || colors.semantic.info
  }

  static getTypography(token, variant) {
    const group = typography[token]
    if (!group) return { font: 'Inter', weight: 600, size: 42 }
    return {
      font: group.font,
      weight: group.weight,
      size: group.sizes[variant] || Object.values(group.sizes)[0],
    }
  }

  static getLineHeight(token) {
    return typography.spacing?.lineHeight?.[token] || 1.3
  }

  static getMaxChars(token) {
    return typography.spacing?.maxCharsPerLine?.[token] || 22
  }

  static get glass() {
    return {
      background: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.1)',
      hoverBg: 'rgba(255,255,255,0.1)',
      radius: 8,
      blur: 12,
      padding: { x: 16, y: 12 },
      backdrop: 'rgba(0,0,0,0.6)',
    }
  }

  static getMotionPreset(category) {
    return styleSelector.getStyle(category)?.motion || {
      default: 'push_in',
      transition: 'fade',
      camera: 'zoom',
    }
  }

  static get spacing() {
    return {
      safeArea: { top: 60, bottom: 60, left: 40, right: 40 },
      banner: { top: 0.15, height: 300 },
      caption: { y: 0.78 },
      ticker: { y: 0.92, height: 50, margin: 20 },
      card: { padding: 24, gap: 12 },
      grid: 50,
    }
  }

  static get overlayDefaults() {
    return {
      live: { label: 'LIVE', position: { top: 20, right: 20 }, pulse: true },
      category: { position: { top: 20, left: 20 } },
      source: { position: { bottom: 80, left: 40 } },
      timestamp: { position: { bottom: 80, right: 40 } },
      confidence: { position: { bottom: 100, right: 40 } },
    }
  }

  static getComponent(componentName, options = {}) {
    const components = {
      BreakingBanner: {
        height: 300,
        y: 0.15,
        titleSize: 120,
        subtitleSize: 72,
        glowRadius: 400,
      },
      HeadlineCard: {
        maxChars: 10,
        scaleIn: [0.7, 1.0],
        staggerLines: true,
      },
      DynamicCaption: {
        maxWordsPerLine: 3,
        fontSize: 52,
        lineHeight: 1.6,
        bgAlpha: 0.75,
      },
      NewsTicker: {
        height: 50,
        y: 0.92,
        itemCount: 4,
        itemWidth: 0.25,
      },
      DataPanel: {
        width: 0.85,
        y: 0.15,
      },
      ImageFrame: {
        width: 0.85,
        height: 0.5,
        radius: 12,
        borderWidth: 1,
      },
      AnchorBadge: {
        size: 48,
        margin: 16,
      },
      LogoAnimation: {
        scale: [0.5, 1.0],
        glow: true,
      },
      SubscribeOverlay: {
        width: 400,
        height: 80,
        y: 0.65,
        pulse: true,
      },
    }
    return components[componentName] || null
  }
}