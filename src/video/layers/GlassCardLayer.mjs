import { DesignSystem } from '../../visuals/DesignSystem.mjs'

export class GlassCardLayer {
  draw(ctx, scene, progress, options = {}) {
    const { W, H, sy } = DesignSystem
    const p = Math.min(1, (progress - (options.delay || 0)) / (options.duration || 0.3))
    if (p <= 0) return

    const glass = DesignSystem.glass
    const x = options.x ?? W * 0.05
    const y = options.y ?? H * 0.65
    const w = options.width ?? W * 0.9
    // Default height is the 9:16 design 200px scaled to the active frame.
    const h = options.height ?? sy(200)
    const r = options.radius ?? glass.radius

    ctx.save()
    ctx.globalAlpha = p

    ctx.fillStyle = glass.backdrop
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()

    ctx.fillStyle = glass.background
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()

    ctx.strokeStyle = options.borderColor || glass.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.stroke()

    if (options.accentLine) {
      ctx.fillStyle = DesignSystem.getCategoryStyle(options.category || 'technology').colors.primary
      ctx.fillRect(x + 20, y + 10, 4, h - 20)
    }

    ctx.restore()
  }
}