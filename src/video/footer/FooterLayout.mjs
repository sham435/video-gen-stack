import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import {
  LogoBlock,
  BrandBlock,
  TaglineBlock,
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
    // Android ships a proper green badge PNG. Apple is a monochrome logo — the
    // asset is stored as a WHITE silhouette so it stays visible on the dark
    // footer (the vector fallback is used if the PNG is missing).
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
 * The footer content is a single right-aligned stack (broadcast layouts dock
 * the brand chrome to the right edge):
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │                                  [NM] NEWS-MONSTER  [SUBSCRIBE]   │
 *   │                                  UNFILTERED BREAKING NEWS         │
 *   │                                  sham435.github.io/video-gen-stack│
 *   │                                  AVAILABLE ON  [Apple] [Android]  │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 *   TOP ROW: NM monogram + NEWS-MONSTER wordmark + SUBSCRIBE pill on one
 *            line, right-aligned (pill rightmost).
 *   LINE 2:  tagline, right-aligned.
 *   LINE 3:  site URL, right-aligned.
 *   LINE 4:  AVAILABLE ON label + platform badges, right-aligned.
 *
 * The bar bottom-anchors to the frame and is sized by content. showLogo is a
 * render-data toggle so a view can selectively hide the logo without touching
 * the layout engine.
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
    tagline: 'UNFILTERED BREAKING NEWS',
    // Display without protocol for cleaner broadcast branding.
    url: 'sham435.github.io/video-gen-stack',
    // Visibility controls — per-render/view overridable.
    showLogo: true,
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
   *     left:  [], right: [{ key, block, x, y, w, h }] }
   *
   * zones preserve the 25/50/25 grid for back-compat; all content lives in a
   * single right-aligned stack (`right`).
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

    // ── Right-aligned stack ────────────────────────────────────────────────
    // TOP ROW: NM monogram + NEWS-MONSTER wordmark + SUBSCRIBE pill on one
    // line, right-aligned (pill rightmost).
    const logo = D.showLogo ? LogoBlock.measure(ctx, scale) : null
    const brand = BrandBlock.measure(ctx, scale, D)
    const subscribe = SubscribeBlock.measure(ctx, scale)
    const logoBrandGap = Math.round(14 * scale)
    const brandPillGap = Math.round(22 * scale)
    const topRowH = Math.max(logo ? logo.h : 0, brand.h, subscribe.h)

    // Row 2: tagline, right-aligned.
    const tagline = TaglineBlock.measure(ctx, scale, D)

    // Row 3: site URL, right-aligned.
    const url = UrlBlock.measure(ctx, scale, D, innerW)

    // Row 4: AVAILABLE ON + platform badges, right-aligned.
    const platform = PlatformBlock.measure(ctx, scale)

    const stackH = topRowH + vGap + tagline.h + vGap + url.h + vGap + platform.h

    const verticalPadding = Math.round(F.padding.y * scale)
    const barHeight = Math.round(Math.max(F.minHeight, stackH) + verticalPadding * 2)

    const leftX = padX
    const centerX = padX + zoneW.left
    const rightX = padX + zoneW.left + zoneW.center
    const rightEdge = W - padX

    const zones = [
      { key: 'left', x: leftX, w: zoneW.left },
      { key: 'center', x: centerX, w: zoneW.center },
      { key: 'right', x: rightX, w: zoneW.right },
    ]

    const stackTop = verticalPadding + (barHeight - stackH - verticalPadding * 2) / 2

    // TOP ROW: [NM] NEWS-MONSTER  [SUBSCRIBE] — right-aligned group.
    const rightColumns = []
    let currentY = Math.round(stackTop)

    const pillX = rightEdge - subscribe.w
    const pillY = currentY + Math.round((topRowH - subscribe.h) / 2)
    rightColumns.push({ key: 'subscribe', block: SubscribeBlock, x: pillX, y: pillY, w: subscribe.w, h: subscribe.h })

    const brandX = pillX - brandPillGap - brand.w
    const brandY = currentY + Math.round((topRowH - brand.h) / 2)
    rightColumns.push({ key: 'brand', block: BrandBlock, x: brandX, y: brandY, w: brand.w, h: brand.h })

    if (logo) {
      const logoX = brandX - logoBrandGap - logo.w
      const logoY = currentY + Math.round((topRowH - logo.h) / 2)
      rightColumns.push({ key: 'logo', block: LogoBlock, x: logoX, y: logoY, w: logo.w, h: logo.h })
    }
    currentY += topRowH + vGap

    // Row 2: tagline — right-aligned to the same edge.
    rightColumns.push({ key: 'tagline', block: TaglineBlock, x: rightEdge - tagline.w, y: currentY, w: tagline.w, h: tagline.h })
    currentY += tagline.h + vGap

    // Row 3: URL — right-aligned to the same edge.
    rightColumns.push({ key: 'url', block: UrlBlock, x: rightEdge - url.w, y: currentY, w: url.w, h: url.h })
    currentY += url.h + vGap

    // Row 4: AVAILABLE ON + badges — right-aligned to the same edge.
    rightColumns.push({ key: 'platform', block: PlatformBlock, x: rightEdge - platform.w, y: currentY, w: platform.w, h: platform.h })

    return { scale, barHeight, zones, left: [], right: rightColumns, data: D }
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
