import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawNewsTicker } from '../../visuals/NewsTicker.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import { FooterLayout, loadPlatformIcons } from '../footer/FooterLayout.mjs'
import { measureBrandPill, HEADER_WIDE_BRAND_SIZE } from '../../layout/HeaderLayout.mjs'

export class BrandingLayer {
  draw(ctx, scene, progress) {
    if (scene.type === 'brand_close') {
      this.drawTicker(ctx, scene, progress)
    }
    this.drawFooter(ctx, scene, progress)
  }

  // Top-left broadcast bug — rendered AFTER post-processing (Compositor) so
  // the vignette and category grade can never dim it. Solid near-black pill,
  // 900-weight brand wordmark, red accent — readable on any hero plate.
  // Skipped when scene.hideBranding is set (Shorts mode).
  drawBug(ctx, scene) {
    if (scene?.hideBranding) return
    const bug = BROADCAST_TEXT.bug
    const font = DesignSystem.getTypography('watermark', 'default').font
    const label = 'NEWS-MONSTER'
    const { x, y, w: pillW, h: pillH } = measureBrandPill(ctx)
    // Wide (16:9) uses a compact right-aligned pill — the internal font must
    // match the compact box (28px), not the 9:16 54px design size.
    const size = DesignSystem.isWide ? HEADER_WIDE_BRAND_SIZE : bug.size
    const padX = DesignSystem.isWide ? 14 : bug.padding[1]
    const padY = DesignSystem.isWide ? 1 : bug.padding[0]

    ctx.save()
    ctx.font = `${bug.weight} ${size}px Anton, ${font}, sans-serif`
    const textW = ctx.measureText(label).width
    const textX = x + padX + 8
    const textY = y + pillH / 2

    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 10
    ctx.fillStyle = bug.bg
    ctx.beginPath()
    ctx.roundRect(x, y, pillW, pillH, bug.borderRadius)
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(x, y, 8, pillH)
    ctx.fillRect(x + 8, y + pillH - 4, pillW - 8, 4)

    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, textX, textY)
    ctx.restore()
  }

  // Footer — rendered by the shared FooterLayout engine so the in-canvas bar
  // and the standalone footer.png composite are always identical. Layout:
  //   Left(25%): [NM] NEWS-MONSTER (top row) + tagline + AVAILABLE ON badges |
  //   Center(50%): whitespace |
  //   Right(25%): [SUBSCRIBE] (aligned with the wordmark) + URL below
  // Drawn every scene; it is chrome, not content, so it stays on-brand and
  // readable after compression.
  drawFooter(ctx, scene, progress) {
    const { W, H } = DesignSystem
    ctx.save()
    ctx.globalAlpha = 1
    // Platform badges load async — fire once, draw with whatever is ready.
    loadPlatformIcons().then(icons => { this._icons = icons }).catch(() => {})
    const hideBranding = scene?.hideBranding || false
    FooterLayout.draw(ctx, W, H, { hideBranding }, this._icons || {})
    ctx.restore()
  }

  drawTicker(ctx, scene, progress) {
    const { W, H } = DesignSystem
    const p = Math.min(1, progress * 1.5)
    const tickerItems = scene.ticker || ['AI', 'Robotics', 'Cybersecurity', 'Space', 'Programming', 'Quantum', 'Biotech']

    ctx.save()
    // Preview ticker anchor: 9:16 uses the original 0.72/0.75 band; wide
    // (16:9) docks the preview above the footer so it never collides with the
    // real footer-docked ticker (`drawNewsTicker` -> barTopInFrame).
    const previewY = DesignSystem.isWide ? H * 0.78 : H * 0.75
    const lineY = DesignSystem.isWide ? H * 0.75 : H * 0.72
    ctx.fillStyle = 'rgba(0, 229, 255, 0.12)'
    ctx.fillRect(W * 0.1, lineY, W * 0.8, 1)

    const scrollP = (p * 40) % tickerItems.length
    const tickerFont = DesignSystem.getTypography('ticker', 'item')
    ctx.font = `${tickerFont.weight} ${tickerFont.size}px ${tickerFont.font}, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    tickerItems.slice(0, 5).forEach((item, i) => {
      const alpha = 0.7 - i * 0.12
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0.15, alpha)})`
      ctx.fillText(item, W * 0.1 + i * (W * 0.16), previewY)
    })
    ctx.restore()

    if (p > 0.6) {
      drawNewsTicker(ctx, tickerItems, p)
    }
    ctx.restore()
  }
}