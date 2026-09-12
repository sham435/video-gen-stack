// QuoteVideoEngine — orchestrator for the "Shelter in Rain" engagement-quote
// video format. Additive: reuses the existing uniqueness + visual-selection
// machinery verbatim and never touches the news pipeline.
//
// Uniqueness contract (same gates as news, SAME shared ledger by default):
//   1. Line 4 (the only variable line) is deduped via ScriptUniqueness +
//      AssetRegistry — exact hash + semantic similarity vs the shared ledger.
//   2. Scene images go through GlobalAssetUniquenessGate — scene-within-video
//      duplicates and the 7-day rolling quarantine (PR #199) both apply.
//
// Fail closed: uniqueness violations throw before any rendering happens; a
// reservation is taken before render and committed (or released) after.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { AssetRegistry } from '../../uniqueness/AssetRegistry.mjs'
import { GlobalAssetUniquenessGate } from '../../uniqueness/GlobalAssetUniquenessGate.mjs'
import { ImageDatabase } from '../../assets/ImageDatabase.mjs'
import { VisualSearchEngine } from '../../assets/VisualSearchEngine.mjs'
import { ImageRanker } from '../../assets/ImageRanker.mjs'
import { QuoteLineAgent, QUOTE_LINES_FIXED } from './QuoteLineAgent.mjs'
import { QuoteRenderer, QUOTE_TIMING } from './QuoteRenderer.mjs'

const DEFAULT_REGISTRY_PATH = path.resolve(process.cwd(), 'data', 'asset-registry.json')
const DEFAULT_IMAGE_DB_PATH = path.resolve(process.cwd(), 'data', 'image-database.sqlite')
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'output', 'quote')

// Per-line visual intents — themed for the spec (rain / shelter / resilience).
function sceneIntents(line4) {
  return [
    { subject: 'determined person walking in rain', keywords: ['resilience', 'keeps going'], sceneType: 'hook' },
    { subject: 'hands building shelter in rain', keywords: ['shelter', 'building'], sceneType: 'explain' },
    { subject: 'hand raised among crowd in rain', keywords: ['comment', 'voice'], sceneType: 'reaction' },
    { subject: pathOrFallback(line4), keywords: ['hope', 'storm passing'], sceneType: 'close' },
  ]
}

function pathOrFallback(line4) {
  const slug = String(line4 || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => !['you', 'your', 'what', 'where', 'when', 'the', 'a', 'an', 'in', 'of', 'for', 'to', 'is', 'are', 'i', 'me', 'my'].includes(w))
    .slice(0, 3)
    .join(' ')
  return slug && slug.length > 2 ? `${slug} in the rain` : 'shelter in the rain'
}

function sha16(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16)
}

function fnv(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}

export class QuoteVideoEngine {
  /**
   * @param {object} opts
   *   provider         ProviderChain|null (line-4 LLM)
   *   registry         AssetRegistry (default shared data/asset-registry.json)
   *   imageDb          ImageDatabase|null
   *   visualSearch     VisualSearchEngine|null
   *   imageRanker      ImageRanker|null
   *   fakeVisuals      Array<Array<{url, sha256, dHash?, keyword?}>> per scene (tests only)
   *   renderer         QuoteRenderer|null
   *   outDir           string
   */
  constructor(opts = {}) {
    this.provider = opts.provider || null
    this.registry = opts.registry || new AssetRegistry({ filePath: opts.registryPath || DEFAULT_REGISTRY_PATH })
    this.imageDb = opts.imageDb !== undefined ? opts.imageDb : null
    if (!this.imageDb && (opts.imageDbPath || DEFAULT_IMAGE_DB_PATH) && fs.existsSync(opts.imageDbPath || DEFAULT_IMAGE_DB_PATH)) {
      this.imageDb = new ImageDatabase(opts.imageDbPath || DEFAULT_IMAGE_DB_PATH)
    }
    this.visualSearch = opts.visualSearch || new VisualSearchEngine({ database: this.imageDb, pexelsKey: process.env.PEXELS_API_KEY })
    this.imageRanker = opts.imageRanker || new ImageRanker()
    this.fakeVisuals = opts.fakeVisuals || null
    this.renderer = opts.renderer || new QuoteRenderer()
    this.outDir = opts.outDir || DEFAULT_OUT_DIR
    this.gate = new GlobalAssetUniquenessGate(this.registry, this.imageDb)
    this.agent = new QuoteLineAgent(this.provider, this.registry)
  }

  /**
   * Produce one engagement-quote video.
   * @param {object} opts {topic, jobId, videoId, musicPath, skipRender, fakeLine4, runId}
   * @returns {Promise<object>} run manifest
   */
  async run(opts = {}) {
    const jobId = opts.jobId || `quote-${Date.now()}`
    const runId = opts.runId || new Date().toISOString().replace(/[:.]/g, '-')
    const videoId = opts.videoId || `quote-${runId}`

    // 1. Variable line 4 — deduped against the shared ledger.
    const generated = opts.fakeLine4
      ? { line4: opts.fakeLine4, source: 'injected', tries: 1 }
      : await this.agent.generate({ excludeJobId: jobId, topic: opts.topic })
    const lines = [...QUOTE_LINES_FIXED, generated.line4]
    const scriptHash = sha16(generated.line4)

    // 2. Visual selection per scene — uniqueness-aware.
    const scenes = await this._selectVisuals(lines, jobId)

    // 3. Uniqueness gate — same scopes as news, fail closed.
    const manifest = {
      jobId,
      title: generated.line4,
      scriptHash,
      scriptText: generated.line4,
      scenes: scenes.map((s, i) => ({ sceneIndex: i, imageHash: s.imageHash, url: s.image })),
      music: null,
      thumbnail: null,
    }
    const verdict = await this.gate.validate(manifest, { jobId })
    if (!verdict.pass) {
      throw new Error(`QuoteVideoEngine: uniqueness gate FAILED (${jobId}): ${verdict.violations.map(v => `[${v.scope}] ${v.detail}`).join(' | ')}`)
    }

    // 4. Reserve → render → commit (or release).
    this.gate.reserve(jobId, {
      scriptHash,
      scriptText: generated.line4,
      imageHashes: scenes.map(s => s.imageHash).filter(Boolean),
    })

    const outDir = path.join(this.outDir, runId)
    let render = null
    try {
      if (!opts.skipRender) {
        const musicPath = opts.musicPath === undefined ? this._pickMusic(runId) : opts.musicPath
        render = await this.renderer.renderAndAssemble(scenes, lines, outDir, { musicPath })
      }
      this.gate.commit(jobId, { videoId, category: 'quote' })
      for (const s of scenes) {
        if (s.imageHash && this.imageDb) {
          this.imageDb.recordUsage(s.imageHash, { videoId, sceneIndex: s.index })
        }
      }
      this.agent.record(generated.line4, { jobId, videoId, title: generated.line4 })
    } catch (err) {
      this.gate.release(jobId)
      throw err
    }

    // Provider attribution for the manifest: the Zen provider is the
    // free-session / paid-key Big Pickle route; lastModel tells which model
    // actually served (big-pickle after fallback selection).
    const zenProvider = this.provider?.providers?.find(p => p.constructor?.name === 'ZenProvider') || null

    const summary = {
      format: 'engagement-quote',
      runId,
      jobId,
      videoId,
      lines,
      line4: generated.line4,
      line4Source: generated.source,
      line4Provider: zenProvider ? 'OpenCode Zen' : null,
      line4Model: zenProvider?.lastModel ?? null,
      scriptHash,
      scenes: scenes.map(s => ({ index: s.index, image: s.image, imageHash: s.imageHash })),
      uniqueness: {
        line4Deduped: true,
        gatePassed: true,
        scopes: verdict.scopeResults.map(r => ({ scope: r.scope, pass: r.pass, detail: r.detail })),
      },
      videoPath: render ? render.videoPath : null,
      totalDuration: render ? render.totalDuration : null,
      totalFrames: render ? render.totalFrames : null,
      outDir,
    }

    const manifestPath = path.join(outDir, 'manifest.json')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(manifestPath, JSON.stringify(summary, null, 2))
    console.log(`[QuoteVideoEngine] manifest written: ${manifestPath}`)
    return summary
  }

  // ── Visual selection ─────────────────────────────────────────────────

  async _selectVisuals(lines, jobId) {
    const usedUrls = new Set()
    const usedHashes = new Set()
    const intents = sceneIntents(lines[3])
    const scenes = []

    for (let i = 0; i < 4; i++) {
      const intent = intents[i]
      let candidates = []

      if (this.fakeVisuals) {
        candidates = (this.fakeVisuals[i] || []).filter(c => !usedUrls.has(c.url))
      } else {
        try {
          const results = await this.visualSearch.search(intent)
          candidates = results || []
        } catch (err) {
          console.warn(`[QuoteVideoEngine] visual search failed for scene ${i}: ${err.message}`)
          candidates = []
        }
      }

      // Enforce within-video uniqueness explicitly (belt and suspenders —
      // the gate re-checks via hashes too).
      candidates = candidates.filter(c => {
        if (usedUrls.has(c.url)) return false
        if (c.sha256 && usedHashes.has(c.sha256)) return false
        return true
      })

      const ranked = this.imageRanker.rank(candidates, intent, { used: [...usedUrls] })
      const chosen = ranked[0] || null

      const scene = {
        index: i,
        line: lines[i],
        image: chosen?.url || null,
        imageHash: chosen?.sha256 || null,
        assetDHash: chosen?.dHash || null,
        keyword: chosen?.keyword || intent.keywords[0],
        intent,
      }
      if (chosen?.url) usedUrls.add(chosen.url)
      if (chosen?.sha256) usedHashes.add(chosen.sha256)
      scenes.push(scene)
      console.log(`[QuoteVideoEngine] scene ${i} "${lines[i].slice(0, 28)}" → ${scene.image ? scene.image.slice(0, 60) : 'gradient fallback'}${scene.imageHash ? ` (${scene.imageHash})` : ' (no hash)'}`)
    }
    return scenes
  }

  // Deterministic music pick (no narration bed — quiet underscore only).
  _pickMusic(seed) {
    const dir = path.resolve(process.cwd(), 'assets', 'music')
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir)
      .filter(f => /\.(mp3|wav|m4a|ogg)$/i.test(f))
      .sort()
    if (!files.length) return null
    return path.join(dir, files[fnv(seed) % files.length])
  }
}

export { QUOTE_TIMING }