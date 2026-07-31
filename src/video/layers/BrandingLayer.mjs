import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawNewsTicker } from '../../visuals/NewsTicker.mjs'

const { W, H } = DesignSystem

export class BrandingLayer {
  draw(ctx, scene, progress) {
    this.drawWatermark(ctx)
    if (scene.type === 'brand_close') {
      this.drawTicker(ctx, scene, progress)
    }
  }

  drawWatermark(ctx) {
    const wmFont = DesignSystem.getTypography('watermark', 'default')
    ctx.font = `${wmFont.weight} ${wmFont.size}px ${wmFont.font}, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('NEWS-MONSTER', 16, 14)

    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, H - 2, W, 2)
    ctx.fillStyle = DesignSystem.brand.primary
    ctx.fillRect(0, H - 2, W * 0.3, 2)
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

    ctx.save()
    ctx.globalAlpha = Math.min(1, Math.max(0, (p - 0.5) / 0.3))
    const wmFont = DesignSystem.getTypography('watermark', 'footer')
    ctx.font = `${wmFont.weight} ${wmFont.size}px ${wmFont.font}, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText('NEWS-MONSTER', W - 24, H - 10)
    ctx.restore()
  }
}