import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawNewsTicker } from '../../visuals/NewsTicker.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'

const { W, H } = DesignSystem

export class BrandingLayer {
  draw(ctx, scene, progress) {
    this.drawWatermark(ctx)
    if (scene.type === 'brand_close') {
      this.drawTicker(ctx, scene, progress)
    }
    this.drawFooter(ctx, scene, progress)
  }

  drawWatermark(ctx) {
    // Top-left brand chip (bug) — broadcast minimum 32px bold on a dark pill
    const bug = BROADCAST_TEXT.bug
    ctx.save()
    ctx.font = `${bug.weight} ${bug.size}px ${DesignSystem.getTypography('watermark', 'default').font}, sans-serif`
    const label = 'NEWS-MONSTER'
    const textW = ctx.measureText(label).width
    const padX = bug.padding[1]
    const padY = bug.padding[0]
    ctx.fillStyle = bug.bg
    ctx.beginPath()
    ctx.roundRect(14, 12, textW + padX * 2, bug.size + padY * 2, bug.borderRadius)
    ctx.fill()
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(14, 12, 6, bug.size + padY * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 14 + 6 + padX, 12 + (bug.size + padY * 2) / 2)
    ctx.restore()

    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(0, H - 3, W, 3)
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(0, H - 3, W * 0.3, 3)
  }

  // Footer — 80px bar with the brand URL at broadcast size (32px bold).
  // Drawn every scene; it is chrome, not content, so it stays subtle but
  // readable after compression.
  drawFooter(ctx, scene, progress) {
    const footer = BROADCAST_TEXT.footer
    const p = Math.min(1, progress * 1.5)
    ctx.save()
    ctx.globalAlpha = 0.85 * p
    ctx.fillStyle = 'rgba(5,5,5,0.72)'
    ctx.fillRect(0, H - footer.height, W, footer.height)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, H - footer.height, W, 1)

    ctx.font = `${footer.weight} ${footer.urlSize}px ${DesignSystem.getTypography('watermark', 'footer').font}, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.fillText('www.tech-monster.tv', W - 24, H - footer.height / 2)
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