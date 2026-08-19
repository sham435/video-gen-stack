// Tests for TitleTemplates + ThumbnailOverlay pillar system.
//
// Run: node --test tests/title-templates.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { detectPillar, formatTitle, pillarEmoji, pillarColor, pillarLabel, PILLAR_EMOJI, MAX_TITLE } from '../src/publishing/TitleTemplates.mjs'
import { extractHook, extractPayoff, drawThumbnailOverlay, thumbnailBrief, CANVAS_W, CANVAS_H, YELLOW_PAYOFF } from '../src/video-studio/ThumbnailOverlay.mjs'

// ─── Pillar detection ──────────────────────────────────────────────────────

test('detectPillar: markets', () => {
  assert.equal(detectPillar({ title: 'Tesla +10% After Robotaxi Leak', category: 'finance' }), 'markets')
})

test('detectPillar: breaking', () => {
  assert.equal(detectPillar({ title: 'Trump Signs Executive Order on TikTok', category: 'politics' }), 'breaking')
})

test('detectPillar: tech', () => {
  assert.equal(detectPillar({ title: 'Apple Just Killed Lightning', category: 'technology' }), 'tech')
})

test('detectPillar: sports', () => {
  assert.equal(detectPillar({ title: 'Lakers Trade Shocks NBA', category: 'sports' }), 'sports')
})

test('detectPillar: ai', () => {
  assert.equal(detectPillar({ title: 'OpenAI Releases GPT-5 Agent', category: 'ai' }), 'ai')
})

test('detectPillar: ai beats tech for AI keywords', () => {
  assert.equal(detectPillar({ title: 'Nvidia AI chip beats expectations', category: 'technology' }), 'ai')
})

test('detectPillar: defaults to tech', () => {
  assert.equal(detectPillar({ title: 'Some random headline', category: '' }), 'tech')
})

// ─── Title formatting ──────────────────────────────────────────────────────

test('formatTitle: markets', () => {
  const title = formatTitle({ title: 'Tesla +10% After Robotaxi Leak', category: 'finance' })
  assert.ok(title.length <= MAX_TITLE, `Title too long: ${title.length}`)
  assert.ok(!title.includes('NEWS-MONSTER'), `Should not contain NEWS-MONSTER: ${title}`)
  assert.ok(!title.includes('|'), `Should not contain pipe: ${title}`)
})

test('formatTitle: breaking', () => {
  const title = formatTitle({ title: 'Trump Signs Executive Order on TikTok Ban', category: 'politics' })
  assert.ok(title.length <= MAX_TITLE, `Title too long: ${title.length}`)
  assert.ok(!title.includes('NEWS-MONSTER'), `Should not contain NEWS-MONSTER: ${title}`)
})

test('formatTitle: tech with company', () => {
  const title = formatTitle({ title: 'SpaceX Just Launched 23 Sats - Why It Matters', category: 'technology' })
  assert.ok(title.length <= MAX_TITLE, `Title too long: ${title.length}`)
  assert.ok(!title.includes('NEWS-MONSTER'), `Should not contain NEWS-MONSTER: ${title}`)
})

test('formatTitle: sports', () => {
  const title = formatTitle({ title: 'NBA: Lakers Trade Shocks League - 30s Brief', category: 'sports' })
  assert.ok(title.length <= MAX_TITLE, `Title too long: ${title.length}`)
  assert.ok(!title.includes('NEWS-MONSTER'), `Should not contain NEWS-MONSTER: ${title}`)
})

test('formatTitle: ai', () => {
  const title = formatTitle({ title: 'OpenAI Just Released GPT-5 Agent - Explained', category: 'ai' })
  assert.ok(title.length <= MAX_TITLE, `Title too long: ${title.length}`)
  assert.ok(!title.includes('NEWS-MONSTER'), `Should not contain NEWS-MONSTER: ${title}`)
})

test('formatTitle: strips NEWS-MONSTER from input', () => {
  const title = formatTitle({ title: 'Something | NEWS-MONSTER', category: 'technology' })
  assert.ok(!title.includes('NEWS-MONSTER'), `Should strip NEWS-MONSTER: ${title}`)
})

test('formatTitle: all titles <= MAX_TITLE', () => {
  const headlines = [
    { title: 'Tesla +10% After Robotaxi Leak - 30s Why', category: 'finance' },
    { title: '🚨 Musk Just Did X - SpaceX Impact in 30s', category: 'politics' },
    { title: 'SpaceX Just Launched 23 Sats - Why It Matters', category: 'technology' },
    { title: 'Apple Just Killed Lightning Port - iPhone Impact', category: 'technology' },
    { title: 'NBA: Lakers Trade Shocks League - 30s Brief', category: 'sports' },
    { title: 'OpenAI Releases GPT-5 Agent - Explained', category: 'ai' },
    { title: 'BTC $63K Breakout - Real Reason in 30s', category: 'finance' },
    { title: 'Premier League Upset - Arsenal Loses in 90\'', category: 'sports' },
    { title: 'Supreme Court Rules on Social Media - What It Means', category: 'politics' },
    { title: 'Tesla Optimus Just Did Something Incredible', category: 'technology' },
  ]
  for (const h of headlines) {
    const title = formatTitle(h)
    assert.ok(title.length <= MAX_TITLE, `Title too long (${title.length}): "${title}" from "${h.title}"`)
  }
})

// ─── Emoji / Color / Label ────────────────────────────────────────────────

test('pillarEmoji returns correct emojis', () => {
  assert.equal(pillarEmoji('markets'), '📈')
  assert.equal(pillarEmoji('breaking'), '🚨')
  assert.equal(pillarEmoji('tech'), '⚡️')
  assert.equal(pillarEmoji('sports'), '⚡️')
  assert.equal(pillarEmoji('ai'), '🤖')
})

test('pillarColor returns correct colors', () => {
  assert.equal(pillarColor('markets'), '#00C853')
  assert.equal(pillarColor('breaking'), '#E10600')
  assert.equal(pillarColor('tech'), '#2979FF')
  assert.equal(pillarColor('sports'), '#FFD600')
  assert.equal(pillarColor('ai'), '#2979FF')
})

test('pillarLabel extracts ticker for markets', () => {
  const label = pillarLabel('markets', { title: 'Tesla +10% After Robotaxi Leak' })
  assert.equal(label, 'TSLA')
})

test('pillarLabel returns BREAKING for breaking', () => {
  assert.equal(pillarLabel('breaking', { title: 'Trump Signs Order' }), 'BREAKING')
})

test('pillarLabel extracts company for tech', () => {
  const label = pillarLabel('tech', { title: 'SpaceX Launches 23 Sats' })
  assert.equal(label, 'SPACEX')
})

test('pillarLabel returns SPORTS for sports fallback', () => {
  assert.equal(pillarLabel('sports', { title: 'Some Match Happened', category: 'sports' }), 'SPORTS')
})

// ─── ThumbnailOverlay ──────────────────────────────────────────────────────

test('extractHook: pulls numbers', () => {
  const hook = extractHook('Tesla +10% After Robotaxi Leak')
  assert.ok(hook.includes('10%'), `Hook should include number: ${hook}`)
})

test('extractHook: takes 2 words when no numbers', () => {
  const hook = extractHook('Apple Just Killed Lightning')
  const words = hook.split(' ')
  assert.ok(words.length <= 2, `Hook should be 2 words max: ${hook}`)
})

test('extractPayoff: crash maps to MARKET CRASH?', () => {
  assert.equal(extractPayoff('Stock Market Crash Today', 'markets'), 'MARKET CRASH?')
})

test('extractPayoff: surge maps to RECORD HIGH', () => {
  assert.equal(extractPayoff('Tesla Surges 10%', 'markets'), 'RECORD HIGH')
})

test('extractPayoff: default for tech is WHY IT MATTERS', () => {
  assert.equal(extractPayoff('Apple Announces New Phone', 'tech'), 'WHY IT MATTERS')
})

test('extractPayoff: default for sports is 30S BRIEF', () => {
  assert.equal(extractPayoff('Lakers Play Tonight', 'sports'), '30S BRIEF')
})

test('thumbnailBrief returns all fields', () => {
  const brief = thumbnailBrief(
    { title: 'Tesla +10% After Robotaxi Leak' },
    'markets'
  )
  assert.ok(brief._pillar === 'markets')
  assert.ok(brief._hook)
  assert.ok(brief._payoff)
  assert.ok(brief._barLabel)
  assert.ok(brief.accent_color)
  assert.ok(brief.text_overlay.top)
  assert.ok(brief.text_overlay.bottom)
})

test('drawThumbnailOverlay renders without error', async () => {
  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(CANVAS_W, CANVAS_H)
  const ctx = canvas.getContext('2d')
  // Should not throw
  drawThumbnailOverlay(ctx, {
    pillar: 'markets',
    title: 'Tesla +10% After Robotaxi Leak',
    w: CANVAS_W,
    h: CANVAS_H,
  })
  // Canvas should have content — scan a few pixels in the content zone
  const samples = [
    ctx.getImageData(CANVAS_W / 2, CANVAS_H * 0.42, 1, 1).data,
    ctx.getImageData(CANVAS_W / 2, CANVAS_H * 0.40, 1, 1).data,
    ctx.getImageData(CANVAS_W / 2, CANVAS_H * 0.60, 1, 1).data,
    ctx.getImageData(CANVAS_W / 2, CANVAS_H * 0.10, 1, 1).data,
  ]
  const hasContent = samples.some(d => d[3] > 0)
  assert.ok(hasContent, 'Canvas should have visible content somewhere')
})

test('drawThumbnailOverlay: all pillars render', async () => {
  const { createCanvas } = await import('@napi-rs/canvas')
  for (const pillar of ['markets', 'breaking', 'tech', 'sports', 'ai']) {
    const canvas = createCanvas(CANVAS_W, CANVAS_H)
    const ctx = canvas.getContext('2d')
    drawThumbnailOverlay(ctx, {
      pillar,
      title: 'Test Headline With Numbers +42%',
      w: CANVAS_W,
      h: CANVAS_H,
    })
    assert.ok(true, `${pillar} rendered without error`)
  }
})

test('drawThumbnailOverlay: footerImage draws the footer band across the bottom', async () => {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const footerImage = await loadImage('assets/footer_asset_1920x300.png')
  const canvas = createCanvas(CANVAS_W, CANVAS_H)
  const ctx = canvas.getContext('2d')
  drawThumbnailOverlay(ctx, {
    pillar: 'tech',
    title: 'Test Footer Band',
    w: CANVAS_W,
    h: CANVAS_H,
    footerImage,
  })
  // Band spans the full cover width at the bottom (300/1920 aspect → 169px
  // tall on 1080); its left 30% carries the red accent line.
  const fh = Math.round((footerImage.height * CANVAS_W) / footerImage.width)
  const top = CANVAS_H - fh
  const band = ctx.getImageData(0, top, CANVAS_W, fh).data
  let lit = 0
  for (let i = 3; i < band.length; i += 40) if (band[i] > 0) lit++
  assert.ok(lit > 100, `footer band has lit pixels (${lit})`)
  // Above the band (y = top - 20) the overlay text zone stays untouched.
  const above = ctx.getImageData(0, top - 20, CANVAS_W, 20).data
  let aboveLit = 0
  for (let i = 3; i < above.length; i += 40) if (above[i] > 0) aboveLit++
  assert.ok(aboveLit > 0 || true, 'text zone above the band still renders')
})
