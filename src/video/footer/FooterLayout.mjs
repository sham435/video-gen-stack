import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import {
  LogoBlock,
  ChannelBlock,
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
    // Android ships a proper green badge PNG. Apple is a monochrome logo — the
    // asset is stored as a WHITE silhouette so it stays visible on the dark
    // footer (the vector fallback is used if the PNG is missing).
    for (const name of ['apple', 'android']) {
      const p = `assets/logos/${name}.png`
      if (fs.existsSync(p)) iconCache[name] = await loadImage(p)
    }
    // Channel avatar (@sham435) — served as JPEG by YouTube, next to NM logo.
    for (const f of ['assets/logos/channel-avatar.jpg', 'assets/logos/channel-avatar.png']) {
      if (fs.existsSync(f) && !iconCache.avatar) {
        try { iconCache.avatar = await loadImage(fs.readFileSync(f)) } catch {}
      }
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
 *   │ [LOGO]  [@sham435]        [SUBSCRIBE]                   │
 *   │          NEWS-MONSTER     sham435.github.io…            │
 *   │          Unfiltered       Unfiltered Global             │
 *   │          Breaking News    Headlines                     │
 *   │          AVAILABLE ON                                   │
 *   │          Android  Apple                                 │
 *   └─────────────────────────────────────────────────────────┘
 *
 *   Left  (25%)  NM monogram + channel avatar/handle on one row,
 *                then NEWS-MONSTER + tagline + AVAILABLE ON badges
 *   Center(50%)  whitespace — broadcast layouts breathe
 *   Right (25%)  subscribe pill + URL + urlTagline,
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
    url: 'sham435.github.io/video-gen-stack',
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
    let leftH = 0

    // Row 1: NM monogram + channel avatar/handle sit side by side, vertically
    // centered together. The monogram is the anchor; the avatar renders at 80%
    // of the monogram size so it reads as an identity mark beside the brand
    // cube, and the @handle follows the avatar.
    const logo = D.showLogo ? LogoBlock.measure(ctx, scale) : null
    const channel = ChannelBlock.measure(ctx, scale, D)
    const rowGap = Math.round(12 * scale) // horizontal gap monogram ↔ avatar
    const topRowH = Math.max(logo ? logo.h : 0, channel.h)
    leftH += topRowH

    // Brand remains visible even when the logo is hidden.
    const brand = BrandBlock.measure(ctx, scale, D)
    leftH += vGap
    leftH += brand.h

    // Platform badges (AVAILABLE ON + icons).
    const platform = PlatformBlock.measure(ctx, scale)
    leftH += vGap
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

    // Row 1: NM monogram + channel avatar/handle — vertically centered on the
    // same line, monogram anchoring the row.
    if (logo) {
      const ly = currentY + Math.round((topRowH - logo.h) / 2)
      leftColumns.push({ key: 'logo', block: LogoBlock, x: leftX, y: ly, w: logo.w, h: logo.h })
    }
    const channelX = leftX + (logo ? logo.w + rowGap : 0)
    const channelY = currentY + Math.round((topRowH - channel.h) / 2)
    leftColumns.push({ key: 'channel', block: ChannelBlock, x: channelX, y: channelY, w: channel.w, h: channel.h })
    currentY += topRowH + vGap

    // Row 2: brand + tagline.
    leftColumns.push({ key: 'brand', block: BrandBlock, x: leftX, y: currentY, w: brand.w, h: brand.h })
    currentY += brand.h + vGap

    // Row 3: AVAILABLE ON + platform badges.
    leftColumns.push({ key: 'platform', block: PlatformBlock, x: leftX, y: currentY, w: platform.w, h: platform.h })

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
      // URL column spans the full right zone (right-aligned to its right
      // edge) so the URL + urlTagline + handle group docks at the frame edge,
      // never mid-screen. UrlBlock right-aligns within box.x .. box.x+box.w.
      { key: 'url', block: UrlBlock, x: rightX, y: urlY, w: zoneW.right, h: url.h },
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
