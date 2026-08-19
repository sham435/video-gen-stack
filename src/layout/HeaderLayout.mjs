import { BROADCAST_TEXT } from '../style/text-tokens.mjs'

// Header chrome layout — single source of truth for top-left brand pill +
// LIVE badge placement. Used by both BrandingLayer (drawBug) and
// BroadcastUILayer (draw LIVE) so the two always sit on the same visual
// centerline with an exact gap — never a hard-coded scene coordinate.
//
//   NEWS-MONSTER    LIVE
//                   ↑ 40px
//
// LinkedIn-safe layout: content sits 48px inside the frame edges so platform
// UI (rounded corners, progress/play chrome, pillarbox cropping) can never
// clip the brand pill or the LIVE badge.
export const HEADER_GAP = 40
export const HEADER_ORIGIN = { x: 48, y: 48 }

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
  return {
    x: origin.x,
    y: origin.y,
    w: Math.round(textW) + padX * 2,
    h: bug.size + padY * 2,
  }
}

// Returns the LIVE pill box placed HEADER_GAP to the right of the brand pill,
// vertically centered on the same centerline.
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

export const headerLayout = (ctx, origin = HEADER_ORIGIN) => ({
  brand: measureBrandPill(ctx, origin),
  live: measureLivePill(ctx, origin),
  gap: HEADER_GAP,
})