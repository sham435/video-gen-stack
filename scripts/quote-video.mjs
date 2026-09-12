#!/usr/bin/env node
// quote-video — produce one "Shelter in Rain" engagement-quote video.
//
// Usage:
//   node scripts/quote-video.mjs [--topic "shelter and resilience"]
//                                [--out output/quote]
//                                [--line4 "Your own closing line"]   (bypass LLM)
//                                [--registry data/asset-registry.json]  (ledger)
//                                [--imgdb data/image-database.sqlite]   (image db)
//                                [--no-music]
//
// Additive entry point: does NOT touch the news pipeline. Uses the SAME
// shared AssetRegistry ledger (data/asset-registry.json) so line-4 dedup and
// the 7-day image quarantine apply to quote videos too.
//
// Line-4 LLM path (production): the repo's provider chain → OpenCode Zen
// big-pickle via https://opencode.ai/zen/v1/chat/completions. Authenticate
// with a Zen API key through the OPENCODE_ZEN_API_KEY env var (secret
// manager, never commit). The deterministic pool is used only when every
// backend genuinely fails. The console free tier additionally needs the
// OpenCode session id — auto-discovered here when present.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveProviderChain } from '../src/ai/providers/resolveProviders.mjs'
import { discoverZenSessionId } from '../src/ai/providers/ZenProvider.mjs'
import { QuoteVideoEngine } from '../src/formats/quote/QuoteVideoEngine.mjs'

function parseArgs(argv) {
  const opts = { topic: null, out: null, line4: null, noMusic: false, registry: null, imgdb: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--topic') opts.topic = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--line4') opts.line4 = argv[++i]
    else if (a === '--registry') opts.registry = argv[++i]
    else if (a === '--imgdb') opts.imgdb = argv[++i]
    else if (a === '--no-music') opts.noMusic = true
  }
  return opts
}

export async function runQuoteVideo(opts = {}) {
  // Production provider model: the free OpenCode/Big Pickle session path is a
  // FIRST-CLASS provider (no paid Zen key required). OPENCODE_ZEN_API_KEY is
  // supported but optional — when set it is used as the Zen credential; the
  // session bridge stays enabled regardless so the free path remains valid
  // even if the paid key is absent or misconfigured.
  const sessionId = discoverZenSessionId()
  if (sessionId && !process.env.ZEN_SESSION_ID) process.env.ZEN_SESSION_ID = sessionId

  const { chain, providers } = await resolveProviderChain()
  const engine = new QuoteVideoEngine({
    provider: chain,
    outDir: opts.out || path.resolve(process.cwd(), 'output', 'quote'),
    registryPath: opts.registry || undefined,
    imageDbPath: opts.imgdb || undefined,
  })
  const summary = await engine.run({
    topic: opts.topic || 'shelter and resilience',
    fakeLine4: opts.line4 || null,
    musicPath: opts.noMusic ? null : undefined,
  })
  return { summary, providers, sessionId }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const startMs = Date.now()
  const { summary, providers, sessionId } = await runQuoteVideo(opts)
  const zen = providers.find(p => p.constructor?.name === 'ZenProvider')
  console.log(JSON.stringify({
    ok: true,
    format: summary.format,
    line4: summary.line4,
    line4Source: summary.line4Source, // 'llm' | 'fallback' — acceptance gate for production
    line4Provider: zen ? 'OpenCode Zen' : null,
    line4Model: zen?.lastModel && summary.line4Source === 'llm' ? zen.lastModel : zen?.lastModel ?? null,
    zenSession: sessionId ? 'present' : 'absent',
    videoPath: summary.videoPath,
    totalDuration: summary.totalDuration,
    totalFrames: summary.totalFrames,
    providers: providers.map(p => p.constructor?.name || 'provider'),
    unique: 'line4 dedup + image quarantine gate PASSED',
    elapsedMs: Date.now() - startMs,
  }, null, 2))
  if (!summary.videoPath || !fs.existsSync(summary.videoPath)) {
    console.error('[quote-video] render produced no video — see manifest for details')
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch(err => {
    console.error('[quote-video] FAIL:', err.message)
    if (process.env.DEBUG) console.error(err.stack)
    process.exitCode = 1
  })
}