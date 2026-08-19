import { BROADCAST_TEXT } from '../style/text-tokens.mjs'

// Header chrome layout — single source of truth for the brand pill + LIVE
// badge + category chip placement. Used by BrandingLayer (drawBug),
// BroadcastUILayer (LIVE + chip) so all three always sit on the same
// geometry — never a hard-coded scene coordinate.
//
// Two modes, selected by the canvas aspect ratio:
//
//   LinkedIn-safe (non-portrait) layout — content sits 48px inside the
//   frame edges so platform UI (rounded corners, progress/play chrome,
//   pillarbox cropping) can never clip the brand pill or LIVE badge.
//
//   NEWS-MONSTER    LIVE
//                   ↑ 40px
//
//   YouTube Shorts (9:16) layout — the native player overlays its controls
//   on top of the frame: Pause + Volume at top-left (~y 40-150), the 3-dot
//   menu at the top-right, and Like/Comment/Subscribe down the right middle.
//   Nothing may render in the top 160px or right 120px. The whole header
//   shifts DOWN below that band and RIGHT-aligns to the 40px safe margin
//   (the same 40px the footer asset uses):
//
//   [y 0-160]  EMPTY — YouTube controls own this band
//   [y 170]    NEWS-MONSTER            (rightmost)
//   [y 170+74+24]  LIVE  [TESLA chip]  (right-aligned row below the brand)
export const HEADER_GAP = 40
export const HEADER_ORIGIN = { x: 48, y: 48 }
export const CHIP_H = 26

// YouTube Shorts 9:16 safe zones (verified against the native player UI).
export const SHORTS_SAFE = {
  topDanger: 160, // No chrome above this — Pause/Volume/LIVE overlap live here
  right: 40, // Same safe margin as the footer asset (never cropped)
  row1: 170, // Brand row top, below the controls band
  rowGap: 24, // Clearance between brand row and LIVE+chip row
}

// 9:16 portrait canvases are Shorts; everything else keeps the classic layout.
function isShorts(ctx) {
  return Boolean(ctx?.canvas && ctx.canvas.height > ctx.canvas.width)
}

// Returns the measured NEWS-MONSTER pill box { x, y, w, h }.
export function measureBrandPill(ctx, origin = HEADER_ORIGIN) {
  const bug = BROADCAST_TEXT.bug
  const padX = bug.padding[1]
  const padY = bug.padding[0]
  const font = `700 ${bug.size}px Anton, Inter, sans-serif`
  ctx.save()
  ctx.font = font
  const textW = ctx.measureText('NEWS-MONSTER').width
  ctx.restore()
  const w = Math.round(textW) + padX * 2
  const h = bug.size + padY * 2
  if (isShorts(ctx)) {
    // Right-aligned to the 40px safe margin, below the controls band.
    return { x: ctx.canvas.width - SHORTS_SAFE.right - w, y: SHORTS_SAFE.row1, w, h }
  }
  return { x: origin.x, y: origin.y, w, h }
}

// Returns the LIVE pill box: classic layout sits it HEADER_GAP right of the
// brand pill on the same centerline; Shorts layout sits it on a right-aligned
// row BELOW the brand, left of the category chip (chipWidth lets the two stay
// clear of the right 40px safe margin).
export function measureLivePill(ctx, origin = HEADER_ORIGIN, chipWidth = 0) {
  const live = BROADCAST_TEXT.live
  const padX = live.padding[1]
  const padY = live.padding[0]
  ctx.save()
  ctx.font = `${live.weight} ${live.size}px Inter, sans-serif`
  const textW = ctx.measureText(live.label).width
  ctx.restore()
  const w = Math.round(textW) + padX * 2
  const h = live.size + padY * 2
  if (isShorts(ctx)) {
    const Wc = ctx.canvas.width
    const pill = measureBrandPill(ctx, origin)
    const row2Center = pill.y + pill.h + SHORTS_SAFE.rowGap + CHIP_H / 2
    return {
      x: Wc - SHORTS_SAFE.right - chipWidth - 12 - w,
      y: Math.round(row2Center - h / 2),
      w,
      h,
      pill,
    }
  }
  const pill = measureBrandPill(ctx, origin)
  const centerY = pill.y + pill.h / 2
  return {
    x: pill.x + pill.w + HEADER_GAP,
    y: Math.round(centerY - h / 2),
    w,
    h,
    pill,
  }
}

// Full header geometry: brand pill, LIVE pill and the category chip slot
// ({ x, y, w, h } — w is the caller's measured chip width). chipWidth must be
// passed so the Shorts row can right-align LIVE + chip against W - 40.
export const headerLayout = (ctx, opts = {}) => {
  const { origin = HEADER_ORIGIN, chipWidth = 0 } = opts
  const brand = measureBrandPill(ctx, origin)
  const live = measureLivePill(ctx, origin, chipWidth)
  const shorts = isShorts(ctx)
  let chip
  if (shorts) {
    const Wc = ctx.canvas.width
    const row2Center = brand.y + brand.h + SHORTS_SAFE.rowGap + CHIP_H / 2
    chip = { x: Wc - SHORTS_SAFE.right - chipWidth, y: Math.round(row2Center - CHIP_H / 2), w: chipWidth, h: CHIP_H }
  } else {
    chip = { x: brand.x, y: brand.y + brand.h + 12, w: chipWidth, h: CHIP_H }
  }
  return { brand, live, chip, gap: HEADER_GAP, shorts }
}