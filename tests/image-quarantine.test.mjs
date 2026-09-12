// image-quarantine.test.mjs — mandatory image-uniqueness invariants.
//
// Two rules, enforced at the FINAL-ASSET boundary (UNIQUENESS stage / gate):
//
//   R1. INTRA-VIDEO: fingerprint(finalImage(Si)) !== fingerprint(finalImage(Sj))
//       for every i !== j in the same video. Fail closed — a duplicate must
//       never reach the scene manifest/upload.
//
//   R2. ROLLING 7-DAY CROSS-VIDEO QUARANTINE: a final image committed by ANY
//       video within the previous 7×24 hours is unavailable for a new video.
//       `candidate NOT IN images_used_during_previous_7_days`. The window is
//       time-based (rolling), never a calendar-week reset. Ledger unavailable
//       or ambiguous → FAIL CLOSED.
//
// Acceptance assertions:
//   currentVideoFinalImages ∩ previous7DayFinalImages = ∅
//   unique(currentVideoFinalImages).size === sceneCount

import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AssetRegistry, QUARANTINE_DAYS } from '../src/uniqueness/AssetRegistry.mjs'
import { GlobalAssetUniquenessGate } from '../src/uniqueness/GlobalAssetUniquenessGate.mjs'
import { SceneAssetUniqueness } from '../src/uniqueness/SceneAssetUniqueness.mjs'
import { ProductionUniquenessManifest } from '../src/uniqueness/ProductionUniquenessManifest.mjs'
import { ImageDatabase } from '../src/assets/ImageDatabase.mjs'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

const H1 = 'ab'.repeat(8)            // 64-bit dHash A
const H2 = 'ab'.repeat(7) + 'cd'     // dHash B — d(H2,H1) = ? (bitwise, computed via helper)

function dHashDistance(a, b) {
  const ai = BigInt('0x' + a)
  const bi = BigInt('0x' + b)
  let x = ai ^ bi
  let dist = 0
  while (x) { dist += Number(x & 1n); x >>= 1n }
  return dist
}

/** Build a uniqueness manifest from scene image hashes. */
function buildManifest(scenes, { jobId = 'job-x' } = {}) {
  let m = new ProductionUniquenessManifest()
    .setArticle({ title: 'Test Article', category: 'technology', publishedAt: '2026-09-12' })
    .setScript(`Fresh narration ${Date.now()}`)
    .setJobId(jobId)
  scenes.forEach((imageHash, i) => {
    m = m.addScene(i, { imageHash })
  })
  return m.build()
}

/** Unique final-image count from a manifest. */
function uniqueSceneCount(manifest) {
  return new Set(manifest.scenes.map(s => s.imageHash).filter(Boolean)).size
}

describe('R1 — intra-video final-image uniqueness', () => {
  let tmpDir, reg, gate

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-intra-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    gate = new GlobalAssetUniquenessGate(reg, null)
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('rejects 2 scenes committing the same final image', async () => {
    const manifest = buildManifest(['img-A', 'img-A'], { jobId: 'j1' })
    const r = await gate.validate(manifest, { jobId: 'j1' })
    assert.equal(r.pass, false)
    const within = r.scopeResults.find(s => s.scope === 'scene-within-video')
    assert.equal(within.pass, false)
    assert.ok(within.violations.some(v => v.type === 'DUPLICATE_SCENE_IMAGE'))
  })

  it('rejects any duplicate final image across 3+ scenes', async () => {
    const manifest = buildManifest(['img-A', 'img-B', 'img-C', 'img-A'], { jobId: 'j1' })
    const r = await gate.validate(manifest, { jobId: 'j1' })
    assert.equal(r.pass, false)
    const within = r.scopeResults.find(s => s.scope === 'scene-within-video')
    assert.equal(within.pass, false)
  })

  it('exact duplicate fingerprints are rejected (same sha256 identity)', async () => {
    // Same canonical fingerprint = same asset, regardless of any URL/name variance.
    const manifest = buildManifest(['deadbeef01', 'deadbeef02', 'deadbeef01'], { jobId: 'j1' })
    const r = await gate.validate(manifest, { jobId: 'j1' })
    assert.equal(r.pass, false)
  })

  it('duplicate candidate is rejected and a video with unique candidates passes (uniqueFinalImageCount === sceneCount)', async () => {
    // First attempt: scene 2 duplicates scene 0 → BLOCKED (fail closed, no
    // silent reuse). After replacing the duplicate with an eligible candidate
    // the same production passes and every scene has a distinct identity.
    const dupManifest = buildManifest(['img-A', 'img-B', 'img-A'], { jobId: 'j1' })
    const blocked = await gate.validate(dupManifest, { jobId: 'j1' })
    assert.equal(blocked.pass, false)

    const fixed = buildManifest(['img-A', 'img-B', 'img-C'], { jobId: 'j1' })
    const r = await gate.validate(fixed, { jobId: 'j1' })
    assert.equal(r.pass, true)
    assert.equal(uniqueSceneCount(fixed), 3)
    assert.equal(uniqueSceneCount(fixed), fixed.scenes.length)
    const within = r.scopeResults.find(s => s.scope === 'scene-within-video')
    assert.ok(within.pass, `within-video must pass with N unique identities, got ${within.detail}`)
  })

  it('fails closed when ALL remaining candidates are duplicates', async () => {
    const manifest = buildManifest(['img-X', 'img-X', 'img-X'], { jobId: 'j1' })
    const r = await gate.validate(manifest, { jobId: 'j1' })
    assert.equal(r.pass, false)
    const within = r.scopeResults.find(s => s.scope === 'scene-within-video')
    assert.ok(within.violations.length >= 2)
  })

  it('complete multi-scene video has N scenes and N unique final-image identities', async () => {
    const sceneHashes = ['h-01', 'h-02', 'h-03', 'h-04', 'h-05', 'h-06']
    const manifest = buildManifest(sceneHashes, { jobId: 'j1' })
    const r = await gate.validate(manifest, { jobId: 'j1' })
    assert.equal(r.pass, true)
    assert.equal(uniqueSceneCount(manifest), sceneHashes.length)
    assert.equal(uniqueSceneCount(manifest), manifest.scenes.length)
    const within = r.scopeResults.find(s => s.scope === 'scene-within-video')
    assert.match(within.detail, /\d+ scenes, \d+ unique hashes/)
  })
})

describe('R2 — rolling 7-day cross-video quarantine (registry boundary)', () => {
  let tmpDir, reg, gate

  const NOW = new Date('2026-09-12T12:00:00.000Z')

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-xvid-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    gate = new GlobalAssetUniquenessGate(reg, null)
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('rejects an image used 1 hour ago by another video (candidate → check → reserve → commit)', () => {
    reg.recordPublishedVideo('v-old', { imageHashes: ['img-hot'], now: new Date(NOW.getTime() - 1 * HOUR) })
    const q = reg.isImageQuarantined('img-hot', { now: NOW })
    assert.equal(q.quarantined, true)
    assert.equal(q.reason, 'IMAGE_QUARANTINED_7D')
    assert.equal(q.unknown, false)
  })

  it('rejects an image used 6 days ago (still inside the 7-day window)', () => {
    reg.recordPublishedVideo('v-old', { imageHashes: ['img-6d'], now: new Date(NOW.getTime() - 6 * DAY) })
    assert.equal(reg.isImageQuarantined('img-6d', { now: NOW }).quarantined, true)
  })

  it('boundary convention: eligible exactly at T+7d, rejected 1ms before', () => {
    const usedAt = new Date(NOW.getTime() - 5 * DAY)
    reg.recordPublishedVideo('v-old', { imageHashes: ['img-b'], now: usedAt })
    const eligibleAt = new Date(usedAt.getTime() + QUARANTINE_DAYS * DAY)
    // At/after T + 7×24h → eligible
    assert.equal(reg.isImageQuarantined('img-b', { now: eligibleAt }).quarantined, false)
    // One millisecond earlier → still blocked
    assert.equal(reg.isImageQuarantined('img-b', { now: new Date(eligibleAt.getTime() - 1) }).quarantined, true)
  })

  it('image older than 7 days becomes eligible again (and passes the full gate)', async () => {
    const oldTs = new Date(NOW.getTime() - 8 * DAY)
    reg.recordPublishedVideo('v-old', { imageHashes: ['img-old'], now: oldTs })
    // Push the old entry out of the 50-video window so only the 7-day rule applies.
    for (let i = 0; i < 60; i++) {
      reg.recordPublishedVideo(`v-filler-${i}`, { imageHashes: [`filler-${i}`], now: new Date(NOW.getTime() - 1 * HOUR) })
    }
    assert.equal(reg.isImageDuplicate('img-old'), false)
    assert.equal(reg.isImageQuarantined('img-old', { now: NOW }).quarantined, false)
    const manifest = buildManifest(['img-old', 'other-img'], { jobId: 'j-new' })
    manifest.scenes[0].imageHash = 'img-old'
    const r = await gate.validate(manifest, { jobId: 'j-new', manifestScenes: manifest.scenes })
    assert.equal(r.pass, true)
  })

  it('rolling 7-day calculation — not a calendar-week reset', () => {
    // Images used on Monday and Wednesday are BOTH still quarantined on Friday
    // (only 2 days / 4 days elapsed). No weekly bucket reset.
    const monday = new Date(NOW.getTime() - 4 * DAY)
    const wednesday = new Date(NOW.getTime() - 2 * DAY)
    reg.recordPublishedVideo('v-mon', { imageHashes: ['img-mon'], now: monday })
    reg.recordPublishedVideo('v-wed', { imageHashes: ['img-wed'], now: wednesday })
    assert.equal(reg.isImageQuarantined('img-mon', { now: NOW }).quarantined, true)
    assert.equal(reg.isImageQuarantined('img-wed', { now: NOW }).quarantined, true)
    // 8 days after Monday's use the image is free again (rolling), NOT at the next calendar week.
    const nextMondayPlus = new Date(monday.getTime() + 8 * DAY)
    assert.equal(reg.isImageQuarantined('img-mon', { now: nextMondayPlus }).quarantined, false)
  })

  it('currentVideoFinalImages ∩ previous7DayFinalImages = ∅', () => {
    reg.recordPublishedVideo('v1', { imageHashes: ['img-A', 'img-B'], now: new Date(NOW.getTime() - 1 * DAY) })
    reg.recordPublishedVideo('v2', { imageHashes: ['img-C'], now: new Date(NOW.getTime() - 5 * DAY) })
    reg.recordPublishedVideo('v3', { imageHashes: ['img-old'], now: new Date(NOW.getTime() - 10 * DAY) })

    const current = ['img-D', 'img-E', 'img-F']
    for (const h of current) {
      assert.equal(reg.isImageQuarantined(h, { now: NOW }).quarantined, false)
    }
    const { images: previous7d } = reg.recentCommittedImages({ now: NOW })
    for (const h of current) {
      assert.ok(!previous7d.includes(h), `current final image ${h} must not appear in previous-7d set`)
    }
    for (const h of ['img-A', 'img-B', 'img-C']) {
      assert.ok(previous7d.includes(h), `recentCommittedImages must include ${h}`)
      assert.ok(!previous7d.includes('img-old'), '>7d image must not be in the quarantine set')
    }
  })
})

describe('R2 — gate-level cross-video quarantine (SceneAssetUniqueness)', () => {
  let tmpDir, reg, checker

  const NOW = new Date('2026-09-12T12:00:00.000Z')

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-scene-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    checker = new SceneAssetUniqueness(reg)
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  function scenes(hashes) {
    return hashes.map((imageHash, sceneIndex) => ({ sceneIndex, imageHash }))
  }

  it('blocks a new video whose final image was committed by another video 6 days ago', () => {
    reg.recordPublishedVideo('v-recent', { imageHashes: ['img-recent-other'], now: new Date(NOW.getTime() - 1 * HOUR) })
    reg.recordPublishedVideo('v-old', { imageHashes: ['img-shared'], now: new Date(NOW.getTime() - 6 * DAY) })
    // Age img-shared OUT of the 50-video window so ONLY the 7-day quarantine
    // rule applies at the boundary (isImageDuplicate = stronger global rule
    // naturally fires first when both apply).
    for (let i = 0; i < 60; i++) {
      reg.recordPublishedVideo(`v-filler-${i}`, { imageHashes: [`filler-${i}`], now: new Date(NOW.getTime() - 2 * HOUR) })
    }
    assert.equal(reg.isImageDuplicate('img-shared', null), false)
    // img-new is a genuinely fresh candidate (absent from the ledger); only
    // img-shared (committed 6 days ago) violates the 7-day quarantine.
    const r = checker.validate(scenes(['img-new', 'img-shared']))
    assert.equal(r.pass, false)
    assert.equal(r.violations.length, 1)
    assert.match(r.violations[0].reason, /IMAGE_QUARANTINED_7D/, `reason was: ${r.violations[0].reason}`)
  })

  it('concurrent jobs: reservation fails closed — second job cannot reserve the same image', async () => {
    // Job A: validate + reserve final image img-X (atomic reserve lifecycle).
    const manifestA = buildManifest(['img-X', 'img-Y'], { jobId: 'jobA' })
    const gate = new GlobalAssetUniquenessGate(reg, null)
    const vA = await gate.validate(manifestA, { jobId: 'jobA' })
    assert.equal(vA.pass, true)
    assert.equal(gate.reserve('jobA', {
      scriptHash: manifestA.scriptHash,
      imageHashes: manifestA.scenes.map(s => s.imageHash).filter(Boolean),
    }).reserved, true)

    // Job B (concurrent): same image → validate fails AND reserve conflicts.
    const manifestB = buildManifest(['img-X', 'img-Z'], { jobId: 'jobB' })
    const vB = await gate.validate(manifestB, { jobId: 'jobB' })
    assert.equal(vB.pass, false)
    const resB = gate.reserve('jobB', {
      scriptHash: manifestB.scriptHash,
      imageHashes: manifestB.scenes.map(s => s.imageHash).filter(Boolean),
    })
    assert.equal(resB.reserved, false)
    assert.match(resB.conflict, /reserved by job jobA/)

    // Commit jobA at T → img-X is now permanently quarantined for 7 days.
    gate.commit('jobA', { videoId: 'v-A', category: 'technology', now: NOW })
    assert.equal(reg.state.reservations['jobA'], undefined)
    const q = reg.isImageQuarantined('img-X', { now: NOW })
    assert.equal(q.quarantined, true)
    assert.equal(q.reason, 'IMAGE_QUARANTINED_7D')
  })

  it('release() frees the reservation so a second job can reserve (no false quarantine)', async () => {
    const manifestA = buildManifest(['img-X'], { jobId: 'jobA' })
    const gate = new GlobalAssetUniquenessGate(reg, null)
    assert.equal(gate.reserve('jobA', { imageHashes: ['img-X'] }).reserved, true)
    gate.release('jobA')
    const gate2 = new GlobalAssetUniquenessGate(reg, null)
    const vB = await gate2.validate(buildManifest(['img-X'], { jobId: 'jobB' }), { jobId: 'jobB' })
    assert.equal(vB.pass, true)
    assert.equal(gate2.reserve('jobB', { imageHashes: ['img-X'] }).reserved, true)
    gate2.release('jobB')
  })
})

describe('R2 — fail closed: ledger unavailable / ambiguous history', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-fail-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('corrupt ledger → fail closed (unknown history treated as quarantined)', () => {
    const file = path.join(tmpDir, 'reg.json')
    fs.writeFileSync(file, '{ this is not valid json !!!')
    const reg = new AssetRegistry({ filePath: file })
    assert.equal(reg._corrupt, true)
    const q = reg.isImageQuarantined('any-image')
    assert.equal(q.quarantined, true)
    assert.equal(q.unknown, true)
    assert.equal(q.reason, 'LEDGER_CORRUPT')

    const checker = new SceneAssetUniqueness(reg)
    const r = checker.validate([{ sceneIndex: 0, imageHash: 'any-image' }])
    assert.equal(r.pass, false)
    assert.match(r.violations[0].reason, /IMAGE_QUARANTINE_FAIL_CLOSED/)
  })

  it('ambiguous historical usage → fail closed (unparseable committed timestamp)', () => {
    const file = path.join(tmpDir, 'reg.json')
    const reg = new AssetRegistry({ filePath: file })
    reg.recordPublishedVideo('v-odd', { imageHashes: ['img-amb'] })
    // History EXISTS for img-amb but its committed timestamp cannot be dated →
    // freshness cannot be proven → fail closed (never assume fresh).
    reg.state.images['img-amb'].lastUsed = 'not-a-date'
    fs.writeFileSync(file, JSON.stringify(reg.state))
    const reg2 = new AssetRegistry({ filePath: file })
    const q = reg2.isImageQuarantined('img-amb', { now: new Date('2026-09-12T12:00:00.000Z') })
    assert.equal(q.unknown, true)
    assert.equal(q.quarantined, true)
    assert.equal(q.reason, 'AMBIGUOUS_HISTORY')
  })

  it('legacy ledger: image in publishedVideos only, with undatable publishedAt → fail closed', () => {
    const file = path.join(tmpDir, 'reg.json')
    // Legacy/partial-migration shape: no permanent images index entry, but the
    // video composition summary references the final image with a corrupt date.
    fs.writeFileSync(file, JSON.stringify({
      images: {},
      scripts: {},
      music: {},
      thumbnails: {},
      publishedVideos: [{ videoId: 'v-legacy', imageHashes: ['img-legacy'], publishedAt: 'yesterday-ish' }],
      reservations: {},
    }))
    const reg = new AssetRegistry({ filePath: file })
    const q = reg.isImageQuarantined('img-legacy', { now: new Date('2026-09-12T12:00:00.000Z') })
    assert.equal(q.unknown, true)
    assert.equal(q.quarantined, true)
    assert.equal(q.reason, 'AMBIGUOUS_HISTORY')
  })
})

describe('R2 — checkpoint/resume cannot bypass quarantine', () => {
  it('quarantine persists across registry reloads (simulated crash/resume)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-resume-'))
    try {
      const file = path.join(tmpDir, 'reg.json')
      const NOW = new Date('2026-09-12T12:00:00.000Z')

      // Run 1: video V1 commits final image img-X.
      const reg1 = new AssetRegistry({ filePath: file })
      reg1.recordPublishedVideo('v1', { imageHashes: ['img-X'], now: NOW })

      // "Crash". Run 2 = a resumed/restarted pipeline reads the SAME ledger —
      // it cannot treat img-X as fresh.
      const reg2 = new AssetRegistry({ filePath: file })
      assert.equal(reg2.isImageQuarantined('img-X', { now: NOW }).quarantined, true)

      // A checkpoint restored production job revalidating with img-X is blocked.
      const gate = new GlobalAssetUniquenessGate(reg2, null)
      return gate.validate(buildManifest(['img-X'], { jobId: 'job-resumed' }), { jobId: 'job-resumed' })
        .then(r => {
          assert.equal(r.pass, false)
        })
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('R2 — perceptual near-twin (re-encoded / canonical duplicate) within 7 days', () => {
  let tmpDir, db, reg, checker

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-twin-'))
    db = new ImageDatabase(path.join(tmpDir, 'idx.db'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    checker = new SceneAssetUniqueness(reg, db)
  })
  afterEach(() => {
    try { db.close() } catch { /* ok */ }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects a scene final image that is a near-twin of an asset used within 7 days', () => {
    // Existing committed asset (re-encoded variant A): dHash all-zeros, used 1 day ago.
    const dHashA = '0000000000000000'
    db.upsert({ sha256: 'sha-variant-A', dHash: dHashA, pHash: '', url: 'https://cdn/reencoded-a.jpg', tags: [], quality: 1 })
    db.recordUsage('sha-variant-A', { videoId: 'v-recent', sceneIndex: 0 })
    db.db.prepare(`UPDATE usage SET used_at = datetime('now', '-1 day') WHERE sha256 = 'sha-variant-A'`).run()

    // New final image B: same photo, re-encoded → different sha256, dHash distance 1.
    const dHashB = '0000000000000001'
    assert.equal(dHashDistance(dHashB, dHashA), 1)
    db.upsert({ sha256: 'sha-candidate-B', dHash: dHashB, pHash: '', url: 'https://cdn/reencoded-b.jpg', tags: [], quality: 1 })

    // Direct near-twin query finds the committed twin inside the 7-day window.
    const twin = db.nearTwinUsedWithinDays({ sha256: 'sha-candidate-B', dHash: dHashB }, 7)
    assert.ok(twin, 'near-twin must be detected')
    assert.equal(twin.sha256, 'sha-variant-A')

    // Boundary validation of the scene blocks it (re-encoded ≠ fresh).
    const r = checker.validate([{ sceneIndex: 0, imageHash: 'sha-candidate-B' }])
    assert.equal(r.pass, false)
    assert.match(r.violations[0].reason, /IMAGE_NEAR_TWIN_7D/)
  })

  it('does NOT reject a near-twin when the twin was used more than 7 days ago', () => {
    const dHashA = '0000000000000000'
    db.upsert({ sha256: 'sha-old-A', dHash: dHashA, pHash: '', url: 'https://cdn/old.jpg', tags: [], quality: 1 })
    db.recordUsage('sha-old-A', { videoId: 'v-old', sceneIndex: 0 })
    db.db.prepare(`UPDATE usage SET used_at = datetime('now', '-12 day') WHERE sha256 = 'sha-old-A'`).run()
    db.db.prepare(`UPDATE images SET last_used = datetime('now', '-12 day') WHERE sha256 = 'sha-old-A'`).run()

    const dHashB = '0000000000000001'
    db.upsert({ sha256: 'sha-fresh-B', dHash: dHashB, pHash: '', url: 'https://cdn/fresh.jpg', tags: [], quality: 1 })

    assert.equal(db.nearTwinUsedWithinDays({ sha256: 'sha-fresh-B', dHash: dHashB }, 7), null)
    const r = checker.validate([{ sceneIndex: 0, imageHash: 'sha-fresh-B' }])
    assert.equal(r.pass, true)
  })
})

describe('R2 — full acceptance across a production registry', () => {
  it('new video final images are disjoint from the previous-7-day set and all unique', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-accept-'))
    try {
      const file = path.join(tmpDir, 'reg.json')
      const NOW = new Date('2026-09-12T12:00:00.000Z')
      const reg = new AssetRegistry({ filePath: file })

      // Previous 7-day committed final images (across ~3 videos).
      reg.recordPublishedVideo('prev-1', { imageHashes: ['p-A', 'p-B'], now: new Date(NOW.getTime() - 2 * HOUR) })
      reg.recordPublishedVideo('prev-2', { imageHashes: ['p-C'], now: new Date(NOW.getTime() - 3 * DAY) })
      reg.recordPublishedVideo('prev-3', { imageHashes: ['p-D', 'p-E'], now: new Date(NOW.getTime() - 6 * DAY) })

      // New video: 6 unique final images, none in the previous set.
      const current = ['n-1', 'n-2', 'n-3', 'n-4', 'n-5', 'n-6']
      const gate = new GlobalAssetUniquenessGate(reg, null)
      const manifest = buildManifest(current, { jobId: 'job-new' })
      const r = await gate.validate(manifest, { jobId: 'job-new' })
      assert.equal(r.pass, true)

      // Acceptance assertions.
      const { images: previous7d, unknown } = reg.recentCommittedImages({ now: NOW })
      assert.equal(unknown, false)
      const overlap = current.filter(h => previous7d.includes(h))
      assert.deepEqual(overlap, [], `currentVideoFinalImages ∩ previous7DayFinalImages must be empty, got ${overlap}`)
      assert.equal(new Set(current).size, 6)
      assert.equal(new Set(current).size, manifest.scenes.length)

      // Committing the new video adds its final images to the ledger and the
      // quarantine set (rolling expiration).
      assert.equal(gate.reserve('job-new', { imageHashes: current }).reserved, true)
      gate.commit('job-new', { videoId: 'v-new', category: 'technology', now: NOW })
      const after = reg.recentCommittedImages({ now: NOW }).images
      for (const h of current) assert.ok(after.includes(h), `committed ${h} must enter the quarantine set`)
      assert.ok(after.includes('p-A') && after.includes('p-E'), 'previous images remain quarantined')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})