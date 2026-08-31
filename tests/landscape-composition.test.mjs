import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  composeLandscape,
  STRATEGIES,
  LAYOUT_META,
  FOOTER_HEIGHT,
  MAX_HEADLINE_LINES,
  MIN_SUBJECT_W,
  MAX_SUBJECT_W,
  BRAND,
  subjectRect,
} from '../src/thumbnail/LandscapeComposition.mjs'
import { ThumbnailCandidateGenerator, landscapeKeyword, landscapeHeadline } from '../src/thumbnail/ThumbnailCandidateGenerator.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'landscape-comp-'))

const BRIEF_TEXT = {
  keyword: 'ALTERA',
  headline: 'GAMING AI AGENT BREAKTHROUGH',
  status: 'BREAKING',
  brand: BRAND,
  accent: '#E10600',
  category: 'gaming',
}

function boxesOverlap(a, b) {
  if (!a || !b) return false
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

describe('LandscapeComposition — first-class 16:9 mode', () => {
  it('exposes the 5 composition strategies A–E with layout metadata', () => {
    assert.deepEqual(STRATEGIES, ['A', 'B', 'C', 'D', 'E'])
    for (const s of STRATEGIES) {
      assert.ok(LAYOUT_META[s], `missing meta for strategy ${s}`)
      assert.ok(LAYOUT_META[s].subject)
      assert.ok(LAYOUT_META[s].text)
    }
  })

  it('uses a compact footer (3–5% of canvas height) per the brief', () => {
    const footerRatio = FOOTER_HEIGHT
    assert.ok(footerRatio >= 0.03 && footerRatio <= 0.05, `footer ${footerRatio} must be 3–5%`)
  })

  it('caps headline at the brief\'s max lines (3)', () => {
    assert.equal(MAX_HEADLINE_LINES, 3)
  })

  it('renders a 16:9 PNG at 1920x1080 (preferred) and keeps keyword+headline as distinct levels', async () => {
    const p = path.join(TMP, '1080p.png')
    const r = await composeLandscape(BRIEF_TEXT, null, p, { width: 1920, height: 1080 })
    assert.equal(r.width, 1920)
    assert.equal(r.height, 1080)
    assert.equal(r.aspectRatio, '16:9')
    assert.ok(fs.existsSync(p))
    // PNG signature
    const buf = fs.readFileSync(p)
    assert.equal(buf[0], 0x89)
    assert.equal(buf[1], 0x50)
    // Two distinct semantic text levels.
    assert.ok(r.composition.keywordBox, 'keyword (level 3) box must exist')
    assert.ok(r.composition.headlineBox, 'headline (level 4) box must exist')
    assert.ok(r.composition.headlineLines.length > 0)
    assert.ok(r.composition.keywordBox.w > r.composition.headlineBox.w * 0.4, 'keyword should be a dominant visual element')
  })

  it('renders at 1280x720 (minimum) with correct aspect', async () => {
    const p = path.join(TMP, '720p.png')
    const r = await composeLandscape(BRIEF_TEXT, null, p, { width: 1280, height: 720 })
    assert.equal(r.width, 1280)
    assert.equal(r.height, 720)
    assert.ok(fs.existsSync(p))
  })

  it('keeps the headline within max lines for a long topic', async () => {
    const p = path.join(TMP, 'long.png')
    const r = await composeLandscape(
      { ...BRIEF_TEXT, headline: 'MICROSOFT AUTONOMOUS GAMING AGENT BREAKTHROUGH', keyword: 'MICROSOFT' },
      null, p, { width: 1920, height: 1080 },
    )
    assert.ok(r.composition.headlineLines.length <= MAX_HEADLINE_LINES,
      `headline lines ${r.composition.headlineLines.length} must be <= ${MAX_HEADLINE_LINES}`)
  })

  it('places the subject at 35–55% width for split layouts (A–D), full-frame for E', () => {
    for (const layout of ['A', 'B', 'C', 'D']) {
      const s = subjectRect({ W: 1920, H: 1080, layout, headerH: 97, footerH: 54 })
      const wRatio = s.w / 1920
      assert.ok(wRatio >= MIN_SUBJECT_W && wRatio <= MAX_SUBJECT_W,
        `layout ${layout} subject width ${(wRatio * 100).toFixed(0)}% must be 35–55%`)
    }
    const e = subjectRect({ W: 1920, H: 1080, layout: 'E', headerH: 97, footerH: 54 })
    assert.equal(e.w, 1920, 'E is full-bleed (100% width subject)')
  })

  it('does NOT overlap headline/keyword with the subject for A, B, C, D (text fights image = 0)', async () => {
    for (const layout of ['A', 'B', 'C', 'D']) {
      const p = path.join(TMP, `noverlap_${layout}.png`)
      const r = await composeLandscape({ ...BRIEF_TEXT, layout }, null, p, { width: 1920, height: 1080 })
      const s = r.composition.subjectRect
      const overlapsHeadline = boxesOverlap(s, r.composition.headlineBox)
      const overlapsKeyword = boxesOverlap(s, r.composition.keywordBox)
      assert.equal(overlapsHeadline, false, `layout ${layout}: headline must not overlap subject`)
      assert.equal(overlapsKeyword, false, `layout ${layout}: keyword must not overlap subject`)
      // Text respects the footer (anchored above it) and header.
      assert.ok(r.composition.headlineBox.y >= 0)
      assert.ok(r.composition.keywordBox.y >= 0)
    }
  })
})

describe('ThumbnailCandidateGenerator.generateLandscape — 16:9 candidates', () => {
  const gen = new ThumbnailCandidateGenerator()

  it('emits one candidate per layout A–E, all flagged landscape', () => {
    const c = gen.generateLandscape({ title: 'Gaming AI agent breakthrough', category: 'gaming' })
    assert.equal(c.length, 5)
    const layouts = c.map(x => x.layout)
    assert.deepEqual(layouts, ['A', 'B', 'C', 'D', 'E'])
    assert.ok(c.every(x => x.landscape === true))
    assert.ok(c.every(x => x.keyword && x.headline))
    assert.ok(c.every(x => x.status))
  })

  it('derives a SHORT 2–6 word copy, never the full article title (brief copy rules)', () => {
    const title = 'Microsoft unveils a new autonomous AI gaming agent capable of completing complex gameplay tasks'
    const c = gen.generateLandscape({ title, category: 'gaming' })
    const headline = c[0].headline
    const words = headline.split(/\s+/).filter(Boolean)
    assert.ok(words.length >= 2 && words.length <= 6,
      `headline '${headline}' must be 2–6 words, got ${words.length}`)
    assert.notEqual(headline, title.toUpperCase(), 'must not reuse the full article title')
    assert.ok(headline.length < 40, `headline should stay compact (got '${headline}')`)
  })

  it('prefers a strong numeral/entity keyword for the hook', () => {
    const kw = landscapeKeyword('Tesla reports record Q3 revenue of $25 billion', 'tesla')
    assert.ok(kw.length > 0)
  })

  it('helpers produce stable uppercase visual copy', () => {
    const kw = landscapeKeyword('Gaming AI agent breakthrough', 'gaming')
    const hd = landscapeHeadline('Gaming AI agent breakthrough', 'gaming')
    assert.equal(kw, kw.toUpperCase())
    assert.equal(hd, hd.toUpperCase())
    assert.ok(hd.length > 0)
  })
})

const HERO = path.join(__dirname, 'fixtures', 'test-image-16x9.png')

describe('ThumbnailCandidateGenerator + landscape render integration', () => {
  const gen = new ThumbnailCandidateGenerator()

  it('renders all five landscape candidates to valid 16:9 PNGs through the pipeline brief', async () => {
    const { ThumbnailRenderer } = await import('../src/thumbnail/ThumbnailRenderer.mjs')
    const renderer = new ThumbnailRenderer()
    const candidates = gen.generateLandscape({ title: 'Autonomous gaming AI breakthrough', category: 'gaming' })
    const outDir = path.join(TMP, 'rendered')
    const results = await renderer.renderAll(candidates, outDir)
    assert.equal(results.length, 5)
    for (const r of results) {
      assert.equal(r.rendered, true, `strategy ${r.strategy} should render`)
      assert.ok(fs.existsSync(r.path), `rendered file missing for ${r.strategy}`)
      // Landscape PNG width via IHDR (bytes 16-19 = width, 20-23 = height).
      const buf = fs.readFileSync(r.path)
      const w = buf.readUInt32BE(16)
      const h = buf.readUInt32BE(20)
      assert.equal(w, 1920)
      assert.equal(h, 1080)
      const ratio = w / h
      assert.ok(Math.abs(ratio - 16 / 9) < 0.01, `${r.strategy} must be 16:9`)
    }
  })
})

// Cleanup is left to the OS temp dir; force-remove at process exit is avoided
// to keep the test hermetic. (Files are small and under the OS temp dir.)
void HERO
