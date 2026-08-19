import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'

const F = BROADCAST_TEXT.footer

// Font tokens consumed by the canvas pipeline (SceneEngine registers
// 'Montserrat ExtraBold'; Inter falls through to system sans if absent).
export const FONT_BRAND = `'Montserrat ExtraBold', Inter, sans-serif`

// ├─ Reusable blocks ─────────────────────────────────────────────────────
// Each block is a pure measure + draw pair. Blocks receive the scale computed
// by the layout pass (proportional to the 1080px design width) and a box
// { x, y, w, h } given in canvas coordinates. No hard-coded positions.

// Strip "scheme://" (and a trailing slash) so the footer never shows a
// protocol — "sham435.github.io/video-gen-stack", never "https://…".
function stripProtocol(url) {
  const s = String(url || '')
  const fn = s.indexOf('://')
  const afterScheme = fn >= 0 ? s.slice(fn + 3) : s
  return afterScheme.replace(/\/+$/, '')
}

// Reduce a URL to its recognizable domain when the full string cannot fit in
// the footer column — "sham435.github.io" reads far
// better than a protocol-prefixed ellipsis.
function domainOf(url) {
  const s = String(url || '')
  const fn = s.indexOf('://')
  const afterScheme = fn >= 0 ? s.slice(fn + 3) : s
  const slash = afterScheme.indexOf('/')
  return slash >= 0 ? afterScheme.slice(0, slash) : afterScheme
}

export const LogoBlock = {
  measure(ctx, scale) {
    const w = Math.round(F.logo.w * scale)
    const h = Math.round(F.logo.h * scale)
    return { w, h }
  },

  draw(ctx, box, scale, data) {
    if (data?.hideBranding) return
    const w = box.w
    const h = box.h
    ctx.save()

    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 6
    ctx.fillStyle = F.accent
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, w, h, Math.round(F.logo.radius * scale))
    ctx.fill()
    ctx.shadowBlur = 0

    // ~8px padding around the letters — roomier than the old tight 48px box.
    ctx.font = `900 ${Math.round(F.logo.font * scale)}px ${FONT_BRAND}`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('NM', box.x + w / 2, box.y + h / 2 + Math.round(2 * scale))
    ctx.restore()
  },
}

// Brand word — "NEWS-MONSTER", drawn on the TOP row beside the NM monogram.
// The tagline is its own row below (TaglineBlock), so the wordmark can sit
// on the same horizontal line as the subscribe pill.
export const BrandBlock = {
  measure(ctx, scale, data) {
    const brandH = Math.round(F.brand.size * scale)
    const w = measureText(ctx, F.brand, scale, data.brand || 'NEWS-MONSTER')
    return { w, h: brandH }
  },

  draw(ctx, box, scale, data) {
    if (data?.hideBranding) return
    const brandH = box.h
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.font = `${F.brand.weight} ${brandH}px ${FONT_BRAND}`
    ctx.fillStyle = F.text
    ctx.textAlign = 'left'
    ctx.fillText(data.brand || 'NEWS-MONSTER', box.x, box.y + brandH)
    ctx.restore()
  },
}

// Tagline — "Unfiltered Breaking News", its own row directly below the
// NEWS-MONSTER wordmark (left-aligned with it, bright fill).
export const TaglineBlock = {
  measure(ctx, scale, data) {
    const tag = data.tagline || ''
    if (!tag) return { w: 0, h: 0 }
    const tagH = Math.round(F.tagline.size * scale)
    return { w: measureText(ctx, F.tagline, scale, tag), h: tagH }
  },

  draw(ctx, box, scale, data) {
    const tag = data.tagline
    if (!tag || data?.hideBranding) return
    const tagH = Math.round(F.tagline.size * scale)
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.font = `${F.tagline.weight} ${tagH}px ${FONT_BRAND}`
    ctx.fillStyle = F.taglineBright || F.text
    ctx.textAlign = 'left'
    ctx.fillText(tag, box.x, box.y + tagH)
    ctx.restore()
  },
}

// AVAILABLE ON label + Android / Apple badge row. Icons render from the shared
// PNG icon cache when present, otherwise monochrome vector primitives — never
// emoji glyphs (products don't ship emoji as UI icons).
export const PlatformBlock = {
  measure(ctx, scale) {
    const labelH = Math.round(F.available.size * scale)
    const labelW = measureText(ctx, F.available, scale, 'AVAILABLE ON')
    const iconW = Math.round(F.platformIcon * scale)
    const iconsW = iconW * 2 + Math.round(F.platformGap * scale)
    const w = Math.max(labelW, iconsW)
    const h = labelH + Math.round(F.available.size * 0.25 * scale) + iconW
    return { w, h }
  },

  draw(ctx, box, scale, data, icons) {
    const labelH = Math.round(F.available.size * scale)
    const iconW = Math.round(F.platformIcon * scale)
    const gap = Math.round(F.platformGap * scale)
    const labelY = box.y + labelH
    const iconsY = labelY + Math.round(F.available.size * 0.55 * scale)

    ctx.save()
    ctx.font = `${F.available.weight} ${labelH}px ${FONT_BRAND}`
    ctx.fillStyle = F.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.fillText('AVAILABLE ON', box.x + box.w / 2, labelY)
    ctx.shadowBlur = 0

    // Icons sit BELOW the label, horizontally centered relative to the block.
    const rowW = iconW * 2 + gap
    const startX = box.x + (box.w - rowW) / 2

    const drawIcon = (kind, idx) => {
      const x = startX + idx * (iconW + gap)
      if (icons && icons[kind]) ctx.drawImage(icons[kind], x, iconsY, iconW, iconW)
      else drawVectorIcon(ctx, kind, x, iconsY, iconW, scale)
    }
    drawIcon('apple', 0)
    drawIcon('android', 1)
    ctx.restore()
  },
}

// YouTube Subscribe pill — the footer's strongest CTA. 50px tall, fully rounded,
// 26px play triangle, 24px bold label.
export const SubscribeBlock = {
  measure(ctx, scale) {
    const pillH = Math.round(F.pill.height * scale)
    const label = 'Subscribe'
    ctx.font = `${F.pill.weight} ${Math.round(F.pill.labelSize * scale)}px ${FONT_BRAND}`
    const txtW = ctx.measureText(label).width
    const iconPad = Math.round(F.pill.icon * scale) + Math.round(pillH * 0.2)
    const padX = Math.round(pillH * 0.35)
    const w = txtW + padX * 2 + iconPad // play icon reserved beside text
    return { w, h: pillH }
  },

  draw(ctx, box, scale) {
    const pillH = box.h
    const radius = Math.round(F.pill.radius * scale)
    const iconS = Math.round(F.pill.icon * scale)
    const tri = Math.round(iconS * 0.42)

    ctx.save()
    // Red subscribe pill
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#FF0000'
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.w, pillH, Math.min(radius, pillH / 2))
    ctx.fill()
    ctx.shadowBlur = 0

    // YouTube play icon (left inside the pill)
    const iconCX = box.x + Math.round(pillH * 0.4) + iconS / 2
    const cy = box.y + pillH / 2
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.moveTo(iconCX - Math.round(tri * 0.36), cy - tri)
    ctx.lineTo(iconCX - Math.round(tri * 0.36), cy + tri)
    ctx.lineTo(iconCX + Math.round(tri * 0.8), cy)
    ctx.closePath()
    ctx.fill()

    // Subscribe label, baseline aligned to the play triangle.
    ctx.font = `${F.pill.weight} ${Math.round(F.pill.labelSize * scale)}px ${FONT_BRAND}`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('Subscribe', box.x + Math.round(pillH * 0.55) + iconS, cy + Math.round(iconS * 0.48))
    ctx.restore()
  },
}

export const label = () => 'AVAILABLE ON'

// ── Right-aligned URL stack ────────────────────────────────────────────────
// The URL always renders at its full token size when it fits; when the column
// is too narrow it is ellipsized (measure -> fit -> ellipsis) rather than
// shrunk below legibility. The protocol is always stripped — the footer shows
// a clean hostname, never "https://". The URL sits on its own lower line
// below the subscribe pill in the right zone. The old secondary urlTagline
// line ("Unfiltered Global Headlines") was removed — single URL line only.
export const UrlBlock = {
  measure(ctx, scale, data, budget = Infinity) {
    const urlH = Math.round(F.url.size * scale)
    const urlW = Math.min(measureText(ctx, F.url, scale, stripProtocol(data.url)), budget)
    return { w: urlW, h: urlH }
  },

  draw(ctx, box, scale, data) {
    const url = stripProtocol(data.url || '')
    const maxW = Math.max(60, box.w)

    ctx.save()
    const size = Math.round(F.url.size * scale)
    ctx.font = `${F.url.weight} ${size}px ${FONT_BRAND}`
    // Prefer the full URL; when the column cannot hold it, fall back to the
    // recognizable domain (everything after the scheme, before the first path
    // slash) instead of an anonymous "https://…" ellipsis.
    let display = ctx.measureText(url).width <= maxW ? url : null
    if (!display) {
      const dom = domainOf(url)
      if (dom && ctx.measureText(dom).width <= maxW) {
        display = dom
      } else {
        display = ellipsize(ctx, url, maxW, F.url.weight, size)
      }
    }

    ctx.textBaseline = 'alphabetic'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.fillStyle = F.text
    ctx.textAlign = 'right'
    ctx.fillText(display, box.x + box.w, box.y + size)
    ctx.shadowBlur = 0
    ctx.restore()
  },
}

// ── Vector platform icons (emoji-free fallback) ─────────────────────────────
function drawVectorIcon(ctx, kind, x, y, size, scale) {
  const s = size
  const cx = x + s / 2
  const cy = y + s / 2
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1.5, s * 0.08)

  if (kind === 'apple') {
    // Monochrome apple silhouette: two rounded lobes + small bite.
    const r = s * 0.34
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 1.1)
    ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.9, cx - r * 1.15, cy, cx, cy)
    ctx.bezierCurveTo(cx + r * 1.15, cy, cx + r * 1.3, cy - r * 0.9, cx, cy - r * 1.1)
    ctx.closePath()
    ctx.fill()
    // dimple + stem notch
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 1.0)
    ctx.quadraticCurveTo(cx + r * 0.08, cy, cx, cy + r * 0.55)
    ctx.lineWidth = Math.max(1.5, s * 0.06)
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.stroke()
  } else {
    // Android head: rounded body + two antenna stubs + two eyes.
    const rx = s * 0.42
    const ry = s * 0.34
    const top = cy - s * 0.2
    ctx.beginPath()
    ctx.roundRect(cx - rx, top, rx * 2, ry * 2, size * 0.12)
    ctx.fill()
    // antennae
    ctx.fillRect(cx - rx * 0.7, top - s * 0.06, Math.max(1.5, s * 0.05), s * 0.08)
    ctx.fillRect(cx + rx * 0.65, top - s * 0.06, Math.max(1.5, s * 0.05), s * 0.08)
    // eyes
    ctx.fillStyle = 'rgba(0,0,0,0.9)'
    const er = Math.max(1.5, s * 0.05)
    ctx.fillRect(cx - rx * 0.45 - er / 2, top + ry * 0.55, er, er)
    ctx.fillRect(cx + rx * 0.45 - er / 2, top + ry * 0.55, er, er)
  }
  ctx.restore()
}

// Binary-search the longest prefix that fits, appending an ellipsis. Never
// returns an overflowing string.
export function ellipsize(ctx, text, maxW, weight, size) {
  const font = `${weight} ${size}px ${FONT_BRAND}`
  ctx.font = font
  if (ctx.measureText(text).width <= maxW) return text
  if (ctx.measureText('…').width > maxW) return ''
  let lo = 1
  let hi = text.length
  let best = '…'
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const candidate = text.slice(0, mid) + '…'
    if (ctx.measureText(candidate).width <= maxW) { best = candidate; lo = mid + 1 } else hi = mid - 1
  }
  return best
}

// ── Helpers ───────────────────────────────────────────────────────────────
function measureText(ctx, token, scale, text) {
  ctx.font = `${token.weight} ${Math.round(token.size * scale)}px ${FONT_BRAND}`
  return ctx.measureText(text).width
}