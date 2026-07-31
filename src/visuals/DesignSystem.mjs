import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { UIStyleSelector } from '../ai/UIStyleSelector.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const colors = JSON.parse(readFileSync(join(__dirname, '../../design-system/tokens/colors.json'), 'utf-8'))
const typography = JSON.parse(readFileSync(join(__dirname, '../../design-system/tokens/typography.json'), 'utf-8'))

const styleSelector = new UIStyleSelector()

export class DesignSystem {
  static W = 1080
  static H = 1920

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