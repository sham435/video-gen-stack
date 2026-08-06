import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawNewsTicker } from '../../visuals/NewsTicker.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'

const { W, H } = DesignSystem

export class BrandingLayer {
  draw(ctx, scene, progress) {
    if (scene.type === 'brand_close') {
      this.drawTicker(ctx, scene, progress)
    }
    this.drawFooter(ctx, scene, progress)

    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(0, H - 3, W, 3)
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(0, H - 3, W * 0.3, 3)
  }

  // Top-left broadcast bug — rendered AFTER post-processing (Compositor) so
  // the vignette and category grade can never dim it. Solid near-black pill,
  // 900-weight brand wordmark, red accent — readable on any hero plate.
  drawBug(ctx) {
    const bug = BROADCAST_TEXT.bug
    const font = DesignSystem.getTypography('watermark', 'default').font
    const label = 'NEWS-MONSTER'
    const x = 14
    const y = 12
    const padX = bug.padding[1]
    const padY = bug.padding[0]

    ctx.save()
    ctx.font = `${bug.weight} ${bug.size}px Anton, ${font}, sans-serif`
    const textW = ctx.measureText(label).width
    const pillW = textW + padX * 2
    const pillH = bug.size + padY * 2

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
    ctx.fillText(label, x + 8 + padX, y + pillH / 2)
    ctx.restore()
  }

  // Footer — 120px bar: NM monogram + brand (left, accent) and URL (right,
  // bold white at broadcast size). Drawn every scene; it is chrome, not
  // content, so it stays on-brand and readable after compression.
  drawFooter(ctx, scene, progress) {
    const footer = BROADCAST_TEXT.footer
    const p = Math.min(1, progress * 1.5)
    ctx.save()
    ctx.globalAlpha = 1
    const fTop = H - footer.height
    ctx.fillStyle = 'rgba(5,5,5,0.96)'
    ctx.fillRect(0, fTop, W, footer.height)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fillRect(0, fTop, W, 1)
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(0, fTop, W * 0.3, 3)

    // NM monogram — the brand logo, replaced from the old 'T' mark.
    const box = 64
    const boxY = fTop + (footer.height - box) / 2
    const boxX = 28
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 6
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.beginPath()
    ctx.roundRect(boxX, boxY, box, box, 10)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.font = `900 46px ${DesignSystem.getTypography('watermark', 'footer').font}, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('NM', boxX + box / 2, boxY + box / 2 + 3)

    // Brand name next to the monogram
    ctx.font = `${footer.weight} ${footer.size}px ${DesignSystem.getTypography('watermark', 'footer').font}, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.fillText('NEWS-MONSTER', boxX + box + 20, H - footer.height / 2)
    ctx.shadowBlur = 0

    ctx.font = `${footer.weight} ${footer.urlSize}px ${DesignSystem.getTypography('watermark', 'footer').font}, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'right'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.fillText('www.tech-monster.tv', W - 28, H - footer.height / 2)
    ctx.shadowBlur = 0
    ctx.restore()
  }

  drawTicker(ctx, scene, progress) {
    const p = Math.min(1, progress * 1.5)
    const tickerItems = scene.ticker || ['AI', 'Robotics', 'Cybersecurity', 'Space', 'Programming', 'Quantum', 'Biotech']

    ctx.save()
    ctx.fillStyle = 'rgba(0, 229, 255, 0.12)'
    ctx.fillRect(W * 0.1, H * 0.72, W * 0.8, 1)

    const scrollP = (p * 40) % tickerItems.length
    const tickerFont = DesignSystem.getTypography('ticker', 'item')
    ctx.font = `${tickerFont.weight} ${tickerFont.size}px ${tickerFont.font}, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    tickerItems.slice(0, 5).forEach((item, i) => {
      const alpha = 0.7 - i * 0.12
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0.15, alpha)})`
      ctx.fillText(item, W * 0.1 + i * (W * 0.16), H * 0.75)
    })
    ctx.restore()

    if (p > 0.6) {
      drawNewsTicker(ctx, tickerItems, p)
    }
    ctx.restore()
  }
}