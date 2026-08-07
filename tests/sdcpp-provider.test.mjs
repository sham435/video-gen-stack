import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SDCPPProvider } from '../src/thumbnail/SDCPPProvider.mjs'

// ---------------------------------------------------------------------------
// arg building
// ---------------------------------------------------------------------------

test('buildArgs — full flag set, ordered', () => {
  const p = new SDCPPProvider({ bin: '/x/bin', model: '/x/model.gguf' })
  const args = p.buildArgs({ prompt: 'a news hero', negative: 'blur', width: 832, height: 1216, steps: 20, cfg: 7.0, seed: 999, outPath: '/tmp/o.png' })
  assert.deepEqual(args, [
    '-m', '/x/model.gguf',
    '-p', 'a news hero',
    '-n', 'blur',
    '-W', '832',
    '-H', '1216',
    '--steps', '20',
    '--cfg-scale', '7',
    '-s', '999',
    '--sampling-method', 'euler_a',
    '--vae-tiling',
    '-o', '/tmp/o.png',
  ])
})

test('buildArgs — vae-tiling can be disabled', () => {
  const p = new SDCPPProvider({ bin: '/x/bin', model: '/x/model.gguf' })
  const args = p.buildArgs({ prompt: 'p', outPath: '/o.png', vaeTiling: false })
  assert.equal(args.includes('--vae-tiling'), false)
})

test('buildArgs — defaults applied', () => {
  const p = new SDCPPProvider({ bin: '/x/bin', model: '/x/model.gguf' })
  const args = p.buildArgs({ prompt: 'p', outPath: '/o.png' })
  assert.ok(args.includes('768'), 'default height/width')
  assert.ok(args.includes('42'), 'default seed')
  assert.ok(args.includes('20'), 'default steps')
})

// ---------------------------------------------------------------------------
// availability gating (cold/no-env → never spawn)
// ---------------------------------------------------------------------------

test('available — false when binary or model missing', () => {
  const missing = new SDCPPProvider({ bin: '/nonexistent/sd-cli', model: '/nonexistent/model.gguf' })
  assert.equal(missing.available(), false)
  // Real env: the default provider only advertises available() when both the
  // built binary AND the downloaded model are on disk — aligns with intent.
  const real = new SDCPPProvider()
  assert.equal(typeof real.available(), 'boolean')
  assert.equal(real.bin.includes('stable-diffusion.cpp'), true)
})

test('generate — returns null (never throws, no spawn) when unavailable', () => {
  const p = new SDCPPProvider({ bin: '/nonexistent/sd-cli', model: '/nonexistent/model.gguf' })
  const r = p.generate({ prompt: 'hello', outPath: path.join(os.tmpdir(), 'sd-x.png') })
  assert.equal(r, null)
  assert.equal(fs.existsSync(path.join(os.tmpdir(), 'sd-x.png')), false, 'nothing written')
})

test('generate — null on missing prompt even when available', () => {
  const fake = path.join(os.tmpdir(), 'fake-sd-cli')
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(fake, 0o755)
  const p = new SDCPPProvider({ bin: fake, model: fake }) // fake paths exist → available() true
  assert.equal(p.available(), true)
  assert.equal(p.generate({ outPath: '/tmp/x.png' }), null, 'no prompt → null')
})

// ---------------------------------------------------------------------------
// CoverGenerator integration — SD used as hero fallback when available
// ---------------------------------------------------------------------------

test('resolveHero — falls through to SDCPP provider when Pexels has no key', async () => {
  const { CoverGenerator } = await import('../src/video-studio/CoverGenerator.mjs')
  const calls = []
  const stub = {
    available: () => true,
    generate: (spec) => { calls.push(spec); return { path: '/tmp/sd-hero.png' } },
  }
  const g = new CoverGenerator(null, { intelligence: null, sdcpp: stub })
  // no dotenv in tests → Pexels key unset → searchPexels returns null → SD stub runs
  const hero = await g.resolveHero({ title: 'Apple Wins Big' }, { keywords: ['apple'], hero_prompt: 'apple chip', subject: 'apple' })
  assert.equal(hero, '/tmp/sd-hero.png')
  assert.ok(calls.length === 1)
  assert.equal(calls[0].negative.includes('watermark'), true, 'negative prompt strips artifacts')
  const same = await g.resolveHero({ title: 'Apple Wins Big' }, { keywords: ['apple'], hero_prompt: 'apple', subject: 'apple' })
  assert.equal(calls[1]?.seed, calls[0]?.seed, 'deterministic seed from title')
  void same
})

test('CoverGenerator — SDCPP disabled per-article is skipped without touching Pexels', async () => {
  const { CoverGenerator } = await import('../src/video-studio/CoverGenerator.mjs')
  let called = false
  const g = new CoverGenerator(null, {
    intelligence: null,
    sdcpp: { available: () => true, generate: () => { called = true; return { path: '/tmp/x.png' } } },
  })
  const hero = await g.resolveHero({ title: 'X', sdcpp: false, imageUrl: 'pexels.com/img' }, { keywords: [] })
  assert.equal(called, false, 'SD not invoked when article.sdcpp === false')
  assert.equal(hero, 'pexels.com/img', 'falls to article image')
})