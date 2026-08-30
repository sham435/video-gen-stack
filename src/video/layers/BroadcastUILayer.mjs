import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import { headerLayout } from '../../layout/HeaderLayout.mjs'
import { FooterLayout } from '../footer/FooterLayout.mjs'

export class BroadcastUILayer {
  draw(ctx, scene, progress, category) {
    const { W, H } = DesignSystem
    const catStyle = DesignSystem.getCategoryStyle(category)
    const p = Math.min(1, progress * 1.5)

    // LIVE indicator — sits on the same header row as the NEWS-MONSTER brand
    // pill, placed by the shared header layout (per-profile). Never a
    // hard-coded corner position.
    const live = BROADCAST_TEXT.live
    const liveAlpha = (0.9 + Math.sin(progress * 6) * 0.1) * p
    ctx.save()
    ctx.globalAlpha = Math.max(0, liveAlpha)

    const liveFont = DesignSystem.getTypography('overlay', 'live')
    const header = headerLayout(ctx, undefined, category)
    const liveX = header.live.x
    const liveY = header.live.y
    const liveW = header.live.w
    const liveH = header.live.h
    const centerY = liveY + liveH / 2
    const livePillH = DesignSystem.isWide ? liveH : liveH

    ctx.fillStyle = live.bg
    ctx.beginPath()
    ctx.roundRect(liveX, liveY, liveW, livePillH, live.borderRadius)
    ctx.fill()

    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 4
    // Wide header uses an 18px LIVE label; portrait keeps the token size.
    const liveSize = DesignSystem.isWide ? 18 : live.size
    ctx.font = `${live.weight} ${liveSize}px ${liveFont.font}, sans-serif`
    ctx.fillText('LIVE', liveX + liveW / 2, centerY + 1)
    ctx.shadowBlur = 0
    ctx.restore()

    const catTagP = Math.min(1, progress * 2)
    const catLabel = category ? category.toUpperCase() : 'TECHNOLOGY'

    if (DesignSystem.isWide && header.category) {
      // 16:9 — category chip sits IN the right-aligned header row, left of
      // the brand, next to LIVE, all on one line at y=40.
      const c = header.category
      ctx.save()
      ctx.globalAlpha = catTagP
      ctx.fillStyle = catStyle.colors.primary
      ctx.beginPath()
      ctx.roundRect(c.x, c.y, c.w, c.h, 4)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${18}px Inter, sans-serif`
      ctx.fillText(catLabel, c.x + c.w / 2, c.y + c.h / 2)
      ctx.restore()
    } else {
      // 9:16 — category chip sits BELOW the brand+LIVE header row (never over
      // the NEWS-MONSTER pill); top-aligned to the header left edge.
      ctx.save()
      ctx.globalAlpha = catTagP
      ctx.font = `${DesignSystem.getTypography('badge', 'label').weight} ${DesignSystem.getTypography('badge', 'label').size}px ${DesignSystem.getTypography('badge', 'label').font}, sans-serif`
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
    }

    // Bottom chrome (source line + timestamp) docks above the footer's ACTUAL
    // top edge — computed, never hard-coded to the 9:16 180px token.
    const footerTop = FooterLayout.barTopInFrame(ctx, W, H)

    if (scene.source) {
      ctx.save()
      ctx.globalAlpha = 0.72 * p
      const srcFont = DesignSystem.getTypography('overlay', 'source')
      ctx.font = `${srcFont.weight} ${srcFont.size}px ${srcFont.font}, sans-serif`
      ctx.fillStyle = 'rgb(245,245,245)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`Source: ${scene.source}`, DesignSystem.spacing.safeArea.left, footerTop - 32)
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
    ctx.fillText(timeStr, W - DesignSystem.spacing.safeArea.right, footerTop - 32)
    ctx.restore()
  }
}