// src/video/layers/NarrationCalloutLayer.mjs
//
// "WHY IT MATTERS" underlined label + 2-line yellow callout sub-state.
//
// Per the cinematic refinement spec, this is a SHORT transitional text block
// that bridges a narration caption toward the scene's end (and toward the
// outro). It appears ONLY in scenes that carry audio narration — there is no
// callout in speech-less scenes, keeping the "no silent scenes but no invented
// filler" invariant.
//
// Sequence within a narration scene's center stage:
//   caption (spoken sentence, STATE 2)  ->  "WHY IT MATTERS" (underlined)
//   ->  2-line yellow callout  ->  (scene ends / outro)
//
// Style: white fill #FFFFFF + black 10% outline (matches drawStyledText).
// Yellow callout uses the existing brand accent, NOT a hardcoded second yellow.
//
// This layer draws CENTER-STAGE in the heart of the narration window, and
// extends the scene's on-screen text so the narration is always paired with
// readable text (the "no silent scenes" invariant).

import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawStyledText, drawUnderlinedLabel } from '../text/drawStyledText.mjs'

const YELLOW_ACCENT = '#FFE600' // broadcast brand yellow used across chrome

// Render the "WHY IT MATTERS" + 2-line yellow callout block for a scene.
// - `labelT`: eased 0..1 progress for the underlined label.
// - `body`:   the callout text (already capped at 2 lines by the caller).
// Returns nothing; draws onto `ctx`.
export class NarrationCalloutLayer {
  draw(ctx, scene, progress, labelT = 1, body = '') {
    const { W, H, sy } = DesignSystem
    if (!body) return

    const labelSize = Math.max(34, SyLabel(H))
    const labelY = H * 0.32

    // 1) underlined "WHY IT MATTERS" — white / black outline
    if (labelT > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, labelT)
      drawUnderlinedLabel(
        ctx,
        'WHY IT MATTERS',
        W / 2,
        labelY,
        {
          fontSize: labelSize,
          fillColor: '#FFFFFF',
          strokeColor: '#000000',
          strokePct: 0.10,
          underlineColor: DesignSystem.brand.primary,
        }
      )
      ctx.restore()
    }

    // 2) 2-line yellow callout — wrapped to 2 lines by the caller's text
    //    budget; drawn center-stage beneath the label in brand yellow.
    const calloutSize = Math.max(30, SyBody(H))
    const lineH = calloutSize * 1.5
    const lines = body.split('\n')
    const totalH = lines.length * lineH
    let y = H * 0.32 + labelSize * 1.6 - totalH / 2 + sy(20)
    ctx.save()
    ctx.globalAlpha = Math.min(1, progress)
    for (const line of lines) {
      drawStyledText(
        ctx,
        line,
        W / 2,
        y,
        {
          fontSize: calloutSize,
          fillColor: YELLOW_ACCENT,
          strokeColor: '#000000',
          strokePct: 0.06, // thinner stroke for the yellow accent
        }
      )
      y += lineH
    }
    ctx.restore()
  }
}

function SyLabel(H) {
  return Math.round(H * 0.048) // ~46px at 1080p
}

function SyBody(H) {
  return Math.round(H * 0.042) // ~40px at 1080p
}
