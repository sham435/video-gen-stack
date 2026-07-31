import { DesignSystem } from '../../visuals/DesignSystem.mjs'

const { W, H } = DesignSystem

export class BroadcastUILayer {
  draw(ctx, scene, progress, category) {
    const catStyle = DesignSystem.getCategoryStyle(category)
    const overlays = DesignSystem.overlayDefaults

    const p = Math.min(1, progress * 1.5)

    const liveAlpha = (0.7 + Math.sin(progress * 6) * 0.3) * p
    ctx.save()
    ctx.globalAlpha = Math.max(0, liveAlpha)

    const liveFont = DesignSystem.getTypography('overlay', 'live')
    ctx.font = `${liveFont.weight} ${liveFont.size}px ${liveFont.font}, sans-serif`

    const liveX = W - overlays.live.position.right - 80
    const liveY = overlays.live.position.top + 14

    ctx.fillStyle = DesignSystem.brand.primary
    ctx.beginPath()
    ctx.roundRect(liveX, liveY - liveFont.size * 0.4, 60, liveFont.size * 1.2, 4)
    ctx.fill()

    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('LIVE', liveX + 30, liveY + 2)
    ctx.restore()

    const catTagP = Math.min(1, progress * 2)
    ctx.save()
    ctx.globalAlpha = catTagP
    ctx.font = `${DesignSystem.getTypography('badge', 'label').weight} ${DesignSystem.getTypography('badge', 'label').size}px ${DesignSystem.getTypography('badge', 'label').font}, sans-serif`
    const catLabel = category ? category.toUpperCase() : 'TECHNOLOGY'
    const catX = overlays.category.position.left
    const catY = overlays.category.position.top + 12
    ctx.fillStyle = catStyle.colors.primary
    ctx.beginPath()
    ctx.roundRect(catX, catY - 9, ctx.measureText(catLabel).width + 24, 26, 4)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(catLabel, catX + 12, catY + 2)
    ctx.restore()

    if (scene.source) {
      ctx.save()
      ctx.globalAlpha = 0.6 * p
      const srcFont = DesignSystem.getTypography('overlay', 'source')
      ctx.font = `${srcFont.weight} ${srcFont.size}px ${srcFont.font}, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`Source: ${scene.source}`, DesignSystem.spacing.safeArea.left, H - DesignSystem.spacing.safeArea.bottom - 30)
      ctx.restore()
    }

    ctx.save()
    ctx.globalAlpha = 0.3 * p
    const timeFont = DesignSystem.getTypography('overlay', 'timestamp')
    ctx.font = `${timeFont.weight} ${timeFont.size}px ${timeFont.font}, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    const now = new Date()
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    ctx.fillText(timeStr, W - DesignSystem.spacing.safeArea.right, H - DesignSystem.spacing.safeArea.bottom - 30)
    ctx.restore()
  }
}