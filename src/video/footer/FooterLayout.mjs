import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import {
  LogoBlock,
  BrandBlock,
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
 * The 16:9 footer is a single COMPACT, bottom-anchored, horizontally centered
 * branding strip (production spec) rather than a tall information panel:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  sham435…            NEWS-MONSTER                 SUBSCRIBE │
 *   │◄────────────────────── red accent line ───────────────────►│
 *   └────────────────────────────────────────────────────────────┘
 *
 * Content rests on ONE centered row: NEWS-MONSTER wordmark left of the [NM]
 * monogram badge in the middle, the muted site domain on the left, and a
 * compact Subscribe pill on the right. The red accent is drawn at the frame's
 * actual bottom boundary (draw()/renderStandalone).
 *
 * showLogo is a render-data toggle so a view can selectively hide the logo
 * without touching the layout engine. The bar bottom-anchors flush against the
 * frame's bottom edge (SAFE_BOTTOM = 0). Consumers must compute the bar top via
 * barTopInFrame() — never H - barHeight directly.
 */
export class FooterLayout {
  // The compact 16:9 footer is BOTTOM-ANCHORED directly against the frame's
  // bottom edge (production 16:9 spec) — it must not float above the edge, so
  // it reserves no clear canvas below the bar.
  static SAFE_BOTTOM = 0
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
   * Measure-only pass. Returns the compact 16:9 strip geometry:
   *   { scale, barHeight, zones: [{ key, x, y, w, h }],
   *     left:  [], right: [{ key, block, x, y, w, h }], wide: true }
   *
   * The strip is a single centered row: brand wordmark + monogram pair in the
   * horizontal middle, muted domain on the left, Subscribe pill on the right.
   * Content lives on `right` so existing stack consumers keep working.
   */
  static compute(ctx, W, data = {}) {
    const D = { ...this.DEFAULT_DATA, ...data }

    // Compact single-row scale: proportional to the frame HEIGHT (the 16:9
    // footer is a short strip). Falls back to the min-scale so glyphs stay
    // legible on small frames.
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
    const logo = D.showLogo ? LogoBlock.measure(ctx, scale) : null
    const brand = BrandBlock.measure(ctx, scale, D)
    const logoBrandGap = Math.round(14 * scale)
    const rowH = Math.max(logo ? logo.h : 0, brand.h)

    // Right: compact Subscribe pill. Left: muted domain.
    const subscribe = SubscribeBlock.measure(ctx, scale)
    const url = UrlBlock.measure(ctx, scale, D, innerW * 0.32)

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

    return { scale, barHeight, zones, left: [], right: columns, data: D, wide: true }
  }

  /**
   * Render the footer bar onto ctx. The bar occupies the bottom of the canvas
   * (W x H); H is only used to anchor the bar vertically.
   * Returns the same geometry as compute().
   */
  static draw(ctx, W, H, data = {}, icons = {}) {
    const layout = this.compute(ctx, W, data)
    const { barHeight } = layout
    // Anchor flush against the frame's bottom edge (SAFE_BOTTOM = 0).
    const top = H - barHeight - this.SAFE_BOTTOM

    ctx.save()

    // Bar background + red accent at the actual bottom boundary of the frame
    // (full width, at the very bottom edge) — not a separated lower panel.
    ctx.fillStyle = F.bg
    ctx.fillRect(0, top, W, barHeight)
    ctx.fillStyle = F.accent
    ctx.fillRect(0, H - 3, W, 3)

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
    // Red accent spans the strip's bottom edge.
    ctx.fillStyle = F.bg
    ctx.fillRect(0, 0, W, barHeight)
    ctx.fillStyle = F.accent
    ctx.fillRect(0, barHeight - 3, W, 3)

    for (const col of [...layout.left, ...layout.right]) {
      col.block.draw(ctx, { ...col, y: col.y }, layout.scale, layout.data, icons)
    }

    ctx.restore()
    return layout
  }
}
