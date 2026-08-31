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
  // Skipped when scene.hideBranding is set.
  //
  // The brand bug is narrative-state-aware: during OUTRO the end-card renders
  // its own centered NEWS-MONSTER brand stack (InformationLayer brand close),
  // so this top-left duplicate is suppressed to avoid a second "NEWS-MONSTER"
  // mark piling on the same frame. Footer chrome is unaffected.
  drawBug(ctx, scene, narrativeState = null) {
    if (scene?.hideBranding) return
    if (narrativeState === 'OUTRO') return
    const bug = BROADCAST_TEXT.bug
    const font = DesignSystem.getTypography('watermark', 'default').font
    const label = 'NEWS-MONSTER'
    const { x, y, w: pillW, h: pillH } = measureBrandPill(ctx)
    // 16:9 uses a compact right-aligned pill — the internal font must match
    // the compact box (28px), not the token design size.
    const size = HEADER_WIDE_BRAND_SIZE
    const padX = 14
    const padY = 1

    ctx.save()
    // Label font: 900 weight + a crisp 1px dark stroke. Smaller than the pill
    // height so the READY text no longer fills edge-to-edge and mush into the
    // red accent lines (28px in a 30px pill). No soft shadow on the text —
    // shadowBlur is what made it look blurry/washed-out.
    const labelSize = 18
    ctx.font = `900 ${labelSize}px Anton, ${font}, sans-serif`
    const textW = ctx.measureText(label).width
    const textX = x + padX + 8
    // Raised baseline (above the pill vertical center) so the label reads
    // clearly separated from the red top/bottom accent lines.
    const textY = y + pillH / 2 - 1

    ctx.fillStyle = bug.bg
    ctx.beginPath()
    ctx.roundRect(x, y, pillW, pillH, bug.borderRadius)
    ctx.fill()

    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(x, y, 6, pillH)
    ctx.fillRect(x + 6, y + pillH - 4, pillW - 6, 4)

    ctx.fillStyle = '#FFFFFF'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.strokeText(label, textX, textY)
    ctx.fillText(label, textX, textY)
    ctx.restore()
  }

  // Footer — rendered by the shared FooterLayout engine so the in-canvas bar
  // and the standalone footer.png composite are always identical. Layout:
  //   16:9 single centered row: [NEWS-MONSTER NM] pair + domain (left) +
  //   Subscribe pill (right), bottom-anchored with a red accent at the edge.
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
    // Preview ticker anchor: the preview docks above the footer so it never
    // collides with the real footer-docked ticker (`drawNewsTicker` ->
    // barTopInFrame).
    const previewY = H * 0.78
    const lineY = H * 0.75
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