import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import { headerLayout } from '../../layout/HeaderLayout.mjs'

const { W, H } = DesignSystem

export class BroadcastUILayer {
  draw(ctx, scene, progress, category) {
    const catStyle = DesignSystem.getCategoryStyle(category)
    const p = Math.min(1, progress * 1.5)

    // LIVE indicator — sits immediately right of the NEWS-MONSTER brand pill
    // (20px gap, same visual centerline) per the shared header layout. Never a
    // hard-coded corner position. 36px bold on a red pill.
    const live = BROADCAST_TEXT.live
    const liveAlpha = (0.9 + Math.sin(progress * 6) * 0.1) * p
    ctx.save()
    ctx.globalAlpha = Math.max(0, liveAlpha)

    const liveFont = DesignSystem.getTypography('overlay', 'live')
    ctx.font = `${live.weight} ${live.size}px ${liveFont.font}, sans-serif`

    const header = headerLayout(ctx)
    const liveX = header.live.x
    const liveY = header.live.y
    const liveW = header.live.w
    const liveH = header.live.h
    const centerY = liveY + liveH / 2

    ctx.fillStyle = live.bg
    ctx.beginPath()
    ctx.roundRect(liveX, liveY, liveW, liveH, live.borderRadius)
    ctx.fill()

    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 4
    ctx.fillText('LIVE', liveX + liveW / 2, centerY + 1)
    ctx.shadowBlur = 0
    ctx.restore()

    const catTagP = Math.min(1, progress * 2)
    ctx.save()
    ctx.globalAlpha = catTagP
    ctx.font = `${DesignSystem.getTypography('badge', 'label').weight} ${DesignSystem.getTypography('badge', 'label').size}px ${DesignSystem.getTypography('badge', 'label').font}, sans-serif`
    const catLabel = category ? category.toUpperCase() : 'TECHNOLOGY'
    // Category chip sits BELOW the brand+LIVE header row (never over the
    // NEWS-MONSTER pill); top-aligned to the header left edge.
    const chipH = 26
    const catX = header.brand.x
    const catY = header.brand.y + header.brand.h + 12 + chipH / 2
    ctx.fillStyle = catStyle.colors.primary
    ctx.beginPath()
    ctx.roundRect(catX, catY - 9, ctx.measureText(catLabel).width + 24, chipH, 4)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(catLabel, catX + 12, catY + 2)
    ctx.restore()

    if (scene.source) {
      ctx.save()
      ctx.globalAlpha = 0.72 * p
      const srcFont = DesignSystem.getTypography('overlay', 'source')
      ctx.font = `${srcFont.weight} ${srcFont.size}px ${srcFont.font}, sans-serif`
      ctx.fillStyle = 'rgb(245,245,245)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`Source: ${scene.source}`, DesignSystem.spacing.safeArea.left, H - BROADCAST_TEXT.footer.height - 32)
      ctx.restore()
    }

    ctx.save()
    ctx.globalAlpha = 0.7 * p
    const timeFont = DesignSystem.getTypography('overlay', 'timestamp')
    ctx.font = `${timeFont.weight} ${timeFont.size}px ${timeFont.font}, sans-serif`
    ctx.fillStyle = 'rgb(235,235,235)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    // Deterministic clock — derived from scene progress, not wall-clock time,
    // so identical inputs always render identical frames.
    const elapsed = Math.max(0, Math.floor((scene.duration || 30) * progress))
    const now = new Date(Date.UTC(1970, 0, 1, 0, Math.floor(elapsed / 60), elapsed % 60))
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })
    ctx.fillText(timeStr, W - DesignSystem.spacing.safeArea.right, H - BROADCAST_TEXT.footer.height - 32)
    ctx.restore()
  }
}