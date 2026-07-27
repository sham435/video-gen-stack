import { createCanvas, loadImage } from '@napi-rs/canvas'
import { drawBreakingBanner, drawGlitchOverlay } from '../visuals/BreakingBanner.mjs'
import { drawHeadlineCard } from '../visuals/HeadlineCard.mjs'
import { drawNewsTicker } from '../visuals/NewsTicker.mjs'
import { drawDataPanel } from '../visuals/DataPanel.mjs'
import { drawImageFrame } from '../visuals/ImageFrame.mjs'
import { drawAnchorBadge } from '../visuals/AnchorBadge.mjs'
import { drawLogoAnimation } from '../visuals/LogoAnimation.mjs'
import { renderCaptions } from './CaptionEngine.mjs'
import { applyMotionEffect, applyDefaultEffects } from './MotionEngine.mjs'

const W = 1080, H = 1920

const COLORS = {
  primary: '#E10600',
  secondary: '#00E5FF',
  background: '#050505',
  text: '#FFFFFF',
  glass: 'rgba(255,255,255,0.06)',
  glassBorder: 'rgba(255,255,255,0.1)',
}

function drawBackground(ctx, theme = 'dark') {
  const grad = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, W * 0.8)
  grad.addColorStop(0, '#0D0D0D')
  grad.addColorStop(0.5, '#080808')
  grad.addColorStop(1, COLORS.background)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.03)'
  ctx.lineWidth = 0.5
  for (let x = 0; x < W; x += 50) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = 0; y < H; y += 50) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
}

export class SceneEngine {
  constructor(config) {
    this.config = config
    this.imageCache = {}
  }

  async loadImage(url) {
    if (this.imageCache[url]) return this.imageCache[url]
    try {
      const img = await loadImage(url)
      this.imageCache[url] = img
      return img
    } catch {
      return null
    }
  }

  async renderSceneFrame(scene, progress, wordTimings, wordIndex) {
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')

    applyMotionEffect(ctx, 'camera_shake', progress)

    drawBackground(ctx)

    switch (scene.type) {
      case 'hook':
        await this.renderHookScene(ctx, scene, progress)
        break
      case 'fact':
        await this.renderFactScene(ctx, scene, progress)
        break
      case 'explanation':
        await this.renderExplanationScene(ctx, scene, progress)
        break
      case 'retention':
        await this.renderRetentionScene(ctx, scene, progress)
        break
      case 'brand_close':
        await this.renderBrandClose(ctx, scene, progress)
        break
    }

    if (scene.caption && scene.type !== 'hook') {
      renderCaptions(ctx, scene.caption, wordIndex, progress)
    }

    if (scene.effect) {
      applyMotionEffect(ctx, scene.effect, progress)
    }

    applyDefaultEffects(ctx, progress)

    this.drawWatermark(ctx)

    return canvas.toBuffer('image/png')
  }

  async renderHookScene(ctx, scene, progress) {
    drawBreakingBanner(ctx, scene.subheadline || scene.text, progress)

    ctx.save()
    ctx.font = '900 28px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tp = Math.min(1, progress * 3)
    ctx.globalAlpha = tp
    ctx.fillText('TECH-MONSTER EXCLUSIVE', W / 2, H * 0.52)
    ctx.restore()

    applyMotionEffect(ctx, 'particle_burst', progress)
    drawGlitchOverlay(ctx, progress)

    const countdownP = Math.max(0, 1 - progress * 0.5)
    if (countdownP > 0) {
      ctx.save()
      ctx.globalAlpha = countdownP * 0.15
      ctx.fillStyle = '#E10600'
      ctx.beginPath()
      ctx.arc(W / 2, H / 2, 300 * (1 + (1 - countdownP) * 2), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  async renderFactScene(ctx, scene, progress) {
    const p = Math.min(1, progress * 1.5)
    const words = scene.text.split(' ')
    const fontSize = scene.text.length > 8 ? 110 : 140
    const lineH = fontSize * 1.1
    const totalH = lineH
    const startY = H / 2 - totalH / 2

    ctx.save()
    ctx.globalAlpha = p
    const scale = 0.7 + p * 0.3
    ctx.translate(W / 2, H / 2)
    ctx.scale(scale, scale)
    ctx.translate(-W / 2, -H / 2)

    ctx.font = `900 ${fontSize}px Anton, Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#E10600'
    ctx.shadowBlur = 20 * (1 - p * 0.5)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(scene.text, W / 2, startY)
    ctx.shadowBlur = 0

    if (scene.text.includes('\n')) {
      const parts = scene.text.split('\n')
      parts.forEach((part, i) => {
        ctx.fillText(part, W / 2, startY + (i - (parts.length - 1) / 2) * lineH)
      })
    }

    ctx.restore()
  }

  async renderExplanationScene(ctx, scene, progress) {
    const textWidth = W * 0.85
    const startX = W / 2 - textWidth / 2

    const heading = scene.text.split('.')[0]
    ctx.save()
    ctx.globalAlpha = Math.min(1, progress * 2)
    ctx.font = '700 36px Inter, sans-serif'
    ctx.fillStyle = '#00E5FF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const hp = Math.min(1, progress * 2)
    ctx.globalAlpha = hp
    ctx.fillText('WHY IT MATTERS', startX, H * 0.15)
    ctx.fillStyle = '#E10600'
    ctx.fillRect(startX, H * 0.15 + 40, 60, 3)
    ctx.restore()

    ctx.save()
    const bodyP = Math.min(1, Math.max(0, (progress - 0.1) / 0.4))
    ctx.globalAlpha = bodyP

    const body = scene.text.replace(heading + '. ', '')
    ctx.font = '500 28px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    const maxChars = 35
    const words = body.split(' ')
    let line = ''
    let lineY = H * 0.18 + 60
    for (const w of words) {
      if ((line + ' ' + w).trim().length <= maxChars) line += (line ? ' ' : '') + w
      else {
        ctx.fillText(line, startX, lineY)
        line = w
        lineY += 38
      }
    }
    if (line) ctx.fillText(line, startX, lineY)
    ctx.restore()
  }

  async renderRetentionScene(ctx, scene, progress) {
    const p = Math.min(1, progress * 1.2)

    ctx.fillStyle = `rgba(5, 5, 5, ${p * 0.5})`
    ctx.fillRect(0, H * 0.1, W, H * 0.8)

    const pulse = 0.5 + Math.sin(progress * 8) * 0.3
    ctx.strokeStyle = `rgba(225, 6, 0, ${0.15 * pulse})`
    ctx.lineWidth = 1
    ctx.strokeRect(W * 0.03, H * 0.12, W * 0.94, H * 0.76)

    ctx.save()
    const tp = Math.min(1, (progress - 0.05) / 0.3)
    ctx.globalAlpha = tp
    ctx.font = '700 26px Inter, sans-serif'
    ctx.fillStyle = '#E10600'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const alertPulse = 0.4 + Math.sin(progress * 12) * 0.3
    ctx.fillStyle = `rgba(225, 6, 0, ${alertPulse})`
    ctx.beginPath()
    ctx.arc(W / 2 - 100, H * 0.20, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText('BREAKING ANALYSIS', W / 2, H * 0.20)
    ctx.restore()

    ctx.save()
    const bp = Math.min(1, Math.max(0, (progress - 0.15) / 0.3))
    ctx.globalAlpha = bp
    const scale = 0.85 + bp * 0.15
    ctx.translate(W / 2, H * 0.50)
    ctx.scale(scale, scale)

    ctx.font = '700 36px Inter, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(scene.text, 0, 0)
    ctx.restore()
  }

  async renderBrandClose(ctx, scene, progress) {
    const p = Math.min(1, progress * 1.5)

    drawLogoAnimation(ctx, p)

    const ctaP = Math.min(1, Math.max(0, (p - 0.2) / 0.3))
    if (ctaP > 0) {
      ctx.save()
      ctx.globalAlpha = ctaP
      ctx.font = '500 22px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(scene.caption || 'Follow for daily AI & tech breakthroughs', W / 2, H * 0.50)
      ctx.restore()
    }

    drawAnchorBadge(ctx, 'sham435', Math.max(0, p - 0.35))

    ctx.save()
    ctx.fillStyle = 'rgba(0, 229, 255, 0.12)'
    ctx.fillRect(W * 0.1, H * 0.72, W * 0.8, 1)

    const tickerItems = this.config.ticker || ['AI', 'Robotics', 'Cybersecurity', 'Space', 'Programming', 'Quantum', 'Biotech']
    const scrollP = (p * 40) % tickerItems.length
    ctx.font = '500 16px Inter, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    tickerItems.slice(0, 5).forEach((item, i) => {
      const alpha = 0.7 - (i * 0.12)
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0.15, alpha)})`
      ctx.fillText(item, W * 0.1 + i * (W * 0.16), H * 0.75)
    })
    ctx.restore()

    if (p > 0.6) {
      drawNewsTicker(ctx, tickerItems, p)
    }

    ctx.save()
    ctx.globalAlpha = Math.min(1, Math.max(0, (p - 0.5) / 0.3))
    ctx.font = '500 12px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText('TECH-MONSTER', W - 24, H - 10)
    ctx.restore()
  }

  drawWatermark(ctx) {
    ctx.font = '600 11px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('TECH-MONSTER', 16, 14)

    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, H - 2, W, 2)
    ctx.fillStyle = '#E10600'
    ctx.fillRect(0, H - 2, W * 0.3, 2)
  }
}
