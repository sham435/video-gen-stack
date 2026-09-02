// src/video/text/drawStyledText.mjs
//
// Pure canvas-drawing helpers for the narration caption style spec:
//   Font: Montserrat ExtraBold (800) — uses the repo's registered family
//         'Montserrat ExtraBold' (assets/fonts/Montserrat-ExtraBold.ttf).
//   Fill: pure white #FFFFFF
//   Outline: pure black #000000, thickness = 10% of font size (mid-point of
//            the requested 8–12% range)
//
// These are drop-in, dependency-free helpers that accept a live 2D context
// (from @napi-rs/canvas), so they compose with the existing SceneEngine /
// InformationLayer / CaptionLayer renderers — they do NOT create their own
// canvas.
//
//   drawStyledText(ctx, 'STOCK FUTURES FALL', canvasWidth / 2, y, { fontSize: 58 })
//   drawUnderlinedLabel(ctx, 'WHY IT MATTERS', x, y, { fontSize: 46 })

const FONT_FAMILY = 'Montserrat ExtraBold'
const DEFAULT_WEIGHT = 900 // ExtraBold 800 not registered separately; file is ExtraBold

export function drawStyledText(ctx, text, x, y, options = {}) {
  const fontSize = options.fontSize || 58
  const weight = options.weight || DEFAULT_WEIGHT
  const fontFamily = options.fontFamily || FONT_FAMILY
  const strokePct = options.strokePct ?? 0.10 // 10%, within the 8–12% spec range
  const align = options.align || 'center'
  const baseline = options.baseline || 'middle'

  ctx.save()
  ctx.font = `${weight} ${fontSize}px "${fontFamily}"`
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.lineJoin = 'round' // avoids spiky corners on the thick outline
  ctx.miterLimit = 2

  // Outline drawn first, fill on top — standard stroke-then-fill order.
  ctx.lineWidth = fontSize * strokePct
  ctx.strokeStyle = options.strokeColor || '#000000'
  ctx.strokeText(text, x, y)

  ctx.fillStyle = options.fillColor || '#FFFFFF'
  ctx.fillText(text, x, y)

  ctx.restore()
}

// Convenience for underlined labels (e.g. "WHY IT MATTERS"). Draws the text
// then a solid rule beneath it sized to the text's measured width.
export function drawUnderlinedLabel(ctx, text, x, y, options = {}) {
  drawStyledText(ctx, text, x, y, options)

  const fontSize = options.fontSize || 58
  const weight = options.weight || DEFAULT_WEIGHT
  const fontFamily = options.fontFamily || FONT_FAMILY
  ctx.save()
  ctx.font = `${weight} ${fontSize}px "${fontFamily}"`
  const width = ctx.measureText(text).width
  const underlineY = y + fontSize * 0.50
  const underlineThickness = Math.max(3, fontSize * 0.06)

  ctx.strokeStyle = options.underlineColor || options.fillColor || '#FFFFFF'
  ctx.lineWidth = underlineThickness
  ctx.beginPath()
  ctx.moveTo(x - width / 2, underlineY)
  ctx.lineTo(x + width / 2, underlineY)
  ctx.stroke()
  ctx.restore()
}
