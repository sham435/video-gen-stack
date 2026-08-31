// LandscapeComposition — first-class 16:9 YouTube thumbnail composition engine.
//
// The supplied portrait thumbnail is a VISUAL STYLE REFERENCE, not a geometry
// template. This module reconstructs the composition natively for the wide
// 16:9 canvas (1920x1080 or 1280x720) instead of cropping/stretching/resizing
// the 9:16 artwork. It is ratio-based (fractions of W/H), deterministic, and
// leaves the portrait system untouched.
//
// Architecture:
//   LandscapeComposition
//     ├─ BroadcastHeader   (brand top-left, red rule, status badge top-right)
//     ├─ StoryVisual       (subject, native 16:9 focal crop, 35–55% width)
//     ├─ StoryKeyword      (level-3 attention hook, large, accent)
//     ├─ StoryHeadline     (level-4 main message, ≤3 lines, high contrast)
//     ├─ StatusBadge       (compact red LIVE/BREAKING/CATEGORY badge)
//     └─ CompactFooter     (3–5% height, brand metadata only)
//
// Strategies (genuinely different layouts, chosen per story):
//   A — subject right, text left/center
//   B — subject left,  text right/center
//   C — center subject, keyword + headline ABOVE
//   D — center subject, keyword + headline BELOW
//   E — full-bleed visual, minimal typography overlay
//
// Text never fights the image: text is placed in the negative space on the
// opposite side of the subject (or above/below a centered subject), so subject
// occlusion and text/subject overlap are structurally zero.

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'

// ── Brand + identity constants (NEWS-MONSTER) ────────────────────────────
export const BRAND = 'NEWS-MONSTER'
export const DEFAULT_ACCENT = '#E10600'
const WHITE = '#FFFFFF'

// Layout constraints from the brief.
export const SAFE_MARGIN = 0.05        // ≥5% safe margin
export const TOP_BRAND_ZONE_MIN = 0.08 // brand zone 8%
export const PRIMARY_STORY_TOP = 0.20  // primary story zone starts 20%
export const PRIMARY_STORY_BOTTOM = 0.80
export const FOOTER_HEIGHT = 0.05      // footer 5% of canvas height (compact)
export const MAX_HEADLINE_LINES = 3
export const MIN_SUBJECT_W = 0.35      // subject 35–55% of canvas width
export const MAX_SUBJECT_W = 0.55

// The 5 composition strategies.
export const STRATEGIES = ['A', 'B', 'C', 'D', 'E']

function registerDistinctFonts() {
  // Best-effort font registration (matches SceneEngine). Falls back to
  // Impact/sans-serif when the asset is absent, so rendering stays
  // deterministic on any checkout.
  const pairs = [
    ['assets/fonts/Anton-Regular.ttf', 'Anton'],
    ['assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold'],
  ]
  for (const [file, family] of pairs) {
    if (fs.existsSync(file)) {
      try { GlobalFonts.registerFromPath(file, family) } catch { /* ignore */ }
    }
  }
}
registerDistinctFonts()

/**
 * Cover-crop an image into a destination rect preserving aspect while filling
 * the rect (no stretching). Returns { dx, dy, dw, dh } draw rect.
 */
function coverRect(imgW, imgH, dW, dH) {
  const ratio = Math.max(dW / imgW, dH / imgH)
  const w = imgW * ratio
  const h = imgH * ratio
  return { dx: (dW - w) / 2, dy: (dH - h) / 2, dw: w, dh: h }
}

/**
 * Wrap text to a max width, returning an array of lines.
 */
function wrapText(ctx, text, font, maxW) {
  ctx.font = font
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const probe = line ? line + ' ' + w : w
    if (ctx.measureText(probe).width <= maxW) {
      line = probe
    } else {
      if (line) lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  return lines
}

// ── Component 1: BroadcastHeader ─────────────────────────────────────────
/**
 * Brand top-left + compact red status badge top-right + thin accent rule.
 * height ≈ 9% of canvas height, inside the top brand zone (8–15%).
 */
export function drawBroadcastHeader(ctx, { W, H, brand = BRAND, status = 'LIVE', accent = DEFAULT_ACCENT, hideBranding = false }) {
  const U = Math.round(Math.min(W, H) / 18)
  const pad = Math.round(W * 0.028)
  const headerH = Math.round(H * 0.09)

  if (hideBranding) return headerH

  // Brand text (top-left).
  ctx.font = `900 ${Math.round(U * 1.0)}px Anton, Impact, sans-serif`
  ctx.fillStyle = WHITE
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(brand, pad, Math.round(headerH * 0.52))

  // Semi-transparent backing for legibility over the visual.
  const brandW = ctx.measureText(brand).width
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(pad - Math.round(U * 0.3), headerH * 0.18, brandW + U * 0.6, headerH * 0.64)
  // Re-draw brand on top of the backing.
  ctx.font = `900 ${Math.round(U * 1.0)}px Anton, Impact, sans-serif`
  ctx.fillStyle = WHITE
  ctx.fillText(brand, pad, Math.round(headerH * 0.52))

  // Status badge (top-right) — compact red badge.
  const badgeW = Math.round(W * 0.12)
  const badgeH = Math.round(headerH * 0.62)
  const badgeX = W - pad - badgeW
  const badgeY = Math.round(headerH * 0.19)
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, Math.round(H * 0.012))
  ctx.fill()
  ctx.font = `900 ${Math.round(U * 0.58)}px Inter, sans-serif`
  ctx.fillStyle = WHITE
  ctx.textAlign = 'center'
  ctx.fillText(status.toUpperCase(), badgeX + badgeW / 2, badgeY + badgeH / 2)

  // Accent rule under header.
  ctx.fillStyle = accent
  ctx.fillRect(0, headerH - Math.max(3, Math.round(H * 0.006)), W, Math.max(3, Math.round(H * 0.006)))

  ctx.textAlign = 'center'
  return headerH
}

/**
 * Draw the subject (story visual) into a bounded region using cover-crop.
 * Returns the final draw rect {x, y, w, h} for negative-space computation.
 */
export async function drawStoryVisual(ctx, { W, H, heroImage, accent, layout, headerH, footerH }) {
  let gradientMode = false
  if (heroImage && fs.existsSync(heroImage)) {
    try {
      const img = await loadImage(heroImage)
      const rect = subjectRect({ W, H, layout, headerH, footerH })
      const { dx, dy, dw, dh } = coverRect(img.width, img.height, rect.w, rect.h)
      ctx.drawImage(img, rect.x + dx, rect.y + dy, dw, dh)
      return rect
    } catch {
      gradientMode = true
    }
  } else {
    gradientMode = true
  }

  if (gradientMode) {
    drawGradientSubject(ctx, { W, H, layout, headerH, footerH, accent })
    return subjectRect({ W, H, layout, headerH, footerH })
  }
}

/**
 * Compute the subject region rect for a layout:
 *   A — right 55% (anchored right), full story height
 *   B — left 55%  (anchored left), full story height
 *   C — center 40%, LOWER half of the story zone (headline above)
 *   D — center 40%, UPPER half of the story zone (headline below)
 *   E — full frame (subject is the background)
 */
export function subjectRect({ W, H, layout, headerH = 0, footerH = 0 }) {
  const top = headerH
  const bottom = H - footerH
  const h = bottom - top
  switch (layout) {
    case 'A':
      return { x: Math.round(W * (1 - 0.55)), y: top, w: Math.round(W * 0.55), h }
    case 'B':
      return { x: 0, y: top, w: Math.round(W * 0.55), h }
    case 'C':
      // subject in lower band (55–80% of H), centered
      return { x: Math.round(W * 0.30), y: Math.round(H * 0.52), w: Math.round(W * 0.40), h: Math.round(H * 0.80) - Math.round(H * 0.52) }
    case 'D':
      // subject in upper band (20–55% of H), centered
      return { x: Math.round(W * 0.30), y: Math.round(H * 0.20), w: Math.round(W * 0.40), h: Math.round(H * 0.55) - Math.round(H * 0.20) }
    case 'E':
    default:
      return { x: 0, y: top, w: W, h }
  }
}

function drawGradientSubject(ctx, { W, H, layout, headerH, footerH, accent }) {
  const grad = ctx.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, '#0A0A0E')
  grad.addColorStop(0.5, '#101824')
  grad.addColorStop(1, accent + '55')
  ctx.fillStyle = grad
  ctx.fillRect(0, headerH, W, H - headerH - footerH)
}

// ── Component 3 + 4: StoryKeyword + StoryHeadline ────────────────────────
/**
 * Place the keyword (level 3) and headline (level 4) in the negative space on
 * the opposite side of the subject, never overlapping it.
 *
 * Returns placement metadata { keywordBox, headlineLines, headlineBox } used
 * by the readability gate.
 */
export function drawStoryText(ctx, { W, H, keyword, headline, layout, accent, headerH, footerH, subjectRect: srect }) {
  const U = Math.round(Math.min(W, H) / 18)
  const safeMargin = Math.round(W * SAFE_MARGIN)
  const topSafe = headerH + Math.round(H * 0.02)
  const bottomSafe = H - footerH - Math.round(H * 0.02)

  // Determine the text column (negative space). Text always lands in the
  // complementary vertical/horizontal zone so it structurally never overlaps
  // the subject.
  // A: subject right → text left/center
  // B: subject left  → text right/center
  // C: subject center-lower → text UPPER band
  // D: subject center-upper → text LOWER band
  // E: full-bleed → overlay in central-lower band with a scrim
  let tx0, ty0, tW, tH
  if (layout === 'A') {
    tx0 = safeMargin
    tW = Math.round(W * 0.40)
    ty0 = topSafe
    tH = bottomSafe - topSafe
  } else if (layout === 'B') {
    tx0 = Math.round(W * (1 - 0.40)) - safeMargin
    tW = Math.round(W * 0.40)
    ty0 = topSafe
    tH = bottomSafe - topSafe
  } else if (layout === 'C') {
    tx0 = safeMargin
    tW = W - safeMargin * 2
    ty0 = topSafe
    tH = Math.round(H * 0.50) - topSafe
  } else if (layout === 'D') {
    tx0 = safeMargin
    tW = W - safeMargin * 2
    ty0 = Math.round(H * 0.58)
    tH = bottomSafe - ty0
  } else { // E — text over full-bleed visual, central-lower band with scrim
    tx0 = safeMargin
    tW = W - safeMargin * 2
    ty0 = Math.round(H * 0.44)
    tH = bottomSafe - ty0
    // Scrim under the text so it stays legible over the full-bleed subject.
    const scrimH = Math.round(H * 0.22)
    const scrimGrad = ctx.createLinearGradient(0, ty0, 0, ty0 + scrimH)
    scrimGrad.addColorStop(0, 'rgba(0,0,0,0.0)')
    scrimGrad.addColorStop(1, 'rgba(0,0,0,0.82)')
    ctx.fillStyle = scrimGrad
    ctx.fillRect(0, ty0 - Math.round(H * 0.08), W, scrimH + Math.round(H * 0.08))
  }

  const head = (headline || keyword || 'NEWS UPDATE').toUpperCase()
  const kw = (keyword || '').toUpperCase()

  // ── Keyword (level 3) ──
  let keywordBox = null
  if (kw) {
    let kwFont = Math.round(U * 2.2)
    ctx.font = `900 ${kwFont}px Anton, Impact, sans-serif`
    while (ctx.measureText(kw).width > tW && kwFont > U * 0.8) { kwFont -= U * 0.1; ctx.font = `900 ${kwFont}px Anton, Impact, sans-serif` }
    const kwH = Math.round(kwFont * 1.15)
    const kwY = ty0 + Math.round(kwH * 0.7)
    // accent underline
    ctx.fillStyle = accent
    const kwW = ctx.measureText(kw).width
    ctx.fillRect(tx0, kwY + Math.round(kwH * 0.2), kwW, Math.max(4, Math.round(H * 0.012)))
    // keyword text
    ctx.shadowColor = 'rgba(0,0,0,0.95)'
    ctx.shadowBlur = Math.round(H * 0.02)
    ctx.fillStyle = WHITE
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(kw, tx0, kwY)
    ctx.shadowBlur = 0
    keywordBox = { x: tx0, y: kwY - kwH / 2, w: kwW, h: kwH }
    ty0 = kwY + Math.round(kwH * 0.55)
  }

  // ── Headline (level 4) — wrap, max 3 lines, auto-scale to fit region ──
  let hFontSize = Math.round(U * 1.5)
  const maxLines = MAX_HEADLINE_LINES
  let lines = []
  const maxW = tW
  const fitLines = (size) => {
    ctx.font = `900 ${size}px Anton, Impact, sans-serif`
    return wrapText(ctx, head, `900 ${size}px Anton, Impact, sans-serif`, maxW)
  }
  lines = fitLines(hFontSize)
  const regionRemaining = bottomSafe - ty0
  let lineH = Math.round(hFontSize * 1.1)
  let guard = 0
  while ((lines.length > maxLines || lines.length * lineH > regionRemaining) && hFontSize > U * 0.7 && guard < 25) {
    hFontSize -= U * 0.06
    lines = fitLines(hFontSize)
    lineH = Math.round(hFontSize * 1.1)
    guard++
  }
  // Ensure color contrast + stroke for thumbnail-scale readability.
  ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.lineWidth = Math.max(2, Math.round(hFontSize * 0.12))
  ctx.lineJoin = 'round'
  const blockH = lines.length * lineH
  const startY = ty0 + Math.round(hFontSize * 0.8)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = WHITE
  lines.forEach((l, i) => {
    ctx.strokeText(l, tx0, startY + i * lineH)
    ctx.fillText(l, tx0, startY + i * lineH)
  })
  const headlineBox = { x: tx0, y: startY - lineH / 2, w: maxW, h: blockH }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  return { keywordBox, headlineLines: lines, headlineBox, textRegion: { x: tx0, y: ty0, w: tW, h: regionRemaining } }
}

// ── Component 6: CompactFooter ───────────────────────────────────────────
/**
 * A compact 3–5% footer, bottom-anchored, full-width. Brand metadata only.
 * It intentionally does NOT carry the portrait's large footer or the
 * URL/AVAILABLE ON/Subscribe/store icons.
 */
export function drawCompactFooter(ctx, { W, H, brand = BRAND, status = 'BREAKING', accent = DEFAULT_ACCENT }) {
  const U = Math.round(Math.min(W, H) / 18)
  const footerH = Math.round(H * FOOTER_HEIGHT)
  const y0 = H - footerH
  const pad = Math.round(W * 0.028)

  ctx.fillStyle = 'rgba(0,0,0,0.82)'
  ctx.fillRect(0, y0, W, footerH)
  ctx.fillStyle = accent
  ctx.fillRect(0, y0, W, Math.max(2, Math.round(H * 0.004)))

  ctx.font = `700 ${Math.round(U * 0.55)}px Inter, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(brand, pad, y0 + footerH / 2)

  ctx.textAlign = 'right'
  ctx.fillStyle = accent
  ctx.fillText(status.toUpperCase(), W - pad, y0 + footerH / 2)
  ctx.textAlign = 'center'
  return footerH
}

// ── Orchestrator ─────────────────────────────────────────────────────────
export const LAYOUT_META = {
  A: { subject: 'right', text: 'left' },
  B: { subject: 'left', text: 'right' },
  C: { subject: 'center-lower', text: 'above' },
  D: { subject: 'center-upper', text: 'below' },
  E: { subject: 'full-bleed', text: 'overlay' },
}

/**
 * Compose a 16:9 landscape thumbnail natively and write to outPath.
 *
 * @param {object} brief { keyword, headline, status, brand, accent, layout, hideBranding, lineage }
 * @param {string|null} heroImage — subject image path/URL (may be null)
 * @param {string} outPath
 * @param {object} opts { width, height } default 1920x1080
 * @returns {Promise<{path,width,height,layout,composition}>}
 */
export async function composeLandscape(brief, heroImage, outPath, opts = {}) {
  const W = opts.width || 1920
  const H = opts.height || 1080
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const layout = STRATEGIES.includes(brief.layout) ? brief.layout : 'A'
  const accent = brief.nicheProfile?.accent || brief.accent || DEFAULT_ACCENT

  // Base cinematic dark background.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0A0A0A')
  bg.addColorStop(0.5, '#0E1220')
  bg.addColorStop(1, '#05070C')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.round(Math.min(W, H) * 0.7))
  glow.addColorStop(0, `${accent}22`)
  glow.addColorStop(1, `${accent}00`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const status = brief.status || defaultStatus(brief)
  const headerH = drawBroadcastHeader(ctx, { W, H, brand: brief.brand || BRAND, status, accent, hideBranding: brief.hideBranding || false })
  const footerH = drawCompactFooter(ctx, { W, H, brand: brief.brand || BRAND, status, accent })

  const srect = await drawStoryVisual(ctx, { W, H, heroImage, accent, layout, headerH, footerH })
  const textPlacement = drawStoryText(ctx, {
    W, H,
    keyword: brief.keyword,
    headline: brief.headline,
    layout, accent, headerH, footerH,
    subjectRect: srect,
  })

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))

  return {
    path: outPath,
    width: W,
    height: H,
    layout,
    aspectRatio: '16:9',
    composition: {
      layout,
      subjectRect: srect ? { x: srect.x, y: srect.y, w: srect.w, h: srect.h } : null,
      keywordBox: textPlacement.keywordBox,
      headlineLines: textPlacement.headlineLines,
      headlineBox: textPlacement.headlineBox,
    },
  }
}

function defaultStatus(brief) {
  const c = (brief.category || 'technology').toUpperCase()
  if (/BREAK|URGENT|CRASH|EMERG/.test((brief.headline || '') + ' ' + (brief.keyword || ''))) return 'BREAKING'
  if (['AI', 'GAMING'].includes(c)) return c
  if (['TECH', 'TECHNOLOGY', 'SCIENCE'].includes(c)) return 'TECH'
  return c === 'GENERAL' ? 'GENERAL' : 'NEWS'
}
