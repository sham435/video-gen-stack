import { pillarColor, pillarLabel, pillarEmoji } from '../publishing/TitleTemplates.mjs'

// ThumbnailOverlay — 3-layer text overlay for YouTube Shorts covers.
//
// Layer 1: TOP TAG [Company/Pillar] - 80px, colored bar, white text
// Layer 2: MIDDLE BIG [The Hook] - 160px Bold, White + 8px Black Stroke
// Layer 3: BOTTOM PAYOFF [The Why] - 90px, Yellow #FFD60A
//
// Canvas: 1080x1920 (portrait Shorts cover)
// Fonts: Anton or Bebas Neue Bold, All caps, Center align

const CANVAS_W = 1080
const CANVAS_H = 1920
const YELLOW_PAYOFF = '#FFD60A'

// ─── Hook extraction (2 words max) ────────────────────────────────────────

function extractHook(title = '') {
  // Try to pull the most impactful 2-word phrase from the title
  const words = title.replace(/[🚨📈⚡️🤖]/g, '').trim().split(/\s+/)

  // Look for numbers first (they stop scroll)
  const numWords = words.filter(w => /[\d.,]+[%$KMBkmb]?/.test(w))
  if (numWords.length >= 2) return numWords.slice(0, 2).join(' ')
  if (numWords.length === 1) {
    // Pair number with the word before or after
    const idx = words.indexOf(numWords[0])
    if (idx > 0) return `${words[idx - 1]} ${numWords[0]}`
    if (idx < words.length - 1) return `${numWords[0]} ${words[idx + 1]}`
    return numWords[0]
  }

  // No numbers — take the 2 most meaningful words (skip articles/prepositions)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'just', 'after', 'before', 'during', 'about', 'into', 'over', 'under', 'with', 'from', 'for', 'to', 'in', 'on', 'at', 'by', 'of', 'and', 'or', 'but', 'not', 'no', 'yes', 'its', 'it', 'this', 'that', 'these', 'those', 'than', 'then', 'when', 'where', 'how', 'what', 'which', 'who', 'whom'])
  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()) && w.length > 2)

  if (meaningful.length >= 2) return meaningful.slice(0, 2).join(' ').toUpperCase()
  if (meaningful.length === 1) return meaningful[0].toUpperCase()
  return words.slice(0, 2).join(' ').toUpperCase() || 'BREAKING'
}

// ─── Payoff extraction ────────────────────────────────────────────────────

function extractPayoff(title = '', pillar = 'tech') {
  const lower = title.toLowerCase()
  if (lower.includes('crash') || lower.includes('drop') || lower.includes('plunge')) return 'MARKET CRASH?'
  if (lower.includes('surge') || lower.includes('rally') || lower.includes('soar') || lower.includes('jump')) return 'RECORD HIGH'
  if (lower.includes('launch') || lower.includes('deploy') || lower.includes('send')) return 'WHY IT MATTERS'
  if (lower.includes('trade') || lower.includes('deal') || lower.includes('buy') || lower.includes('sell')) return 'EXPLAINED IN 30S'
  if (lower.includes('close') || lower.includes('market') || lower.includes('session')) return 'CLOSE IN 2H'

  // Default payoffs by pillar
  const DEFAULTS = {
    markets:  'EXPLAINED IN 30S',
    breaking: 'WHAT IT MEANS',
    tech:     'WHY IT MATTERS',
    sports:   '30S BRIEF',
    ai:       'EXPLAINED',
  }
  return DEFAULTS[pillar] || 'WHY IT MATTERS'
}

// ─── Main draw function ───────────────────────────────────────────────────

/**
 * Draw the 3-layer thumbnail overlay onto a canvas context.
 * @param {CanvasRenderingContext2D} ctx - canvas context
 * @param {object} opts
 * @param {string} opts.pillar - 'markets'|'breaking'|'tech'|'sports'|'ai'
 * @param {string} opts.title - the article title (used for hook + payoff extraction)
 * @param {string} [opts.hook] - override for middle hook text (2 words max)
 * @param {string} [opts.payoff] - override for bottom payoff text
 * @param {string} [opts.barLabel] - override for top bar label
 * @param {number} [opts.w] - canvas width (default 1080)
 * @param {number} [opts.h] - canvas height (default 1920)
 * @param {Image} [opts.footerImage] - loaded footer_asset_1920x300.png; when
 *   present the footer band is drawn across the bottom of the canvas
 */
export function drawThumbnailOverlay(ctx, opts = {}) {
  const {
    pillar = 'tech',
    title = '',
    hook: hookOverride,
    payoff: payoffOverride,
    barLabel: barLabelOverride,
    w = CANVAS_W,
    h = CANVAS_H,
    footerImage,
  } = opts

  const barColor = pillarColor(pillar)
  const barLabel = barLabelOverride || pillarLabel(pillar, { title })
  const hook = hookOverride || extractHook(title)
  const payoff = payoffOverride || extractPayoff(title, pillar)

  // ── Layer 1: TOP TAG BAR ──────────────────────────────────────────────
  const barH = 100
  const barY = 180
  ctx.fillStyle = barColor
  ctx.beginPath()
  ctx.roundRect(w / 2 - 280, barY, 560, barH, 12)
  ctx.fill()

  ctx.font = '900 80px Anton, Impact, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(barLabel, w / 2, barY + barH / 2)

  // ── Layer 2: MIDDLE BIG HOOK ─────────────────────────────────────────
  const hookY = h * 0.42
  ctx.font = '900 160px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Black stroke (8px)
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 16
  ctx.lineJoin = 'round'
  ctx.strokeText(hook, w / 2, hookY)

  // White fill
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(hook, w / 2, hookY)

  // ── Layer 3: BOTTOM PAYOFF ───────────────────────────────────────────
  const payoffY = h * 0.62
  ctx.font = '900 90px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = YELLOW_PAYOFF

  // Subtle glow behind payoff
  ctx.shadowColor = YELLOW_PAYOFF
  ctx.shadowBlur = 30
  ctx.fillText(payoff, w / 2, payoffY)
  ctx.shadowBlur = 0

  // ── Layer 4: FOOTER BAND (optional) ───────────────────────────────────
  if (footerImage) drawFooterBand(ctx, footerImage, w, h)
}

/**
 * Draw the footer band asset (footer_asset_1920x300.png) across the bottom
 * of a thumbnail canvas, scaled to the canvas width. No-op without an image.
 * The band carries the full brand chrome (NM badge, wordmark, tagline, URL,
 * AVAILABLE ON + platform icons) — same FooterLayout engine as the in-video
 * footer, so covers and videos always match.
 */
export function drawFooterBand(ctx, footerImage, w, h) {
  if (!footerImage) return
  const fh = Math.round((footerImage.height * w) / footerImage.width)
  ctx.drawImage(footerImage, 0, h - fh, w, fh)
}

/**
 * Generate a brief object compatible with CoverComposer.compose() from article + pillar.
 */
export function thumbnailBrief(article, pillar, opts = {}) {
  const hook = extractHook(article.title || '')
  const payoff = extractPayoff(article.title || '', pillar)
  const barLabel = pillarLabel(pillar, article)

  return {
    headline: hook,
    text_overlay: {
      top: barLabel,
      bottom: payoff,
    },
    accent_color: pillarColor(pillar),
    _pillar: pillar,
    _hook: hook,
    _payoff: payoff,
    _barLabel: barLabel,
    ...opts,
  }
}

export { extractHook, extractPayoff, CANVAS_W, CANVAS_H, YELLOW_PAYOFF }
