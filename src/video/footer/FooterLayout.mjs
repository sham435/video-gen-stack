import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'
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
 *   │                                              NEWS-MONSTER [NM]   │
 *   │                                              UNFILTERED BREAKING NEWS│
 *   │                                              sham435.github.io/video-gen-stack│
 *   │                                    [SUBSCRIBE] AVAILABLE ON [Apple] [Android]│
 *   └──────────────────────────────────────────────────────────────────┘
 *
 *   TOP ROW: NEWS-MONSTER wordmark left of the [NM] monogram badge — badge
 *            rightmost at the frame edge (40px safe right margin).
 *   LINE 2:  tagline (32px, slightly smaller than the wordmark), right-aligned.
 *   LINE 3:  site URL, right-aligned.
 *   LINE 4:  SUBSCRIBE pill left of the AVAILABLE ON label + platform
 *            badges, whole group right-aligned.
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
  // LinkedIn safe-area: px of clear canvas reserved below the bar so platform
  // UI never clips its content. The 9:16 portrait design keeps 64px of clear
  // canvas below the bar. The compact 16:9 footer is BOTTOM-ANCHORED directly
  // against the frame's bottom edge (production 16:9 spec) — it must not
  // float above the edge, so it reserves no clear canvas on wide frames.
  static get SAFE_BOTTOM() {
    return DesignSystem.isWide ? 0 : 64
  }
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

    // 16:9 production spec — the footer is a single compact, bottom-anchored,
    // horizontally centered branding strip (not a multi-row information panel).
    if (DesignSystem.isWide) return this._computeWide(ctx, W, D)

    const scale = Math.min(F.maxScale, Math.max(F.minScale, W / F.baseWidth))
    const minHeight = F.minHeight

    const padX = Math.max(16, Math.round(F.padding.x * scale))
    const innerW = W - padX * 2
    const zoneW = {
      left: innerW * F.grid.left,
      center: innerW * F.grid.center,
      right: innerW * F.grid.right,
    }
    const vGap = Math.max(10, Math.round(F.lineGap * scale))

    // ── Right-aligned stack ────────────────────────────────────────────────
    // TOP ROW: NM monogram + NEWS-MONSTER wordmark, rightmost at the edge.
    const logo = D.showLogo ? LogoBlock.measure(ctx, scale) : null
    const brand = BrandBlock.measure(ctx, scale, D)
    const logoBrandGap = Math.round(14 * scale)
    const topRowH = Math.max(logo ? logo.h : 0, brand.h)

    // Row 2: tagline (same size as the wordmark), right-aligned.
    const tagline = TaglineBlock.measure(ctx, scale, D)

    // Row 3: site URL, right-aligned.
    const url = UrlBlock.measure(ctx, scale, D, innerW)

    // Row 4: SUBSCRIBE pill left of AVAILABLE ON label + platform badges,
    // whole group right-aligned.
    const subscribe = SubscribeBlock.measure(ctx, scale)
    const platform = PlatformBlock.measure(ctx, scale)
    const pillPlatformGap = Math.round(18 * scale)
    const platformRowH = Math.max(subscribe.h, platform.h)

    const stackH = topRowH + vGap + tagline.h + vGap + url.h + vGap + platformRowH

    const verticalPadding = Math.round(F.padding.y * scale)
    const barHeight = Math.round(Math.max(minHeight, stackH) + verticalPadding * 2)

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

    // TOP ROW: NEWS-MONSTER wordmark left of the [NM] badge — badge rightmost
    // at the frame edge.
    const rightColumns = []
    let currentY = Math.round(stackTop)

    if (logo) {
      const logoX = rightEdge - logo.w
      const logoY = currentY + Math.round((topRowH - logo.h) / 2)
      rightColumns.push({ key: 'logo', block: LogoBlock, x: logoX, y: logoY, w: logo.w, h: logo.h })

      const brandX = logoX - logoBrandGap - brand.w
      const brandY = currentY + Math.round((topRowH - brand.h) / 2)
      rightColumns.push({ key: 'brand', block: BrandBlock, x: brandX, y: brandY, w: brand.w, h: brand.h })
    } else {
      const brandX = rightEdge - brand.w
      const brandY = currentY + Math.round((topRowH - brand.h) / 2)
      rightColumns.push({ key: 'brand', block: BrandBlock, x: brandX, y: brandY, w: brand.w, h: brand.h })
    }
    currentY += topRowH + vGap

    // Row 2: tagline — right-aligned to the same edge.
    rightColumns.push({ key: 'tagline', block: TaglineBlock, x: rightEdge - tagline.w, y: currentY, w: tagline.w, h: tagline.h })
    currentY += tagline.h + vGap

    // Row 3: URL — right-aligned to the same edge.
    rightColumns.push({ key: 'url', block: UrlBlock, x: rightEdge - url.w, y: currentY, w: url.w, h: url.h })
    currentY += url.h + vGap

    // Row 4: [SUBSCRIBE] AVAILABLE ON [Apple] [Android] — pill left of the
    // platform group, whole row right-aligned.
    const platformX = rightEdge - platform.w
    const platformY = currentY + Math.round((platformRowH - platform.h) / 2)
    rightColumns.push({ key: 'platform', block: PlatformBlock, x: platformX, y: platformY, w: platform.w, h: platform.h })

    const pillX = platformX - pillPlatformGap - subscribe.w
    const pillY = currentY + Math.round((platformRowH - subscribe.h) / 2)
    rightColumns.push({ key: 'subscribe', block: SubscribeBlock, x: pillX, y: pillY, w: subscribe.w, h: subscribe.h })

    return { scale, barHeight, zones, left: [], right: rightColumns, data: D }
  }

  /**
   * 16:9 compact footer (production spec). A SINGLE bottom-anchored, centered
   * branding strip rather than the tall multi-row portrait panel:
   *
   *   ┌────────────────────────────────────────────────────────────┐
   *   │  sham435…            NEWS-MONSTER                 SUBSCRIBE │
   *   │◄────────────────────── red accent line ───────────────────►│
   *   └────────────────────────────────────────────────────────────┘
   *
   * barHeight is ~30% of the portrait bar. Content sits on ONE centered row
   * (brand wordmark + monogram in the middle, muted domain on the left, a
   * compact Subscribe pill on the right). The red accent is drawn at the
   * frame's actual bottom boundary (draw()/renderStandalone).
   *
   * Items are stored on `right` so existing consumers that iterate the stack
   * keep working; the compact strip exposes `wide: true`.
   */
  static _computeWide(ctx, W, data) {
    // Compact single-row scale: proportional to the frame HEIGHT (the 16:9
    // footer is a short strip, not the tall 1080-wide portrait panel). Falls
    // back to the portrait min-scale so glyphs stay legible on small frames.
    const H = DesignSystem.H
    const scale = Math.max(F.minScale, Math.min(1, H / 960))

    const padX = Math.max(16, Math.round(W * 0.02))
    const innerW = W - padX * 2
    const zoneW = {
      left: innerW * F.grid.left,
      center: innerW * F.grid.center,
      right: innerW * F.grid.right,
    }
    const zones = [
      { key: 'left', x: padX, w: Math.round(zoneW.left) },
      { key: 'center', x: padX + Math.round(zoneW.left), w: Math.round(zoneW.center) },
      { key: 'right', x: padX + Math.round(zoneW.left + zoneW.center), w: Math.round(zoneW.right) },
    ]

    // Single centered row: [NM] NEWS-MONSTER in the middle.
    const logo = data.showLogo ? LogoBlock.measure(ctx, scale) : null
    const brand = BrandBlock.measure(ctx, scale, data)
    const logoBrandGap = Math.round(14 * scale)
    const rowH = Math.max(logo ? logo.h : 0, brand.h)

    // Right: compact Subscribe pill. Left: muted domain.
    const subscribe = SubscribeBlock.measure(ctx, scale)
    const url = UrlBlock.measure(ctx, scale, data, innerW * 0.32)

    // barHeight hugs the single row (compact strip) within the 92–100% zone.
    const verticalPadding = Math.round(F.padding.y * scale)
    const barHeight = Math.max(rowH + verticalPadding * 2 + Math.round(5 * scale), Math.round(H * 0.06))
    const midY = Math.round(barHeight / 2)

    const columns = []
    // Center: brand + monogram as a pair, horizontally centered on the frame.
    // Center around the PAIR's bounding box (not the gap) so the whole central
    // group sits on the frame's horizontal middle.
    const centerCX = W / 2
    if (logo) {
      const pairW = brand.w + logoBrandGap + logo.w
      const pairLeft = Math.round(centerCX - pairW / 2)
      columns.push({ key: 'brand', block: BrandBlock, x: pairLeft, y: midY - Math.round(brand.h / 2), w: brand.w, h: brand.h })
      columns.push({ key: 'logo', block: LogoBlock, x: pairLeft + brand.w + logoBrandGap, y: midY - Math.round(logo.h / 2), w: logo.w, h: logo.h })
    } else {
      columns.push({ key: 'brand', block: BrandBlock, x: Math.round(centerCX - brand.w / 2), y: midY - Math.round(brand.h / 2), w: brand.w, h: brand.h })
    }
    // Left: domain; Right: Subscribe pill.
    columns.push({ key: 'url', block: UrlBlock, x: Math.round(padX), y: midY - Math.round(url.h / 2), w: url.w, h: url.h })
    columns.push({ key: 'subscribe', block: SubscribeBlock, x: Math.round(W - padX - subscribe.w), y: midY - Math.round(subscribe.h / 2), w: subscribe.w, h: subscribe.h })

    return { scale, barHeight, zones, left: [], right: columns, data, wide: true }
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
    if (layout.wide) {
      // 16:9: the red accent becomes the actual bottom boundary of the frame
      // (full width, at the very bottom edge) — not a separated lower panel.
      ctx.fillStyle = F.accent
      ctx.fillRect(0, H - 3, W, 3)
    } else {
      ctx.fillStyle = F.border
      ctx.fillRect(0, top, W, 1)
      ctx.fillStyle = F.accent
      ctx.fillRect(0, top + barHeight - 3, W * 0.3, 3)
    }

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
    if (layout.wide) {
      // 16:9 standalone — red accent spans the strip's bottom edge.
      ctx.fillStyle = F.accent
      ctx.fillRect(0, barHeight - 3, W, 3)
    } else {
      ctx.fillStyle = F.border
      ctx.fillRect(0, 0, W, 1)
      ctx.fillStyle = F.accent
      ctx.fillRect(0, barHeight - 3, W * 0.3, 3)
    }

    for (const col of [...layout.left, ...layout.right]) {
      col.block.draw(ctx, { ...col, y: col.y }, layout.scale, layout.data, icons)
    }

    ctx.restore()
    return layout
  }
}
