import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import {
  LogoBlock,
  BrandBlock,
  PlatformBlock,
  UrlBlock,
  SubscribeBlock,
} from './blocks.mjs'

const F = BROADCAST_TEXT.footer

// Platform badge images are async to load; keep one shared cache so the
// canvas pipeline and standalone PNG generator render the same icons.
const iconCache = {}
export async function loadPlatformIcons() {
  if (iconCache.loaded) return iconCache
  try {
    const { loadImage } = await import('@napi-rs/canvas')
    const fs = await import('fs')
    for (const name of ['apple', 'android']) {
      const p = `assets/logos/${name}.png`
      if (fs.existsSync(p)) iconCache[name] = await loadImage(p)
    }
  } catch {}
  iconCache.loaded = true
  return iconCache
}

/**
 * FooterLayout — single source of truth for the broadcast footer bar.
 *
 * Broadcast grid (fixed 3-column layout, 25% | 50% | 25%):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ [LOGO]  NEWS-MONSTER              [SUBSCRIBE]           │
 *   │         Unfiltered Breaking       video-gen-stack...    │
 *   │         AVAILABLE ON              Unfiltered Global     │
 *   │         Android  Apple            Headlines             │
 *   │                                     @sham435            │
 *   └─────────────────────────────────────────────────────────┘
 *
 *   Left  (25%)  logo + NEWS-MONSTER + tagline + AVAILABLE ON badges
 *   Center(50%)  whitespace — broadcast layouts breathe
 *   Right (25%)  subscribe pill + URL + urlTagline + handle,
 *                right-aligned, URL/tagline moving together
 *
 * The bar bottom-anchors to the frame and is sized by content. showLogo /
 * showHandle are render-data toggles so a view can selectively hide the logo
 * or channel handle without touching the layout engine.
 *
 * LinkedIn safe-area: the bar keeps SAFE_BOTTOM px of clear canvas below it so
 * platform UI never clips the bar's content. Consumers must compute the bar
 * top via barTopInFrame() — never H - barHeight directly.
 */
export class FooterLayout {
  static SAFE_BOTTOM = 64
  static DEFAULT_DATA = {
    brand: 'NEWS-MONSTER',
    // Primary brand message — deliberately shorter and more visible.
    tagline: 'Unfiltered Breaking News',
    // Secondary footer message.
    urlTagline: 'Unfiltered Global Headlines',
    // Display without protocol for cleaner broadcast branding.
    url: 'video-gen-stack-production.up.railway.app',
    // Channel identity.
    handle: '@sham435',
    // Visibility controls — per-render/view overridable.
    showLogo: true,
    showHandle: true,
  }

  /**
   * The bar's top edge in a full frame (H tall): everything below this y is the
   * footer's reserved chrome zone. Ticker / captions / anchor content must dock
   * ABOVE it. The footer owns this contract so consumers never hard-code 180.
   */
  static barTopInFrame(ctx, W, H, data = {}) {
    const { barHeight } = this.compute(ctx, W, data)
    return H - barHeight - this.SAFE_BOTTOM
  }

  /**
   * Measure-only pass. Returns computed geometry:
   *   { scale, barHeight, zones: [{ key, x, y, w, h }],
   *     left:  [{ key, block, x, y, w, h }],
   *     right: [{ key, block, x, y, w, h }] }
   *
   * zones are the three fixed 25/50/25 regions; `left` / `right` are the
   * stacked child boxes inside the left and right zones.
   */
  static compute(ctx, W, data = {}) {
    const D = { ...this.DEFAULT_DATA, ...data }

    // Responsive scale: proportional to the 1080px design surface.
    const scale = Math.min(F.maxScale, Math.max(F.minScale, W / F.baseWidth))

    const padX = Math.max(16, Math.round(F.padding.x * scale))
    const innerW = W - padX * 2
    const zoneW = {
      left: innerW * F.grid.left,
      center: innerW * F.grid.center,
      right: innerW * F.grid.right,
    }
    const vGap = Math.max(10, Math.round(F.lineGap * scale))

    // ── Left zone stack ────────────────────────────────────────────────────
    const leftBlocks = []
    let leftH = 0

    // Logo is independently toggleable.
    if (D.showLogo) {
      const logo = LogoBlock.measure(ctx, scale)
      leftBlocks.push({ key: 'logo', block: LogoBlock, w: logo.w, h: logo.h })
      leftH += logo.h
    }

    // Brand remains visible even when the logo is hidden.
    const brand = BrandBlock.measure(ctx, scale, D)
    if (leftBlocks.length) leftH += vGap
    leftBlocks.push({ key: 'brand', block: BrandBlock, w: brand.w, h: brand.h })
    leftH += brand.h

    // Platform badges (AVAILABLE ON + icons).
    const platform = PlatformBlock.measure(ctx, scale)
    leftH += vGap
    leftBlocks.push({ key: 'platform', block: PlatformBlock, w: platform.w, h: platform.h })
    leftH += platform.h

    // ── Right zone stack ───────────────────────────────────────────────────
    const subscribe = SubscribeBlock.measure(ctx, scale)
    const url = UrlBlock.measure(ctx, scale, D, zoneW.right)
    const rightH = subscribe.h + vGap + url.h

    // Footer height is driven by whichever side needs more vertical space,
    // while preserving the configured minimum.
    const verticalPadding = Math.round(F.padding.y * scale)
    const barHeight = Math.round(Math.max(F.minHeight, leftH, rightH) + verticalPadding * 2)

    const leftX = padX
    const centerX = padX + zoneW.left
    const rightX = padX + zoneW.left + zoneW.center

    const zones = [
      { key: 'left', x: leftX, w: zoneW.left },
      { key: 'center', x: centerX, w: zoneW.center },
      { key: 'right', x: rightX, w: zoneW.right },
    ]

    const leftTop = verticalPadding + (barHeight - leftH - verticalPadding * 2) / 2
    const leftColumns = []
    let currentY = Math.round(leftTop)
    for (let i = 0; i < leftBlocks.length; i++) {
      const item = leftBlocks[i]
      leftColumns.push({ key: item.key, block: item.block, x: leftX, y: currentY, w: item.w, h: item.h })
      currentY += item.h
      if (i < leftBlocks.length - 1) currentY += vGap
    }

    // URL + tagline remain grouped together, right-aligned. The URL text
    // baseline is aligned with the "AVAILABLE ON" label baseline (left zone)
    // when the stack fits; when the channel handle pushes the stack taller
    // than the aligned slot, the whole URL group clamps up to stay inside the
    // bar (safe-area contract — never overflow below the bar).
    const rightTop = leftTop + (leftH - rightH) / 2
    const platformColumn = leftColumns.find((c) => c.key === 'platform')
    const availableBaseline = platformColumn
      ? platformColumn.y + Math.round(F.available.size * scale)
      : rightTop + subscribe.h + vGap
    const urlBaseline = Math.round(F.url.size * scale)
    let urlY = availableBaseline - urlBaseline
    const minUrlY = rightTop + subscribe.h + Math.round(2 * scale) // just below the pill
    if (urlY < minUrlY) urlY = minUrlY // keep below the pill, never overlap
    const urlBottomLimit = barHeight - verticalPadding
    if (urlY + url.h > urlBottomLimit) {
      urlY = Math.max(minUrlY, urlBottomLimit - url.h)
    }

    // Subscribe shifted 50px further right (proportional on smaller surfaces
    // so the button never leaves the canvas).
    const subscribeOffset = Math.round(Math.min(50, Math.max(0, W * 0.04)))
    const subscribeX = Math.min(W - Math.round(8 * scale), rightX + subscribeOffset)

    const rightColumns = [
      { key: 'subscribe', block: SubscribeBlock, x: subscribeX - subscribe.w, y: rightTop, w: subscribe.w, h: subscribe.h },
      { key: 'url', block: UrlBlock, x: rightX - url.w, y: urlY, w: url.w, h: url.h },
    ]

    return { scale, barHeight, zones, left: leftColumns, right: rightColumns, data: D }
  }

  /**
   * Render the footer bar onto ctx. The bar occupies the bottom of the canvas
   * (W x H); H is only used to anchor the bar vertically.
   * Returns the same geometry as compute().
   */
  static draw(ctx, W, H, data = {}, icons = {}) {
    const layout = this.compute(ctx, W, data)
    const { barHeight } = layout
    // Anchor clear of the frame's bottom edge (LinkedIn safe-area).
    const top = H - barHeight - this.SAFE_BOTTOM

    ctx.save()

    // Bar background + hairline border + accent strip
    ctx.fillStyle = F.bg
    ctx.fillRect(0, top, W, barHeight)
    ctx.fillStyle = F.border
    ctx.fillRect(0, top, W, 1)
    ctx.fillStyle = F.accent
    ctx.fillRect(0, top + barHeight - 3, W * 0.3, 3)

    for (const col of [...layout.left, ...layout.right]) {
      col.y = top + col.y
      col.block.draw(ctx, col, layout.scale, layout.data, icons)
    }

    ctx.restore()
    return layout
  }

  /** Standalone footer PNG generator — same geometry as draw(), origin y=0. */
  static renderStandalone(ctx, W, data = {}, icons = {}) {
    const layout = this.compute(ctx, W, data)
    const { barHeight } = layout

    ctx.save()
    ctx.fillStyle = F.bg
    ctx.fillRect(0, 0, W, barHeight)
    ctx.fillStyle = F.border
    ctx.fillRect(0, 0, W, 1)
    ctx.fillStyle = F.accent
    ctx.fillRect(0, barHeight - 3, W * 0.3, 3)

    for (const col of [...layout.left, ...layout.right]) {
      col.block.draw(ctx, { ...col, y: col.y }, layout.scale, layout.data, icons)
    }

    ctx.restore()
    return layout
  }
}
