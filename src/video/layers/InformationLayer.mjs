import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawBreakingBanner, drawGlitchOverlay } from '../../visuals/BreakingBanner.mjs'
import { drawHeadlineCard } from '../../visuals/HeadlineCard.mjs'
import { drawLogoAnimation } from '../../visuals/LogoAnimation.mjs'
import { drawAnchorBadge } from '../../visuals/AnchorBadge.mjs'

const { W, H } = DesignSystem

export class InformationLayer {
  async draw(ctx, scene, progress, category) {
    switch (scene.type) {
      case 'hook':
        this.renderHook(ctx, scene, progress, category)
        break
      case 'fact':
        this.renderFact(ctx, scene, progress)
        break
      case 'explanation':
        this.renderExplanation(ctx, scene, progress)
        break
      case 'retention':
        this.renderRetention(ctx, scene, progress)
        break
      case 'brand_close':
        this.renderBrandClose(ctx, scene, progress)
        break
    }
  }

  renderHook(ctx, scene, progress, category) {
    const catStyle = DesignSystem.getCategoryStyle(category)
    const primary = catStyle.colors.primary || DesignSystem.brand.primary
    const tp = Math.min(1, progress * 3)

    // Punch-in zoom on the NEWS-MONSTER brand mark (first ~0.5s of hook)
    if (progress < 0.55) {
      const punch = Math.max(0, Math.min(1, (0.55 - progress) / 0.55))
      const scale = 1 + punch * 0.12
      const zoom = 1 - Math.sin(punch * Math.PI) * 0.06
      ctx.save()
      ctx.translate(W / 2, H * 0.52)
      ctx.scale(scale, scale)
      ctx.font = `${900} ${150}px Anton, Impact, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.globalAlpha = tp
      ctx.fillStyle = '#FFFFFF'
      ctx.shadowColor = primary
      ctx.shadowBlur = 40 * tp
      ctx.fillText('NEWS-MONSTER', 0, 0)
      ctx.shadowBlur = 0
      ctx.globalAlpha = tp * 0.25
      ctx.fillStyle = primary
      ctx.beginPath()
      ctx.arc(0, 0, 300 * zoom, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      drawBreakingBanner(ctx, scene.subheadline || scene.text, progress, scene.headlineLayout?.fontSize || scene.headlineFontSize || 120)
    }

    // Hook headline — big, punchy, above the breaking banner
    if (progress > 0.45) {
      const hp = Math.min(1, (progress - 0.45) / 0.2)
      ctx.save()
      ctx.globalAlpha = hp
      const hScale = 0.6 + hp * 0.4
      ctx.translate(W / 2, H * 0.62)
      ctx.scale(hScale, hScale)
      const text = (scene.text || scene.subheadline || '').replace('BREAKING: ', '').toUpperCase()
      const words = text.split(' ')
      const mid = Math.ceil(words.length / 2)
      ctx.font = `900 ${scene.headlineLayout?.fontSize || scene.headlineFontSize || 92}px Anton, Impact, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#FFFFFF'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 16
      ctx.fillText(words.slice(0, mid).join(' '), 0, -46)
      ctx.fillStyle = primary
      ctx.fillText(words.slice(mid).join(' ') || 'BREAKING', 0, 46)
      ctx.shadowBlur = 0
      ctx.restore()
    }
  }

  renderFact(ctx, scene, progress) {
    drawHeadlineCard(ctx, scene.text, progress, '#FFFFFF', scene.headlineLayout?.fontSize || scene.headlineFontSize || 0, scene.headlineLayout || null)
  }

  renderExplanation(ctx, scene, progress) {
    const textWidth = W * 0.85
    const startX = W / 2 - textWidth / 2

    const heading = scene.text.split('.')[0]
    ctx.save()
    ctx.globalAlpha = Math.min(1, progress * 2)
    ctx.font = `${DesignSystem.getTypography('body', 'default').weight} ${DesignSystem.getTypography('body', 'default').size}px ${DesignSystem.getTypography('body', 'default').font}, sans-serif`
    ctx.fillStyle = DesignSystem.getSemantic('info')
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 6
    const hp = Math.min(1, progress * 2)
    ctx.globalAlpha = hp
    ctx.fillText('WHY IT MATTERS', startX, H * 0.15)
    ctx.shadowBlur = 0
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(startX, H * 0.15 + 60, 80, 5)
    ctx.restore()

    ctx.save()
    const bodyP = Math.min(1, Math.max(0, (progress - 0.1) / 0.4))
    ctx.globalAlpha = bodyP

    const body = scene.text.replace(heading + '. ', '')
    const bodyToken = DesignSystem.getTypography('body', 'small')
    ctx.font = `${bodyToken.weight} ${bodyToken.size}px ${bodyToken.font}, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 10

    const maxChars = DesignSystem.getMaxChars('body')
    const words = body.split(' ')
    let line = ''
    let lineY = H * 0.18 + 80
    for (const w of words) {
      if ((line + ' ' + w).trim().length <= maxChars) line += (line ? ' ' : '') + w
      else {
        ctx.fillText(line, startX, lineY)
        line = w
        lineY += 48
      }
    }
    if (line) ctx.fillText(line, startX, lineY)
    ctx.shadowBlur = 0
    ctx.restore()
  }

  renderRetention(ctx, scene, progress) {
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
    const badgeToken = DesignSystem.getTypography('badge', 'anchor')
    ctx.font = `${badgeToken.weight} ${badgeToken.size}px ${badgeToken.font}, sans-serif`
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = DesignSystem.brand.primary
    ctx.shadowBlur = 12

    const alertPulse = 0.4 + Math.sin(progress * 12) * 0.3
    ctx.fillStyle = `rgba(225, 6, 0, ${alertPulse})`
    ctx.beginPath()
    ctx.arc(W / 2 - 180, H * 0.20, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillText('BREAKING ANALYSIS', W / 2, H * 0.20)
    ctx.shadowBlur = 0
    ctx.restore()

    ctx.save()
    const bp = Math.min(1, Math.max(0, (progress - 0.15) / 0.3))
    ctx.globalAlpha = bp
    const scale = 0.85 + bp * 0.15
    ctx.translate(W / 2, H * 0.50)
    ctx.scale(scale, scale)

    const retentionToken = DesignSystem.getTypography('headline', 'small')
    ctx.font = `${retentionToken.weight} ${retentionToken.size}px ${retentionToken.font}, sans-serif`
    ctx.fillStyle = DesignSystem.brand.accent
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 12
    const maxChars = DesignSystem.getMaxChars('retention')
    const textLines = []
    let currentLine = ''
    for (const w of scene.text.split(' ')) {
      if ((currentLine + ' ' + w).trim().length <= maxChars) currentLine += (currentLine ? ' ' : '') + w
      else { textLines.push(currentLine); currentLine = w }
    }
    if (currentLine) textLines.push(currentLine)
    const lh = retentionToken.size * DesignSystem.getLineHeight('headline')
    const startY2 = -(textLines.length - 1) * lh / 2
    textLines.forEach((l, i) => ctx.fillText(l, 0, startY2 + i * lh))
    ctx.shadowBlur = 0
    ctx.restore()
  }

  renderBrandClose(ctx, scene, progress) {
    const p = Math.min(1, progress * 1.5)
    drawLogoAnimation(ctx, p)

    const ctaP = Math.min(1, Math.max(0, (p - 0.2) / 0.3))
    if (ctaP > 0) {
      ctx.save()
      ctx.globalAlpha = ctaP
      const ctaToken = DesignSystem.getTypography('badge', 'cta')
      ctx.font = `${ctaToken.weight} ${ctaToken.size}px ${ctaToken.font}, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 10
      ctx.fillText(scene.caption || 'Follow NEWS-MONSTER — Breaking News, AI, Science, Sports, Politics & Future Tech', W / 2, H * 0.50)
      ctx.shadowBlur = 0
      ctx.restore()
    }

    drawAnchorBadge(ctx, 'sham435', Math.max(0, p - 0.35))
  }
}