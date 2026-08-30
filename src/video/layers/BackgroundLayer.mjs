import { DesignSystem } from '../../visuals/DesignSystem.mjs'

export class BackgroundLayer {
  draw(ctx, scene, progress, category) {
    const { W, H } = DesignSystem
    const catStyle = DesignSystem.getCategoryStyle(category)
    const accent = catStyle.colors.primary || DesignSystem.brand.primary

    const grad = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, W * 0.8)
    grad.addColorStop(0, '#0D0D0D')
    grad.addColorStop(0.5, '#080808')
    grad.addColorStop(1, catStyle.colors.background)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.03)'
    ctx.lineWidth = 0.5
    for (let x = 0; x < W; x += DesignSystem.spacing.grid) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
    }
    for (let y = 0; y < H; y += DesignSystem.spacing.grid) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }

    const blobX = W / 2 + Math.sin(progress * 1.5) * 200
    const blobY = H * 0.4 + Math.cos(progress * 1.2) * 150
    const blobR = 500 + Math.sin(progress * 2) * 100
    const blobGrad = ctx.createRadialGradient(blobX, blobY, 0, blobX, blobY, blobR)
    blobGrad.addColorStop(0, `${accent}15`)
    blobGrad.addColorStop(0.5, `${accent}08`)
    blobGrad.addColorStop(1, `${accent}00`)
    ctx.fillStyle = blobGrad
    ctx.fillRect(0, 0, W, H)
  }
}