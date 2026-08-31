import { BROADCAST_TEXT } from '../style/text-tokens.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'

// Header chrome layout — single source of truth for brand pill + LIVE badge
// + category chip placement. Used by both BrandingLayer (drawBug) and
// BroadcastUILayer (draw LIVE) so they always sit together on the same
// visual centerline with an exact gap — never a hard-coded scene coordinate.
//
// The pipeline is 16:9 ONLY. The header is a single compact row, RIGHT-aligned
// at y=40 with a 40px safe margin from the right edge. Brand wordmark is
// rightmost, then the category chip, then LIVE:
//
//     (right edge) ← 40px →
//        [LIVE] [CATEGORY] [NEWS-MONSTER]
//
// The row sits 40px inside the frame edges so platform UI (rounded corners,
// play chrome, pillarbox cropping) can never clip the pills.

// Gap between pills in the compact header row.
export const HEADER_GAP = 12
// Top of the header row.
export const HEADER_WIDE_Y = 40
// Safe margin from the right frame edge.
export const HEADER_WIDE_MARGIN = 40
// Brand wordmark size (px) in the compact header.
export const HEADER_WIDE_BRAND_SIZE = 28
// Pill height in the compact header.
export const HEADER_WIDE_PILL_H = 30
// Pill label font size (px) in the compact header.
export const HEADER_WIDE_PILL_FONT = 18

// Measure the brand wordmark at its compact size (28px).
export function measureWideBrandText(ctx) {
  ctx.save()
  ctx.font = `700 ${HEADER_WIDE_BRAND_SIZE}px Anton, Inter, sans-serif`
  const w = ctx.measureText('NEWS-MONSTER').width
  ctx.restore()
  return w
}

// Returns the measured NEWS-MONSTER pill box { x, y, w, h }.
// Right-aligned compact row at y=40.
export function measureBrandPill(ctx) {
  const textW = measureWideBrandText(ctx)
  const w = Math.round(textW) + 28 // 28px horizontal padding (compact)
  const h = HEADER_WIDE_PILL_H
  const x = DesignSystem.W - HEADER_WIDE_MARGIN - w
  return { x, y: HEADER_WIDE_Y, w, h }
}

// Measures the category chip box (18px label).
export function measureWideCategory(ctx, label) {
  ctx.save()
  ctx.font = `700 ${HEADER_WIDE_PILL_FONT}px Inter, sans-serif`
  const textW = ctx.measureText(label).width
  ctx.restore()
  return { w: Math.round(textW) + 24, h: HEADER_WIDE_PILL_H }
}

// Measure the LIVE pill (18px "LIVE" label on a red pill).
export function measureWideLivePill(ctx) {
  ctx.save()
  ctx.font = `700 ${HEADER_WIDE_PILL_FONT}px Inter, sans-serif`
  const textW = ctx.measureText('LIVE').width
  ctx.restore()
  return { w: Math.round(textW) + 24, h: HEADER_WIDE_PILL_H }
}

/**
 * Full header layout — a single right-aligned compact row.
 * Returns { brand, live, category, gap, rowY }:
 *   `brand`/`live`/`category` are box geometries { x, y, w, h }.
 */
export function headerLayout(ctx, origin = undefined, categoryLabel = 'TECHNOLOGY') {
  const brand = measureBrandPill(ctx)
  const rowY = brand.y
  const centerY = rowY + brand.h / 2
  const gap = HEADER_GAP
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
