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
// protocol — "video-gen-stack-production.up.railway.app", never "https://…".
function stripProtocol(url) {
  const s = String(url || '')
  const fn = s.indexOf('://')
  const afterScheme = fn >= 0 ? s.slice(fn + 3) : s
  return afterScheme.replace(/\/+$/, '')
}

// Reduce a URL to its recognizable domain when the full string cannot fit in
// the footer column — "video-gen-stack-production.up.railway.app" reads far
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
    const size = Math.round(F.logoSize * scale)
    return { w: size, h: size }
  },

  draw(ctx, box, scale) {
    const size = box.h
    ctx.save()

    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 6
    ctx.fillStyle = F.accent
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, size, size, Math.round(9 * scale))
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.font = `900 ${Math.round(30 * scale)}px ${FONT_BRAND}`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('NM', box.x + size / 2, box.y + size / 2 + Math.round(3 * scale))
    ctx.restore()
  },
}

// Channel block — avatar circle + @handle, rendered beside the NM monogram in
// the left zone (top row). Uses the channel avatar image when loaded (JPEG or
// PNG), otherwise falls back to the NM monogram on the avatar base.
export const ChannelBlock = {
  measure(ctx, scale, data) {
    const avatarS = Math.round(F.logoSize * 0.8 * scale)
    const handle = data.showHandle !== false ? (data.handle || '') : ''
    const textW = handle ? measureText(ctx, F.handle, scale, handle) + Math.round(10 * scale) : 0
    return { w: avatarS + (handle ? Math.round(12 * scale) : 0) + textW, h: avatarS }
  },

  draw(ctx, box, scale, data, icons = {}) {
    const avatarS = box.h
    const avatar = icons?.avatar || null
    const handle = data.showHandle !== false ? (data.handle || '') : ''
    const gap = Math.round(12 * scale)
    const cx = box.x + avatarS / 2
    const cy = box.y + avatarS / 2
    ctx.save()

    if (avatar) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, avatarS / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(avatar, box.x, box.y, avatarS, avatarS)
      ctx.restore()
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, avatarS / 2, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      // Fallback: NM branded circle so the handle is never bare.
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 6
      ctx.fillStyle = F.accent
      ctx.beginPath()
      ctx.arc(cx, cy, avatarS / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.font = `900 ${Math.round(avatarS * 0.45)}px ${FONT_BRAND}`
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('NM', cx, cy + Math.round(avatarS * 0.08))
    }

    if (handle) {
      const handleH = Math.round(F.handle.size * scale)
      ctx.font = `${F.handle.weight} ${handleH}px ${FONT_BRAND}`
      ctx.fillStyle = F.text
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 4
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(handle, box.x + avatarS + gap, cy)
      ctx.shadowBlur = 0
    }
    ctx.restore()
    return { x: box.x, y: box.y, w: box.w, h: avatarS }
  },
}

export const BrandBlock = {
  measure(ctx, scale, data) {
    const brandH = Math.round(F.brand.size * scale)
    const tag = data.tagline || ''
    const brandW = measureText(ctx, F.brand, scale, data.brand)
    const tagW = tag ? measureText(ctx, F.tagline, scale, tag) : 0
    const w = Math.max(brandW, tagW)
    const h = brandH + (tag ? Math.round(F.tagline.size * scale) + Math.round(F.tagline.gap * scale) : 0)
    return { w, h }
  },

  draw(ctx, box, scale, data) {
    const brandH = Math.round(F.brand.size * scale)
    const tag = data.tagline
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4

    // Brand word
    const top = box.y + brandH
    ctx.font = `${F.brand.weight} ${brandH}px ${FONT_BRAND}`
    ctx.fillStyle = F.text
    ctx.textAlign = 'left'
    ctx.fillText(data.brand || 'NEWS-MONSTER', box.x, top)

    // Tagline — the primary brand message ("Unfiltered Breaking News").
    // Rendered at full tagline weight/size in a bright fill so it reads as a
    // distinct, visually-dominant line under the wordmark.
    if (tag) {
      const tagH = Math.round(F.tagline.size * scale)
      ctx.font = `${F.tagline.weight} ${tagH}px ${FONT_BRAND}`
      ctx.fillStyle = F.taglineBright || F.text
      const x = box.x + (box.w - ctx.measureText(tag).width) / 2
      ctx.fillText(tag, x, top + brandH * 1.25)
    }
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

  draw(ctx, box, scale, icons) {
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

// ── Right-aligned URL + tagline stack ──────────────────────────────────────
// The URL always renders at its full token size when it fits; when the column
// is too narrow it is ellipsized (measure -> fit -> ellipsis) rather than
// shrunk below legibility. The protocol is always stripped — the footer shows
// a clean hostname, never "https://". The channel handle lives next to the NM
// monogram (ChannelBlock), not here.
export const UrlBlock = {
  measure(ctx, scale, data, budget = Infinity) {
    const urlH = Math.round(F.url.size * scale)
    const tag = data.urlTagline
    const urlW = Math.min(measureText(ctx, F.url, scale, stripProtocol(data.url)), budget)
    const tagW = tag ? measureText(ctx, F.urlTagline, scale, tag) : 0
    const w = Math.max(urlW, Math.min(tagW, budget))
    const h = urlH + (tag ? Math.round(F.urlTagline.size * scale * F.urlLeading) : 0)
    return { w, h }
  },

  draw(ctx, box, scale, data) {
    const url = stripProtocol(data.url || '')
    const tag = data.urlTagline || ''
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

    let lineY = box.y + size
    if (tag) {
      const tagH = Math.round(F.urlTagline.size * scale)
      ctx.font = `${F.urlTagline.weight} ${tagH}px ${FONT_BRAND}`
      ctx.fillStyle = F.muted
      ctx.textAlign = 'right'
      lineY += tagH * F.urlLeading
      ctx.fillText(ellipsize(ctx, tag, maxW, F.urlTagline.weight, tagH), box.x + box.w, lineY)
    }
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