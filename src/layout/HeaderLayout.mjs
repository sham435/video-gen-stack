import { BROADCAST_TEXT } from '../style/text-tokens.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'

// Header chrome layout — single source of truth for brand pill + LIVE badge
// placement. Used by both BrandingLayer (drawBug) and BroadcastUILayer (draw
// LIVE) so the two always sit together on the same visual centerline with an
// exact gap — never a hard-coded scene coordinate.
//
//   PORTRAIT (9:16, default SHORT_4K) — top-LEFT, unchanged:
//     NEWS-MONSTER    LIVE
//                     ↑ 40px
//
//   WIDE (16:9, VIDEO_HD) — single compact row, RIGHT-aligned at y=40 with a
//     40px safe margin from the right edge. Brand wordmark is rightmost, then
//     the category chip, then LIVE (28px wordmark, 18px pills, 30px pill
//     height):
//     (right edge) ← 40px →
//        [LIVE] [GENERAL] [NEWS-MONSTER]
//
// LinkedIn-safe: portrait content sits 48px inside the frame edges, wide
// content 40px inside, so platform UI (rounded corners, play chrome,
// pillarbox cropping) can never clip the pills.
export const HEADER_GAP = 40
export const HEADER_ORIGIN = { x: 48, y: 48 }
export const HEADER_WIDE_Y = 40 // top of the wide header row
export const HEADER_WIDE_MARGIN = 40 // safe margin from the right edge
export const HEADER_WIDE_GAP = 12 // gap between pills in the wide row
export const HEADER_WIDE_BRAND_SIZE = 28 // brand wordmark px in wide mode
export const HEADER_WIDE_PILL_H = 30 // pill height in wide mode
export const HEADER_WIDE_PILL_FONT = 18 // pill label px in wide mode

function wide() {
  return DesignSystem.isWide
}

// Measure the brand wordmark at its compact wide size (28px).
export function measureWideBrandText(ctx) {
  ctx.save()
  ctx.font = `700 ${HEADER_WIDE_BRAND_SIZE}px Anton, Inter, sans-serif`
  const w = ctx.measureText('NEWS-MONSTER').width
  ctx.restore()
  return w
}

// Returns the measured NEWS-MONSTER pill box { x, y, w, h }.
// Portrait: top-left at origin. Wide: right-aligned compact row at y=40.
export function measureBrandPill(ctx, origin = HEADER_ORIGIN) {
  const bug = BROADCAST_TEXT.bug
  if (wide()) {
    const textW = measureWideBrandText(ctx)
    const w = Math.round(textW) + 28 // 28px horizontal padding (compact)
    const h = HEADER_WIDE_PILL_H
    const x = DesignSystem.W - HEADER_WIDE_MARGIN - w
    return { x, y: HEADER_WIDE_Y, w, h }
  }
  const padX = bug.padding[1]
  const padY = bug.padding[0]
  const font = `700 ${bug.size}px Anton, Inter, sans-serif`
  ctx.save()
  ctx.font = font
  const textW = ctx.measureText('NEWS-MONSTER').width
  ctx.restore()
  return {
    x: origin.x,
    y: origin.y,
    w: Math.round(textW) + padX * 2,
    h: bug.size + padY * 2,
  }
}

// Measures the wide category chip box (18px label).
export function measureWideCategory(ctx, label) {
  ctx.save()
  ctx.font = `700 ${HEADER_WIDE_PILL_FONT}px Inter, sans-serif`
  const textW = ctx.measureText(label).width
  ctx.restore()
  return { w: Math.round(textW) + 24, h: HEADER_WIDE_PILL_H }
}

// Measure the wide LIVE pill (18px "LIVE" label on a red pill).
export function measureWideLivePill(ctx) {
  ctx.save()
  ctx.font = `700 ${HEADER_WIDE_PILL_FONT}px Inter, sans-serif`
  const textW = ctx.measureText('LIVE').width
  ctx.restore()
  return { w: Math.round(textW) + 24, h: HEADER_WIDE_PILL_H }
}

/**
 * Full header layout. Returns:
 *   { brand, live, category, gap, rowY }  (wide: single right-aligned row)
 *   { brand, live, gap }                  (portrait: top-left, unchanged)
 * `brand`/`live` are box geometries { x, y, w, h }; `category` is the wide-mode
 * chip box (undefined in portrait, where the chip is drawn below the header).
 */
export function headerLayout(ctx, origin = HEADER_ORIGIN, categoryLabel = 'TECHNOLOGY') {
  if (wide()) {
    const brand = measureBrandPill(ctx)
    const rowY = brand.y
    const centerY = rowY + brand.h / 2
    const gap = HEADER_WIDE_GAP
    // Right-aligned: brand rightmost, then category chip, then LIVE.
    const cat = measureWideCategory(ctx, (categoryLabel || '').toUpperCase())
    const category = {
      x: brand.x - gap - cat.w,
      y: Math.round(centerY - cat.h / 2),
      w: cat.w,
      h: cat.h,
    }
    const liveBox = measureWideLivePill(ctx)
    const live = {
      x: category.x - gap - liveBox.w,
      y: Math.round(centerY - liveBox.h / 2),
      w: liveBox.w,
      h: liveBox.h,
    }
    return { brand, live, category, gap, rowY }
  }
  return {
    brand: measureBrandPill(ctx, origin),
    live: measureLivePill(ctx, origin),
    gap: HEADER_GAP,
  }
}

// Returns the LIVE pill box placed HEADER_GAP to the right of the brand pill,
// vertically centered on the same centerline (portrait path).
export function measureLivePill(ctx, origin = HEADER_ORIGIN) {
  const live = BROADCAST_TEXT.live
  const pill = measureBrandPill(ctx, origin)
  const padX = live.padding[1]
  const padY = live.padding[0]
  ctx.save()
  ctx.font = `${live.weight} ${live.size}px Inter, sans-serif`
  const textW = ctx.measureText(live.label).width
  ctx.restore()
  const w = Math.round(textW) + padX * 2
  const h = live.size + padY * 2
  const centerY = pill.y + pill.h / 2
  return {
    x: pill.x + pill.w + HEADER_GAP,
    y: Math.round(centerY - h / 2),
    w,
    h,
    pill,
  }
}