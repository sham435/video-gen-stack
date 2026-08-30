import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { ANCHOR_CONFIG, BrandStyleResolver } from '../visual/BrandStyleResolver.mjs'
import { drawThumbnailOverlay, drawFooterBand } from './ThumbnailOverlay.mjs'

const W = 1080, H = 1920

// Footer band asset — generated from the shared FooterLayout engine
// (scripts/footer.mjs --asset 1920x300). Lazy-loaded once and cached; a
// missing/broken asset is a silent no-op (covers fall back to the text strip).
const FOOTER_ASSET = new URL('../assets/footer_asset_1920x300.png', import.meta.url).pathname
let footerAssetPromise = null
function loadFooterAsset() {
  if (!footerAssetPromise) {
    footerAssetPromise = loadImage(FOOTER_ASSET).catch(() => { footerAssetPromise = null; return null })
  }
  return footerAssetPromise
}

const BAD_OVERLAYS = new Set([
  'ACTUALLY SEE', 'ACTUALLY', 'SEE HOW', 'SEE WHY', 'SEE WHAT',
  'THIS IS', 'HERE IS', 'LOOK AT', 'CHECK OUT',
])

function safeOverlay(text, fallback = 'BREAKING') {
  const up = (text || '').toUpperCase().trim()
  if (!up || BAD_OVERLAYS.has(up)) return fallback
  return up
}

export class CoverComposer {
  async compose(brief, heroImage, outPath) {
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')
    const profile = brief.nicheProfile || null
    const accent = profile?.accent || brief.accent_color || '#E10600'
    const pillLabel = profile?.label || brief.category || 'NEWS'
    const footerImg = brief.hideBranding ? null : await loadFooterAsset()

    // 1. Hero background
    if (heroImage) {
      try {
        const img = await loadImage(heroImage)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, W, H)
        const ratio = Math.max(W / img.width, H / img.height)
        const w = img.width * ratio, h = img.height * ratio
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
        // darken for readability
        const dim = ctx.createLinearGradient(0, 0, 0, H)
        dim.addColorStop(0, 'rgba(0,0,0,0.72)')
        dim.addColorStop(0.4, 'rgba(0,0,0,0.35)')
        dim.addColorStop(1, 'rgba(0,0,0,0.82)')
        ctx.fillStyle = dim
        ctx.fillRect(0, 0, W, H)
      } catch { this._gradientBg(ctx, accent) }
    } else {
      this._gradientBg(ctx, accent)
    }

    // 2. Brand layer (FIXED — always present unless hideBranding for Shorts)
    if (!brief.hideBranding) {
      // top bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, W, 120)
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, W, 8)
      ctx.font = '900 40px Anton, Impact, sans-serif'
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(ANCHOR_CONFIG.label, 40, 58)

      // LIVE badge
      const liveW = 110, liveH = 44
      ctx.font = '900 26px Inter, sans-serif'
      ctx.fillStyle = '#E10600'
      ctx.beginPath()
      ctx.roundRect(W - 40 - liveW, 16, liveW, liveH, 6)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.fillText('LIVE', W - 40 - liveW / 2, 38)
    }

    // algorithm badge — 1-48, unique combo, covers are never identical
    const algo = brief.algorithm || new BrandStyleResolver().resolve(brief.headline || '', 'technology').algorithm
    if (!brief.hideBranding && algo) {
      ctx.font = '600 20px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.textAlign = 'left'
      ctx.fillText(`ALGO #${algo.number}/48 • ${algo.visual?.id || ''} • ${algo.tone?.id || ''}`, 40, 96)
      ctx.textAlign = 'center'
    }

    // 3. Story-specific layer (DYNAMIC)
    ctx.textAlign = 'center'

    // PILLAR MODE: 3-layer ThumbnailOverlay when _pillar is set
    if (brief._pillar) {
      drawThumbnailOverlay(ctx, {
        pillar: brief._pillar,
        title: brief.headline || '',
        hook: brief._hook,
        payoff: brief._payoff,
        barLabel: brief._barLabel,
        w: W,
        h: H,
        footerImage: footerImg,
      })
    } else {
    // LEGACY MODE: top overlay badge + headline + bottom badge
    // top overlay badge — anchor hook when algorithm present
    const topText = algo?.hook && algo.hook !== 'SHOCKING_NUMBER'
      ? 'NOBODY EXPECTED THIS MOVE'
      : safeOverlay(brief.text_overlay?.top)
    ctx.font = '900 92px Anton, Impact, sans-serif'
    ctx.fillStyle = accent
    ctx.shadowColor = accent
    ctx.shadowBlur = 40
    ctx.fillText(topText, W / 2, H * 0.40)
    ctx.shadowBlur = 0

    // headline — smart wrap + auto-scale to fit 1080px width, max 4 lines
    const headline = (brief.headline || 'TECH NEWS').toUpperCase()
    const maxW = W * 0.9
    let hFontSize = headline.length > 60 ? 46 : headline.length > 40 ? 56 : headline.length > 25 ? 64 : 72
    const lines = []
    const wrap = () => {
      lines.length = 0
      ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
      const words = headline.split(' ')
      let line = ''
      for (const w of words) {
        if (ctx.measureText(line + w + ' ').width <= maxW) line += w + ' '
        else { if (line.trim()) lines.push(line.trim()); line = w + ' ' }
      }
      if (line.trim()) lines.push(line.trim())
    }
    wrap()
    // shrink if still overflowing (long titles)
    let guard = 0
    while (lines.length > 4 && hFontSize > 30 && guard < 20) {
      hFontSize -= 4
      wrap()
      guard++
    }
    ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 12
    const lineH = hFontSize * 1.15
    const blockH = lines.length * lineH
    const startY = H * 0.52 - blockH / 2
    lines.forEach((l, i) => ctx.fillText(l, W / 2, startY + i * lineH + hFontSize * 0.8))
    ctx.shadowBlur = 0

    // bottom overlay badge — niche pill from profile takes priority
    const nicheText916 = profile?.label || null
    const bottomText = nicheText916 || safeOverlay(brief.text_overlay?.bottom, 'NEW DETAILS')
    ctx.shadowBlur = 0
    ctx.font = '900 44px Anton, Impact, sans-serif'
    const bw = ctx.measureText(bottomText).width + 60
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.roundRect(W / 2 - bw / 2, H * 0.68, bw, 72, 8)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(bottomText, W / 2, H * 0.68 + 36)
    } // end legacy mode

    // 4. Bottom brand strip (FIXED) — the footer band replaces the text strip
    //    when the asset is present (band carries NM badge/wordmark/tagline/
    //    URL/AVAILABLE ON — the strip would duplicate the brand).
    if (footerImg) {
      drawFooterBand(ctx, footerImg, W, H)
    } else if (!brief.hideBranding) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, H - 100, W, 100)
      ctx.font = '400 36px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`Source: ${brief.source_label || 'NEWS-MONSTER'}`, 40, H - 50)
      ctx.textAlign = 'right'
      ctx.fillStyle = accent
      ctx.font = '700 36px Inter, sans-serif'
      ctx.fillText(`${(brief.mood || 'BREAKING').toUpperCase()} • ALGO ${algo?.number || 1}/48`, W - 40, H - 50)
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }

  _gradientBg(ctx, accent) {
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#0A0A0A')
    grad.addColorStop(0.5, '#101020')
    grad.addColorStop(1, '#050505')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, 700)
    glow.addColorStop(0, `${accent}25`)
    glow.addColorStop(1, `${accent}00`)
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
  }

  // ------------------------------------------------------------------
  // 16:9 YouTube thumbnail (1280x720) — the image actually shown in
  // feed/suggestions. Same brand system as the portrait Shorts cover but
  // laid out landscape. Deterministic for identical input.
  //
  // brief.nicheProfile — when provided, the profile's accent color and
  //   label override the brief's accent_color / category. This is the
  //   niche-aware path: profile → accent → pill, rather than hardcoded #E10600.
  // ------------------------------------------------------------------

  /**
   * YouTube thumbnail — 16:9 landscape (3840x2160) by default so it matches
   * the Standard (non-Shorts) video and populates the channel shelf. The
   * geometry is parameterized (opts.width/opts.height) and ALL layout is
   * ratio-based (fractions of W/H) so the same renderer works for 16:9
   * landscape or 9:16 portrait without hardcoded pixel constants.
   */
  async composeThumbnail(brief, heroImage, outPath, opts = {}) {
    const TW = opts.width || 3840
    const TH = opts.height || 2160
    const canvas = createCanvas(TW, TH)
    const ctx = canvas.getContext('2d')
    // Base font unit scales with the frame's shorter side (landscape 16:9).
    const U = Math.round(Math.min(TW, TH) / 18)
    const Pad = Math.round(TW * 0.028)
    // Niche profile overrides: profile.accent > brief.accent_color > default
    const profile = brief.nicheProfile || null
    const accent = profile?.accent || brief.accent_color || '#E10600'
    const footerImg = brief.hideBranding ? null : await loadFooterAsset()

    // 1. Hero background (cover full frame)
    if (heroImage) {
      try {
        const img = await loadImage(heroImage)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, TW, TH)
        const ratio = Math.max(TW / img.width, TH / img.height)
        const w = img.width * ratio, h = img.height * ratio
        ctx.drawImage(img, (TW - w) / 2, (TH - h) / 2, w, h)
        // dim for readability (heavier at the text zone)
        const dim = ctx.createLinearGradient(0, 0, 0, TH)
        dim.addColorStop(0, 'rgba(0,0,0,0.62)')
        dim.addColorStop(0.5, 'rgba(0,0,0,0.30)')
        dim.addColorStop(1, 'rgba(0,0,0,0.86)')
        ctx.fillStyle = dim
        ctx.fillRect(0, 0, TW, TH)
      } catch { this._thumbnailGradient(ctx, accent, TW, TH) }
    } else {
      this._thumbnailGradient(ctx, accent, TW, TH)
    }

    // 2. Brand bar (FIXED top) — height = 9% of frame height
    const barH = Math.round(TH * 0.09)
    if (!brief.hideBranding) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, TW, barH)
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, TW, Math.max(6, Math.round(TH * 0.012)))
      ctx.font = `900 ${Math.round(U * 1.0)}px Anton, Impact, sans-serif`
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(ANCHOR_CONFIG.label, Pad, Math.round(barH * 0.5))
      // LIVE badge
      const liveW = Math.round(TW * 0.075), liveH = Math.round(barH * 0.6)
      ctx.font = `900 ${Math.round(U * 0.6)}px Inter, sans-serif`
      ctx.fillStyle = '#E10600'
      ctx.beginPath()
      ctx.roundRect(TW - Pad - liveW, Math.round(barH * 0.2), liveW, liveH, Math.round(TH * 0.012))
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.fillText('LIVE', TW - Pad - liveW / 2, Math.round(barH * 0.5))
    }

    // algorithm badge (small, under the brand bar)
    const algo = brief.algorithm || new BrandStyleResolver().resolve(brief.headline || '', 'technology').algorithm
    if (!brief.hideBranding && algo) {
      ctx.font = `600 ${Math.round(U * 0.5)}px Inter, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.textAlign = 'left'
      ctx.fillText(`ALGO #${algo.number}/48 • ${algo.visual?.id || ''}`, Pad, Math.round(barH * 1.55))
      ctx.textAlign = 'center'
    }

    // 3. Top overlay badge (accent, glow)
    // PILLAR MODE: 3-layer ThumbnailOverlay when _pillar is set
    if (brief._pillar) {
      drawThumbnailOverlay(ctx, {
        pillar: brief._pillar,
        title: brief.headline || '',
        hook: brief._hook,
        payoff: brief._payoff,
        barLabel: brief._barLabel,
        w: TW,
        h: TH,
        footerImage: footerImg,
      })
    } else {
    // LEGACY MODE
    const topText = algo?.hook && algo.hook !== 'SHOCKING_NUMBER'
      ? 'NOBODY EXPECTED THIS MOVE'
      : safeOverlay(brief.text_overlay?.top)
    ctx.textAlign = 'center'
    ctx.font = `900 ${Math.round(U * 1.6)}px Anton, Impact, sans-serif`
    ctx.fillStyle = accent
    ctx.shadowColor = accent
    ctx.shadowBlur = Math.round(TW * 0.02)
    ctx.fillText(topText, TW / 2, TH * 0.20)
    ctx.shadowBlur = 0

    // 4. Headline — wrap to max TW*0.88 width, max 4 lines, auto-scale
    const headline = (brief.headline || 'TECH NEWS').toUpperCase()
    ctx.font = `900 ${Math.round(U * 1.9)}px Anton, Impact, sans-serif`
    const maxW = TW * 0.88
    let hFontSize = headline.length > 90 ? U * 1.2 : headline.length > 60 ? U * 1.4 : headline.length > 40 ? U * 1.7 : U * 2.0
    const lines = []
    const wrap = () => {
      lines.length = 0
      ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
      const words = headline.split(' ')
      let line = ''
      for (const w of words) {
        if (ctx.measureText(line + w + ' ').width <= maxW) line += w + ' '
        else { if (line.trim()) lines.push(line.trim()); line = w + ' ' }
      }
      if (line.trim()) lines.push(line.trim())
    }
    wrap()
    let guard = 0
    while (lines.length > 4 && hFontSize > U * 0.9 && guard < 24) {
      hFontSize -= U * 0.07
      wrap()
      guard++
    }
    ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = 'rgba(0,0,0,0.95)'
    ctx.shadowBlur = Math.round(TH * 0.02)
    const lineH = hFontSize * 1.1
    const blockH = lines.length * lineH
    const startY = TH * 0.36 - blockH / 2
    lines.forEach((l, i) => ctx.fillText(l, TW / 2, startY + i * lineH + hFontSize * 0.8))
    ctx.shadowBlur = 0

    // 5. Bottom accent badge — niche pill from profile takes priority
    const bottomText = profile?.label || safeOverlay(brief.text_overlay?.bottom, 'NEW DETAILS')
    ctx.font = `900 ${Math.round(U * 1.0)}px Anton, Impact, sans-serif`
    const bw = ctx.measureText(bottomText).width + Math.round(TW * 0.04)
    const badgH = Math.round(TH * 0.075)
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.roundRect(TW / 2 - bw / 2, TH * 0.72, bw, badgH, Math.round(badgH / 3))
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(bottomText, TW / 2, TH * 0.72 + badgH / 2)
    } // end legacy mode

    // 6. Bottom brand strip
    if (!brief.hideBranding) {
      const stripH = Math.round(TH * 0.08)
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, TH - stripH, TW, stripH)
      ctx.font = `600 ${Math.round(U * 0.7)}px Inter, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`Source: ${brief.source_label || 'NEWS-MONSTER'}`, Pad, TH - stripH / 2)
      ctx.textAlign = 'right'
      ctx.fillStyle = accent
      ctx.font = `700 ${Math.round(U * 0.7)}px Inter, sans-serif`
      ctx.fillText((brief.mood || 'BREAKING').toUpperCase(), TW - Pad, TH - stripH / 2)
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }

  _thumbnailGradient(ctx, accent, W, H) {
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#0A0A0A')
    grad.addColorStop(0.5, '#101020')
    grad.addColorStop(1, '#050505')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, Math.round(Math.min(W, H) * 0.6))
    glow.addColorStop(0, `${accent}30`)
    glow.addColorStop(1, `${accent}00`)
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
  }
}
