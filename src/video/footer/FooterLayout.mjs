import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import {
  LogoBlock,
  BrandBlock,
  PlatformBlock,
  UrlBlock,
  SubscribeBlock,
  FONT_BRAND,
} from './blocks.mjs'

const F = BROADCAST_TEXT.footer

// Platform badge images are async to load; keep one shared cache so the
// canvas pipeline and the standalone PNG generator render the same icons.
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
 *   │ [LOGO]  AVAILABLE ON                  [SUBSCRIBE]        │
 *   │          Android  Apple                                 │
 *   │                                  sham435.github.io/...   │
 *   │                                  tagline / tagline 2     │
 *   └─────────────────────────────────────────────────────────┘
 *
 *   Left  (25%)  logo + "AVAILABLE ON" + badge icons (static)
 *   Center(50%)  whitespace — broadcast layouts breathe
 *   Right (25%)  subscribe pill + URL + tagline, right-aligned,
 *                URL/tagline moving together as a group
 *
 * The bar bottom-anchors to the frame and is sized by content, so it scales
 * cleanly across 9:16, 1:1 and 16:9 without collisions while the reserved
 * bottom safe zone (footer bar) stays free of captions.
 *
 * LinkedIn safe-area: the bar keeps SAFE_BOTTOM px of clear canvas below it so
 * platform UI (rounded corners, play/progress chrome, pillarbox cropping) never
 * clips the bar's content. Consumers must compute the bar top via
 * barTopInFrame() — never H - barHeight directly.
 */
export class FooterLayout {
  static SAFE_BOTTOM = 64
  static DEFAULT_DATA = {
    brand: 'NEWS-MONSTER',
    tagline: 'Breaking News, AI, Science, Sports & Future Tech',
    url: 'https://video-gen-stack-production.up.railway.app/',
    urlTagline: 'Open Source AI Video Platform',
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
    let scale = Math.min(F.maxScale, Math.max(F.minScale, W / F.baseWidth))

    const padX = Math.max(16, Math.round(F.padding.x * scale))
    const innerW = W - padX * 2
    const zoneW = { left: innerW * F.grid.left, center: innerW * F.grid.center, right: innerW * F.grid.right }
    const vGap = Math.max(10, Math.round(F.lineGap * scale))

    // Stack heights inside each end zone.
    const logo = LogoBlock.measure(ctx, scale)
    const brand = BrandBlock.measure(ctx, scale, D)
    const platform = PlatformBlock.measure(ctx, scale)
    const leftH = logo.h + vGap + brand.h + vGap + platform.h

    const subscribe = SubscribeBlock.measure(ctx, scale)
    const url = UrlBlock.measure(ctx, scale, D, zoneW.right)
    const rightH = subscribe.h + vGap + url.h

    const barHeight = Math.round(Math.max(F.minHeight, leftH, rightH) + Math.round(F.padding.y * scale) * 2)

    const leftX = padX
    const centerX = padX + zoneW.left
    const rightX = padX + zoneW.left + zoneW.center

    const zones = [
      { key: 'left', x: leftX, w: zoneW.left },
      { key: 'center', x: centerX, w: zoneW.center },
      { key: 'right', x: rightX, w: zoneW.right },
    ]

    // Left zone stack: logo, NEWS-MONSTER wordmark, AVAILABLE ON + icons.
    const leftTop = Math.round(F.padding.y * scale) + (barHeight - leftH - Math.round(F.padding.y * scale) * 2) / 2
    const leftColumns = [
      { key: 'logo', block: LogoBlock, x: leftX, y: leftTop, w: logo.w, h: logo.h },
      { key: 'brand', block: BrandBlock, x: leftX, y: leftTop + logo.h + vGap, w: brand.w, h: brand.h },
      { key: 'platform', block: PlatformBlock, x: leftX, y: leftTop + logo.h + vGap + brand.h + vGap, w: platform.w, h: platform.h },
    ]

    // Right zone: pill on top, URL + tagline beneath — right-aligned group.
    // The URL text baseline is aligned with the "AVAILABLE ON" label baseline
    // (left zone) so the two brand lines sit on the same optical line.
    const rightTop = leftTop + (leftH - rightH) / 2
    const platformY = leftTop + logo.h + vGap + brand.h + vGap
    const availableBaseline = platformY + Math.round(F.available.size * scale)
    const urlBaseline = Math.round(F.url.size * scale)
    let urlY = availableBaseline - urlBaseline
    const minUrlY = rightTop + subscribe.h + Math.round(2 * scale) // just below the pill
    if (urlY < minUrlY) urlY = minUrlY // keep below the pill, never overlap
    const rightColumns = [
      { key: 'subscribe', block: SubscribeBlock, x: rightX - subscribe.w, y: rightTop, w: subscribe.w, h: subscribe.h },
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

  /** Legacy alias for the standalone footer PNG generator. */
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

    const top = 0
    for (const col of layout.left) {
      col.block.draw(ctx, { ...col, y: top + col.y }, layout.scale, layout.data, icons)
    }

    ctx.restore()
    return layout
  }
}