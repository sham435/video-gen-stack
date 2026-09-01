import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawBreakingBanner, drawGlitchOverlay } from '../../visuals/BreakingBanner.mjs'
import { drawHeadlineCard } from '../../visuals/HeadlineCard.mjs'
import { drawAnchorBadge } from '../../visuals/AnchorBadge.mjs'
import { TextTimelineScheduler } from '../TextTimelineScheduler.mjs'
import { wrapText } from '../../layout/wrapText.mjs'
import { renderTextBlock } from '../../layout/TextBlock.mjs'
import { FooterLayout } from '../footer/FooterLayout.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'

// Bright yellow for the explanation heading + body (high contrast on the dark
// scrim, matches the "WHY IT MATTERS" yellow design).
const BRIGHT_YELLOW = '#FFE600'

export class InformationLayer {
  async draw(ctx, scene, progress, category, timeline = null, time = 0, narrative = null) {
    // The headline stack renders from ONE authoritative measured block. Prefer
    // the production injected layout, then the narrative composition's — never
    // an ad-hoc re-wrap/position in the renderer.
    if (!scene.headlineLayout && narrative?.headlineLayout) {
      scene = { ...scene, headlineLayout: narrative.headlineLayout, headlineFontSize: narrative.headlineLayout.fontSize }
    }
    const envelope = timeline ? (id) => {
      const layer = timeline.layers.find(l => l.id === id)
      return layer && TextTimelineScheduler.envelope(layer, time)
    } : () => 1
    switch (scene.type) {
      case 'hook':
        this.renderBanner(ctx, scene, progress, category, envelope('banner'))
        this.renderHero(ctx, scene, progress, category, envelope('hero'))
        this.renderSecondary(ctx, scene, progress, category, envelope('secondary'), time, timeline?.layers.find(l => l.id === 'secondary')?.start || 0)
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
      case 'close':
        this.renderBrandClose(ctx, scene, progress)
        break
    }
  }

  renderBanner(ctx, scene, progress, category, alpha) {
    if (alpha <= 0.01) return
    const bannerText = scene.subheadline && scene.subheadline !== scene.text && scene.subheadline.split(' ').length <= 6
      ? scene.subheadline
      : ''
    ctx.save()
    ctx.globalAlpha = alpha
    drawBreakingBanner(ctx, bannerText, progress, scene.headlineLayout?.fontSize || scene.headlineFontSize || 64)
    ctx.restore()
  }

  // Hero headline — gold gradient, heavy shadow, slight glow, largest font,
  // center of frame, max 2 lines, scale-in with the timeline envelope.
  renderHero(ctx, scene, progress, category, alpha) {
    const { W, H } = DesignSystem
    if (alpha <= 0.01 || !scene.text) return
    const hp = alpha
    ctx.save()
    ctx.globalAlpha = hp
    const hScale = 0.6 + hp * 0.4
    const anchorY = scene.headlineLayout?.y || H * DesignSystem.layout.hero
    ctx.translate(W / 2, anchorY)
    ctx.scale(hScale, hScale)
    const layoutLines = scene.headlineLayout?.lines?.length ? scene.headlineLayout.lines : []
    const text = (scene.text || '').replace('BREAKING: ', '').toUpperCase()
    const words = text.split(' ')
    const mid = Math.ceil(words.length / 2)
    const lines = layoutLines.length ? layoutLines : [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
    const fontSize = scene.headlineLayout?.fontSize || scene.headlineFontSize || 92
    ctx.font = `900 ${fontSize}px Anton, Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 6
    const lineH = scene.headlineLayout?.lineHeight || fontSize * 1.25
    const offset = ((lines.length - 1) * lineH) / 2
    const gold = ctx.createLinearGradient(0, -offset - fontSize, 0, offset + fontSize)
    gold.addColorStop(0, '#FFD700')
    gold.addColorStop(1, '#FFEB3B')
    lines.forEach((line, i) => {
      ctx.strokeStyle = 'rgba(0,0,0,0.9)'
      ctx.strokeText(line, 0, -offset + i * lineH)
      ctx.fillStyle = gold
      ctx.fillText(line, 0, -offset + i * lineH)
    })
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.restore()
  }

  // Secondary headline — white, keyword in accent red only, 70% of hero size,
  // word-stagger fade-up. Renders only in its own timeline window.
  renderSecondary(ctx, scene, progress, category, alpha, time, layerStart = 0) {
    const { W, H } = DesignSystem
    if (alpha <= 0.01 || !scene.text) return
    const layout = scene.headlineLayout
    const heroSize = layout?.fontSize || scene.headlineFontSize || 92
    const fontSize = Math.max(40, Math.round(heroSize * 0.7))
    const anchorY = layout?.y || H * DesignSystem.layout.secondary
    const text = (scene.text || '').replace('BREAKING: ', '').toUpperCase()
    const words = text.split(' ')
    const mid = Math.ceil(words.length / 2)
    const lines = layout?.lines?.length ? layout.lines : [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
    const keyword = (scene.caption_focus || '').toUpperCase()
    const lineH = fontSize * 1.3
    const offset = ((lines.length - 1) * lineH) / 2
    const maxChars = 24

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 ${fontSize}px Anton, Impact, sans-serif`

    let wordCounter = 0
    lines.forEach((line, i) => {
      // hard wrap long lines
      const pieces = []
      let cur = []
      for (const w of line.split(' ')) {
        cur.push(w)
        if (cur.join(' ').length > maxChars) { pieces.push(cur.slice(0, -1).join(' ')); cur = [w] }
      }
      if (cur.length) pieces.push(cur.join(' '))
      const pieceOffset = ((pieces.length - 1) * lineH) / 2
      pieces.forEach((piece, pi) => {
        const py = -offset + i * lineH - pieceOffset + pi * lineH
        for (const w of piece.split(' ')) {
          const isKeyword = keyword && w.includes(keyword)
          // word stagger: each word enters 0.06s after the previous, fade-up
          const wordT = Math.min(1, Math.max(0, (time - layerStart - wordCounter * 0.06) / 0.12))
          ctx.save()
          ctx.globalAlpha = Math.min(alpha, wordT) * (isKeyword ? 1 : 0.95)
          ctx.translate(0, (1 - wordT) * 28)
          ctx.shadowColor = 'rgba(0,0,0,0.9)'
          ctx.shadowBlur = 12
          ctx.lineWidth = 3
          ctx.strokeStyle = 'rgba(0,0,0,0.8)'
          ctx.strokeText(w, 0, py)
          ctx.fillStyle = isKeyword ? '#E10600' : '#FFFFFF'
          ctx.fillText(w, 0, py)
          ctx.restore()
          wordCounter++
        }
      })
    })
    ctx.shadowBlur = 0
    ctx.restore()
  }

  renderFact(ctx, scene, progress) {
    drawHeadlineCard(ctx, scene.text, progress, '#FFFFFF', scene.headlineLayout?.fontSize || scene.headlineFontSize || 0, scene.headlineLayout || null)
  }

  renderExplanation(ctx, scene, progress) {
    const { W, H, sy } = DesignSystem
    const textWidth = W * 0.85
    const startX = W / 2 - textWidth / 2

    const heading = scene.text.split('.')[0]
    ctx.save()
    ctx.globalAlpha = Math.min(1, progress * 1.2)
    const headingSize = DesignSystem.getTypography('body', 'default').size
    ctx.font = `${DesignSystem.getTypography('body', 'default').weight} ${headingSize}px ${DesignSystem.getTypography('body', 'default').font}, sans-serif`
    // Bright yellow heading (matches the body) — high contrast on the scrim.
    ctx.fillStyle = BRIGHT_YELLOW
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 6
    const hp = Math.min(1, progress * 1.2)
    ctx.globalAlpha = hp
    const headingY = H * DesignSystem.layout.explanationHeading
    ctx.fillText('WHY IT MATTERS', startX, headingY)
    // Red underline spans the full width of the "WHY IT MATTERS" heading text
    // (measure it — never a fixed 96px stub). It must render BENEATH the text,
    // below the cap height (~0.8 * fontSize), never over the glyphs.
    const headingW = ctx.measureText('WHY IT MATTERS').width
    ctx.shadowBlur = 0
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(startX, headingY + headingSize * 0.8 + sy(12), headingW, 6)
    ctx.restore()

    ctx.save()
    const bodyP = Math.min(1, Math.max(0, (progress - 0.1) / 0.4))
    ctx.globalAlpha = bodyP

    const body = scene.text.replace(heading + '. ', '')
    const bodyToken = DesignSystem.getTypography('body', 'small')
    const bodySize = bodyToken.size
    ctx.font = `${bodyToken.weight} ${bodySize}px ${bodyToken.font}, sans-serif`
    ctx.fillStyle = BRIGHT_YELLOW
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 10

    // Wrap the body to a max width of ~60% of the canvas so it stays a compact
    // left column under the heading (not stretched across the wide 16:9 frame).
    const maxBodyWidth = W * 0.60
    // Comfortable line spacing: 1.6x the body font size per line. The old
    // sy(56)~(21px for a 42px font, ~0.5x) packed lines onto each other.
    const bodyLineStep = Math.round(bodySize * 1.6)
    const words = body.split(' ')
    let line = ''
    let lineY = H * DesignSystem.layout.explanationBody + sy(92)
    for (const w of words) {
      const probe = line ? line + ' ' + w : w
      if (ctx.measureText(probe).width <= maxBodyWidth || !line) line += (line ? ' ' : '') + w
      else {
        ctx.fillText(line, startX, lineY)
        line = w
        lineY += bodyLineStep
      }
    }
    if (line) ctx.fillText(line, startX, lineY)
    ctx.shadowBlur = 0
    ctx.restore()
  }

  renderRetention(ctx, scene, progress) {
    const { W, H, sx } = DesignSystem
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
    ctx.arc(W / 2 - sx(180), H * DesignSystem.layout.retentionBadge, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillText('BREAKING ANALYSIS', W / 2, H * DesignSystem.layout.retentionBadge)
    ctx.shadowBlur = 0
    ctx.restore()

    ctx.save()
    const bp = Math.min(1, Math.max(0, (progress - 0.15) / 0.3))
    ctx.globalAlpha = bp
    const scale = 0.85 + bp * 0.15
    ctx.translate(W / 2, H * DesignSystem.layout.retentionCenter)
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
    const { W, H, sx, sy } = DesignSystem
    const p = Math.min(1, Math.max(0, progress))
    const DUR = scene.duration || 3
    const t = p * DUR

    const bgP = Math.min(1, t / 0.4)
    const stayP = Math.min(1, Math.max(0, (t - 0.4) / 0.4))
    const brandP = Math.min(1, Math.max(0, (t - 0.8) / 0.6))
    const tagP = Math.min(1, Math.max(0, (t - 1.4) / 0.6))
    const anchorP = Math.min(1, Math.max(0, (t - 2.0) / 0.4))

    ctx.save()

    if (bgP > 0) {
      ctx.save()
      ctx.globalAlpha = bgP
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#0A0E1A')
      grad.addColorStop(1, '#05060A')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }

    if (bgP > 0.2 && !scene.hideBranding) {
      ctx.save()
      ctx.globalAlpha = 0.12 * bgP
      const wmSize = sy(420)
      ctx.fillStyle = '#E10600'
      ctx.beginPath()
      ctx.roundRect(W / 2 - wmSize / 2, H / 2 - wmSize / 2, wmSize, wmSize, sy(64))
      ctx.fill()
      ctx.font = `900 ${sy(240)}px Anton, Impact, sans-serif`
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('NM', W / 2, H / 2 + 10)
      ctx.restore()
    }

    if (stayP > 0) {
      ctx.save()
      ctx.globalAlpha = stayP
      ctx.translate(0, (1 - stayP) * sy(40))
      ctx.font = `900 ${sy(98)}px "Montserrat ExtraBold", sans-serif`
      ctx.fillStyle = '#FFC107'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(255,193,7,0.5)'
      ctx.shadowBlur = 18
      ctx.fillText('STAY WITH', W / 2, H * DesignSystem.layout.brandStay)
      ctx.shadowBlur = 0
      ctx.restore()
    }

    if (brandP > 0) {
      const scale = 0.6 + brandP * 0.4
      ctx.save()
      ctx.globalAlpha = brandP
      ctx.translate(W / 2, H * DesignSystem.layout.brandCenter)
      ctx.scale(scale, scale)
      // Fit-to-width so the brand headline always stays inside the layout.
      const brandFont = `900 ${sy(140)}px "Montserrat ExtraBold", sans-serif`
      ctx.font = brandFont
      const fit = Math.min(1, (W - sx(160)) / Math.max(ctx.measureText('NEWS-MONSTER').width, 1))
      ctx.font = `900 ${Math.floor(sy(140) * fit)}px "Montserrat ExtraBold", sans-serif`
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(255,255,255,0.8)'
      ctx.shadowBlur = 40 * brandP
      ctx.fillText('NEWS-MONSTER', 0, 0)
      ctx.shadowBlur = 0
      ctx.restore()
    }

if (tagP > 0) {
      // Tagline: ONE measured TextBlock (never per-line guesses). Wrapped to
      // the close-scene maxWidth, positioned as a complete block just inside
      // the safe top zone, and CLAMPED strictly above the footer reserve —
      // narrative.bottom < footer.top - safeGap (persistent branding owns the
      // bottom safe zone; a long tagline can never collide with it).
      const close = BROADCAST_TEXT.close
      const tagSize = close.tagline.size
      const tagLeading = close.tagline.leading
      const safeGap = close.anchor.margin
      const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
      const leading = tagSize * tagLeading
      ctx.save()
      ctx.globalAlpha = tagP
      ctx.font = `900 ${tagSize}px "Montserrat ExtraBold", sans-serif`
      const tagLines = wrapText(ctx, 'UNFILTERED BREAKING NEWS FROM THE FUTURE', close.tagline.maxWidth, 2)
      const blockH = tagLines.length * leading
      // The tagline block must sit CLEAR of the NEWS-MONSTER brand mark above
      // it (brand ink spans brandCenter ± half the sy(140) em — the observed
      // 16:9 bug anchored the block at 0.60H and it collided with the brand at
      // 0:40). Anchor the block's TOP just below the brand ink bottom, then
      // clamp so the whole block ends above footerTop - safeGap.
      const brandInkBottom = H * DesignSystem.layout.brandCenter + sy(140) * 0.5
      let blockTop = Math.max(
        brandInkBottom + sy(24),
        H * DesignSystem.layout.tagline - blockH / 2 + tagSize / 2
      )
      // Clamp: the whole block must end above footerTop - safeGap.
      const maxBottom = footerTop - safeGap
      if (blockTop + blockH > maxBottom) blockTop = maxBottom - blockH
      renderTextBlock(ctx, {
        text: 'UNFILTERED BREAKING NEWS FROM THE FUTURE',
        fontFamily: '"Montserrat ExtraBold"',
        fontSize: tagSize,
        fontWeight: 900,
        maxWidth: close.tagline.maxWidth,
        maxLines: 2,
        lineHeight: leading,
        textAlign: 'center',
        anchorX: 'center',
        anchorY: 'top',
        x: W / 2,
        y: blockTop,
        lines: tagLines,
        width: close.tagline.maxWidth,
        height: blockH,
      }, { fillStyle: 'rgba(255,255,255,0.92)' })
      ctx.restore()

      // News source credit — revealed after the tagline so the end card always
      // attributes the story ("Source: The Washington Post"), matching the
      // publish description. Never replaces the brand outro.
      const src = scene.source || 'News'
      const srcP = Math.min(1, Math.max(0, (t - 1.6) / 0.4))
      if (srcP > 0 && src !== 'News') {
        ctx.save()
        ctx.globalAlpha = srcP
        const srcFont = `700 ${sy(34)}px Inter, sans-serif`
        ctx.font = srcFont
        ctx.fillStyle = 'rgba(255,255,255,0.78)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`Source: ${src}`, W / 2, blockTop + blockH + tagSize + sy(42))
        ctx.restore()
      }

      // Engagement question — topic CTA rendered on-screen so no manual pinned
      // comment is needed (YouTube's API blocks top-level comments; the render
      // carries the CTA instead). Question fades in above the footer bar.
      const q = scene.cta?.engagement || scene.cta?.text
      const qP = Math.min(1, Math.max(0, (t - 2.2) / 0.4))
      if (q && qP > 0) {
        // Keep the question clear of the source line and above the anchor/footer.
        const qY = Math.min(blockTop + blockH + tagSize + sy(110), footerTop - sy(200))
        ctx.save()
        ctx.globalAlpha = qP
        ctx.font = `800 ${sy(40)}px Inter, sans-serif`
        ctx.fillStyle = '#FFFFFF'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.9)'
        ctx.shadowBlur = 10
        const qLines = wrapText(ctx, q, W - sx(160), 2)
        qLines.forEach((line, i) => ctx.fillText(line, W / 2, qY + i * sy(48)))
        ctx.shadowBlur = 0
        ctx.restore()
      }

      // Anchor badge sits below the tagline block and is clamped so the pill
      // clears the footer bar top — the tagline can never collide with it.
      // Skipped when scene.hideBranding is set (Shorts mode).
      if (!scene.hideBranding) {
        const anchor = close.anchor
        const taglineBottom = blockTop + blockH
        const badgeY = Math.min(
          taglineBottom + anchor.gap,
          footerTop - anchor.margin - anchor.badgeH
        )
        drawAnchorBadge(ctx, 'sham435', anchorP, { y: badgeY })
      }
    }

    ctx.restore()
  }
}