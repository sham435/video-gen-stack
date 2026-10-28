/**
 * localization-guarantees.test.mjs — HEADLESS end-to-end guarantee suite for
 * the 6-stage LocalizationPipeline (NEWS-MONSTER core).
 *
 * These tests execute the REAL pipeline (SourceIngest → Translator →
 * TimingAdapter/ffmpeg → SubtitleExporter → gates → publish manifest) with:
 *   - translation caches seeded deterministically (no provider billing)
 *   - per-scene speech synthesized as real PCM WAV files (TimingAdapter
 *     mixes them through ffmpeg — no TTS provider required)
 * so every guarantee is validated against ARTIFACTS on disk, not mocks.
 *
 * Guarantee → test map:
 *   A  translations non-empty, native script, numbers preserved (ta, si)
 *   B  dedup: distinct script passes the across-video ledger gate; genuine
 *      duplicates rejected within video AND across videos; same-job re-runs
 *      self-excluded (idempotent retry)
 *   C  timing adaptation: windows cover speech, subtitles sync, REAL mixed
 *      narration track (ffprobe evidence) + alignment gate evidence
 *   D  per-locale isolation: failed/blocked locale never touches another
 *   D2 subtitle-export failure blocks its locale loudly (no swallow)
 *   E  publish contract: missing localized sidecars block finalize; stored
 *      videoPath surfaces; EN passthrough exempt
 *   F  editorial review gate: a pending item blocks ONLY its locale
 *   G  resume integrity: a completed locale resumes publishable, no re-work
 *   H  streaming: pushSegment localizes an arrived segment (cache-first)
 *   T  font gates — vendored fonts cover actual content; tofu refused
 *   U  realtime cross-locale pair (si source → ta target), sl/tl pinning
 *   V  provider config: gemini thinking disabled by default (realtime tier)
 *   W  translation purity gate: script-salad rejected, Latin brands exempt
 *
 * Runs fully offline in a temp cwd: pipeline state (production/localization),
 * translation caches (data/translations) and reviews all land under ROOT.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-guarantees-'))
process.chdir(ROOT)

import { LocalizationPipeline, PipelineBlocked, pipelineStatus } from '../src/localize/LocalizationPipeline.mjs'
import * as ReviewStore from '../src/localize/ReviewStore.mjs'
import { ScriptUniqueness } from '../src/uniqueness/ScriptUniqueness.mjs'
import { LANGUAGES } from '../src/i18n/languages.mjs'

// ── Fixture: translation seeds (deterministic, provider-free) ──────────────
const TA_SRC = [
  'The Central Bank raised rates by 4 percent today.',
  'Exports climbed to a record 1.2 billion rupees.',
  'Rainfall improved crop yields across the north.',
  'Subscribe to News Monster for daily briefings.',
]
const TA_OUT = [
  'மத்திய வங்கி இன்று வட்டி விகிதத்தை 4 சதவீதமாக உயர்த்தியது.',
  'ஏற்றுமதி 1.2 பில்லியன் ரூபாய் சாதனை அளவிற்கு உயர்ந்தது.',
  'வடக்கில் மழைப்பொழிவு பயிர் விளைச்சலை மேம்படுத்தியது.',
  'தினசரி தொகுப்புகளுக்கு News Monster-ை பின்தொடருங்கள்.',
]
const SI_SRC = [
  'The Central Bank raised rates by 4 percent today.',
  'Exports climbed to a record 1.2 billion rupees.',
  'Rainfall improved crop yields across the north.',
  'Subscribe to News Monster for daily briefings.',
]
const SI_OUT = [
  'මහ බැංකුව අද පොලී වැඩි කළේ 4 ප්‍රතිශතයකිනි.',
  'අපන්යේෂණ 1.2 බිලියන රුපියල් සාධනයක් නිර්මාණය කළේය.',
  'උතුරේ වර්ෂාව බෝග අස්වැන්න දියුණු කළේය.',
  'දෛනික පුවත් සාරාංශ සඳහා News Monster වෙත දායක වන්න.',
]
// Joined exactly like the ledger path does (ScenePlanner.buildNarrationScript join).
const TA_JOINED = TA_OUT.join('. ')

const shaKey = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 32) // Translator.key parity
const seedCache = (lang, pairs) => {
  const file = path.join('data', 'translations', `${lang}.json`)
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* fresh */ }
  for (const [src, out] of pairs) cache[shaKey(src)] = out
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cache, null, 2))
}
seedCache('ta', TA_SRC.map((s, i) => [s, TA_OUT[i]]))
seedCache('si', SI_SRC.map((s, i) => [s, SI_OUT[i]]))

// ── Fixture: timed plan (seconds; SHORT windows force real stretching) ──────
const plan = (srcs) =>
  srcs.map((narration, i) => ({
    type: i === 0 ? 'hook' : i === srcs.length - 1 ? 'close' : 'fact',
    start: i * 0.8,
    end: i * 0.8 + 0.8,
    narration,
    text: `${i}`,
    caption: i === 0 ? 'HEADLINE' : 'CONTENT',
  }))

// ── Fixture: real speech chunks (PCM WAV; ffprobe-measured by TimingAdapter).
// Duration varies per text hash (0.9–1.4s) so windows must stretch (plan 0.8s).
const makeWavChunk = async (text, chunkPath) => {
  const rate = 44100
  const h = crypto.createHash('sha256').update(String(text)).digest()
  const durSec = 0.9 + (h[0] % 6) / 10
  const n = Math.round(rate * durSec)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const v = Math.sin(2 * Math.PI * 440 * t) * 0.25 + Math.sin(2 * Math.PI * 660 * t) * 0.1
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  fs.writeFileSync(chunkPath, buf)
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const scriptRegion = (lang) => (lang === 'ta' ? /[\u0B80-\u0BFF]/ : lang === 'si' ? /[\u0D80-\u0DFF]/ : /./)
const srtStamps = (srt) =>
  Array.from(srt.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g), (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000)
const makeRegistry = () => ({
  _corrupt: false,
  state: { scripts: {}, publishedVideos: [], reservations: {} },
  recordScript(hash, ctx) { this.state.scripts[hash] = { ...ctx, hash } },
  _save() {},
})
const recordPast = (registry, text, ctx) => new ScriptUniqueness(registry).record(text, ctx)
const ffprobeDur = (p) =>
  parseFloat(String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', p], { stdio: ['ignore', 'pipe', 'ignore'] }))) || 0
const stateFile = (jobId, lang) => path.join('production', 'localization', jobId, `${lang}.json`)
const outFiles = (dir) => {
  const acc = []
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : acc.push(e.name)))
  try { walk(dir) } catch { return [] }
  return acc
}

test('A: localized translations are non-empty, native-script, number-faithful (ta, si)', async () => {
  for (const lang of ['ta', 'si']) {
    const p = new LocalizationPipeline({ jobId: `g-a-${lang}`, lang, outDir: path.join(ROOT, `g-a-${lang}`) })
    await p.ingest({ timedScenes: plan(lang === 'ta' ? TA_SRC : SI_SRC), title: 'Guarantee A' })
    const r = await p.translate()
    assert.equal(r.stats.fresh, 0, 'offline by construction: zero fresh provider calls')
    assert.equal(p.state.translations.length, 4)
    for (const s of p.state.translations) {
      assert.ok((s.text || '').trim().length > 8, `${lang}: non-empty meaningful text`)
      assert.ok(scriptRegion(lang).test(s.text), `${lang}: native script preserved (${String(s.text).slice(0, 30)})`)
    }
    // Numbers survive translation (fidelity is a publish contract, not hope)
    assert.ok(p.state.translations[0].text.includes('4'), `${lang}: number 4 preserved`)
    assert.ok(p.state.translations[1].text.includes('1.2'), `${lang}: number 1.2 preserved`)
    assert.equal(p.state.stage, 3)
  }
})

test('B: across-video ledger gate passes distinct scripts; rejects genuine duplicates', async () => {
  // B0 — unrelated ledger content must NOT block a distinct localized script
  const regDistinct = makeRegistry()
  recordPast(regDistinct, 'The monsoon trough shifted north overnight, bringing heavy rain warnings to the northern province.', { jobId: 'past-en', videoId: 'vid-en', title: 'Past EN' })
  const pDistinct = new LocalizationPipeline({ jobId: 'g-b0', lang: 'ta', outDir: path.join(ROOT, 'g-b0'), registry: regDistinct })
  await pDistinct.ingest({ timedScenes: plan(TA_SRC), title: 'Guarantee B0' })
  await pDistinct.translate()
  const gates = await pDistinct.runGates()
  assert.equal(gates.gates.dedup.across.pass, true, 'distinct script passes the across-video ledger gate')
  assert.equal(gates.gates.dedup.within.pass, true)
  assert.equal(pDistinct.state.gates.dedup.across.pass, true)

  // B2 — genuine WITHIN-video duplicate (scene 2 repeats scene 1 verbatim)
  const dupSrc = [...TA_SRC]
  dupSrc[2] = TA_SRC[1]
  const pDup = new LocalizationPipeline({ jobId: 'g-b2', lang: 'ta', outDir: path.join(ROOT, 'g-b2'), registry: regDistinct })
  await pDup.ingest({ timedScenes: plan(dupSrc), title: 'Guarantee B2' })
  await pDup.translate()
  let blockedWithin = null
  try { await pDup.runGates() } catch (e) { blockedWithin = e }
  assert.ok(blockedWithin instanceof PipelineBlocked, 'within-video duplicate must block')
  assert.match(blockedWithin.message, /duplicate narration/)
  assert.ok(!/across video/.test(blockedWithin.message), 'within-video reason must be distinct from across-video')
  assert.equal(pDup.state.status, 'failed_dedup')

  // B3 — ACROSS-video duplicate: a past video's localized script must block.
  // The ledger record carries the PAST video's jobId, so this new job matches.
  const regPast = makeRegistry()
  recordPast(regPast, TA_JOINED, { jobId: 'past-ta-video', videoId: 'vid-past-ta', title: 'தமிழ் past' })
  const pReuse = new LocalizationPipeline({ jobId: 'g-b3', lang: 'ta', outDir: path.join(ROOT, 'g-b3'), registry: regPast })
  await pReuse.ingest({ timedScenes: plan(TA_SRC), title: 'Guarantee B3' })
  await pReuse.translate()
  let blockedAcross = null
  try { await pReuse.runGates() } catch (e) { blockedAcross = e }
  assert.ok(blockedAcross instanceof PipelineBlocked, 'across-video reused script must block')
  assert.match(blockedAcross.message, /duplicate narration \(across video\)/)
  assert.ok(pReuse.state.errors.some((x) => /across-video dedup/.test(x)), 'failure recorded on THIS locale only')
  assert.equal(pReuse.publishable(), false)

  // B4 — idempotent same-job retry: a ledger entry whose jobId matches THIS
  // pipeline's jobId is self-excluded by ScriptUniqueness./localize runs.
  const regSelf = makeRegistry()
  recordPast(regSelf, TA_JOINED, { jobId: 'g-b4', videoId: 'vid-b4', title: 'same job' })
  const pSame = new LocalizationPipeline({ jobId: 'g-b4', lang: 'ta', outDir: path.join(ROOT, 'g-b4'), registry: regSelf })
  await pSame.ingest({ timedScenes: plan(TA_SRC), title: 'Guarantee B4' })
  await pSame.translate()
  const g = await pSame.runGates() // must NOT throw
  assert.equal(g.gates.dedup.across.pass, true, 'same-job rerun is self-excluded (idempotent retry)')
  assert.equal(pSame.publishable() === false && pSame.state.stage >= 5, true, 'gates passed (stage 5)')
})

test('C: adapted timing covers speech; subtitles stay in sync; narration track is REAL audio', async () => {
  const PLAN_C = plan(TA_SRC)
  const p = new LocalizationPipeline({ jobId: 'g-c', lang: 'ta', outDir: path.join(ROOT, 'g-c'), makeChunk: makeWavChunk })
  await p.ingest({ timedScenes: PLAN_C, title: 'Guarantee C', videoPath: 'output-ta/final.mp4' })
  await p.translate()
  const r = await p.localizeNarration({ videoPath: 'output-ta/final.mp4' })
  const timings = r.timings

  // Every window IDENTIFIES with its own speech (audioStart anchors window)
  assert.equal(timings.chunks.length, 4)
  for (const c of timings.chunks) {
    const sc = timings.scenes[c.sceneIndex]
    assert.ok(sc, `scene ${c.sceneIndex} exists`)
    assert.ok(Math.abs(sc.start - c.audioStart) < 0.05, `window owns its audio start (${sc.start} vs ${c.audioStart})`)
    assert.ok(sc.end - sc.start >= c.duration - 0.05, `window ${sc.start}..${sc.end} covers speech ${c.duration}s`)
  }
  // ADAPTATION happened: short 0.8s plan windows stretched by real speech
  const planEnd = PLAN_C[PLAN_C.length - 1].end
  assert.ok(timings.totalDuration > planEnd + 0.4, `total ${timings.totalDuration}s exceeds plan tail (adaptation, not passthrough)`)
  // Alignment gate evidence (stage 5) recorded on state — plus the new FONT gate
  assert.equal(p.state.gates.alignment.ok, true)
  assert.ok(p.state.gates.alignment.maxDrift <= 0.6, 'caption/speech drift within tolerance')
  assert.equal(p.state.gates.fonts.pass, true, 'font preflight + content-coverage gate passed')
  // REAL audio: mixed narration track exists with measured duration ≈ adapted total
  assert.ok(timings.audioPath && fs.existsSync(timings.audioPath) && fs.statSync(timings.audioPath).size > 5000, 'narration.mp3 rendered by ffmpeg')
  const dur = ffprobeDur(timings.audioPath)
  assert.ok(Math.abs(dur - timings.totalDuration) < 0.75, `narration duration ${dur}s ≈ adapted total ${timings.totalDuration}s`)
  // Subtitle sidecars exist, parse, and lead clip starts with first chunk
  const subs = p.state.subtitles
  assert.ok(fs.existsSync(subs.srtPath) && fs.existsSync(subs.vttPath), 'SRT + VTT sidecars exist')
  const srt = fs.readFileSync(subs.srtPath, 'utf8')
  const vtt = fs.readFileSync(subs.vttPath, 'utf8')
  assert.ok(vtt.startsWith('WEBVTT'), 'VTT header present')
  const stamps = srtStamps(srt)
  assert.ok(stamps.length >= 8, `SRT parses with stamps (${stamps.length})`)
  assert.ok(Math.abs(stamps[0] - timings.chunks[0].audioStart) < 0.1, 'first caption starts with the first speech chunk')
  assert.ok(scriptRegion('ta').test(srt), 'subtitles carry the Tamil script')
  // Stored videoPath (stage-4 contract) is what finalize will publish
  assert.equal(timings.videoPath, 'output-ta/final.mp4')
  assert.equal(p.state.stage, 4)
  assert.equal(p.state.status, 'narrated')
})

test('D: per-locale isolation — a blocked locale never corrupts another locale', async () => {
  const jobId = 'iso-job'
  const reg = makeRegistry()
  recordPast(reg, 'Unrelated EN master narration from a previous broadcast about weather systems.', { jobId: 'past-en', videoId: 'vid-en', title: 'Past EN' })
  // TA completes first (full 6 stages)
  const pTa = new LocalizationPipeline({ jobId, lang: 'ta', outDir: path.join(ROOT, 'iso-ta'), registry: reg, makeChunk: makeWavChunk })
  await pTa.run({ timedScenes: plan(TA_SRC), title: 'Isolation probe', videoPath: 'output-ta/final.mp4' })
  assert.ok(pTa.publishable(), 'TA must be publishable')
  // happy-path localized publish carries full locale metadata
  assert.match(pTa.state.publish.title, /தமிழ்/)
  assert.deepEqual(pTa.state.publish.hashtags, ['#தமிழ்Trending'])
  assert.equal(pTa.state.publish.metadata.language, 'ta')
  assert.equal(pTa.state.publish.videoPath, 'output-ta/final.mp4')
  assert.ok(fs.existsSync(pTa.state.publish.subtitles.srt) && fs.existsSync(pTa.state.publish.subtitles.vtt), 'publish carries EXISTING caption files')
  assert.ok(fs.existsSync(pTa.state.publish.narration), 'publish carries the localized narration track')
  const taStateBefore = fs.readFileSync(stateFile(jobId, 'ta'), 'utf8')

  // SI voice provider dies mid-pipeline
  const pSi = new LocalizationPipeline({
    jobId, lang: 'si', outDir: path.join(ROOT, 'iso-si'),
    makeChunk: async () => { throw new Error('voice provider down') },
  })
  await pSi.ingest({ timedScenes: plan(SI_SRC), title: 'Isolation probe' })
  await pSi.translate()
  let blocked = null
  try { await pSi.localizeNarration({ videoPath: 'output-si/final.mp4' }) } catch (e) { blocked = e }
  assert.ok(blocked instanceof PipelineBlocked, 'SI voice failure must block SI only')
  assert.equal(pSi.state.status, 'failed_voice')
  const siState = JSON.parse(fs.readFileSync(stateFile(jobId, 'si'), 'utf8'))
  assert.ok(siState.errors.some((x) => /voice provider down/.test(x)), 'failure recorded in SI state file')

  // TA state file is byte-identical after the SI failure
  assert.equal(fs.readFileSync(stateFile(jobId, 'ta'), 'utf8'), taStateBefore, 'SI failure must not touch TA state')
  const st = pipelineStatus(jobId)
  assert.equal(st.ta.publishable, true)
  assert.equal(st.si.publishable, false)
})

test('D2: subtitle-export failure blocks THIS locale loudly (not swallowed)', async () => {
  const outDir = path.join(ROOT, 'g-d2')
  fs.rmSync(path.join(outDir, 'subtitles.srt'), { force: true, recursive: true })
  fs.mkdirSync(path.join(outDir, 'subtitles.srt'), { recursive: true }) // sabotage: SRT path is a DIRECTORY
  const p = new LocalizationPipeline({ jobId: 'g-d2', lang: 'ta', outDir, makeChunk: makeWavChunk })
  await p.ingest({ timedScenes: plan(TA_SRC), title: 'Guarantee D2' })
  await p.translate()
  let blocked = null
  try { await p.localizeNarration({ videoPath: null }) } catch (e) { blocked = e }
  assert.ok(blocked instanceof PipelineBlocked, 'export failure must block the locale')
  assert.equal(blocked.stage, 4)
  assert.match(blocked.message, /subtitle export failed/)
  assert.equal(p.state.status, 'failed_subtitles')
  assert.equal(p.publishable(), false, 'a failed locale is never publishable')
})

test('E: publish contract — missing localized sidecars block finalize; stored videoPath surfaces; passthrough exempt', async () => {
  // E2 — videoPath persisted at stage 4 surfaces in publish manifest (no-arg finalize)
  const pSi = new LocalizationPipeline({ jobId: 'g-e-fix3', lang: 'si', outDir: path.join(ROOT, 'g-e-fix3'), makeChunk: makeWavChunk })
  await pSi.ingest({ timedScenes: plan(SI_SRC), title: 'Guarantee E2', videoPath: 'output-si/final.mp4' })
  await pSi.translate()
  await pSi.localizeNarration({ videoPath: 'output-si/final.mp4' })
  await pSi.runGates()
  const fin = await pSi.finalizePublish() // NO args → must use stored timings.videoPath
  assert.equal(fin.publish.videoPath, 'output-si/final.mp4', 'timings.videoPath fallback must work')
  assert.ok(pSi.publishable())

  // E3 — a translate locale WITHOUT its SRT sidecar is NOT complete
  const outDir = path.join(ROOT, 'g-e-neg')
  fs.rmSync(path.join(outDir, 'subtitles.srt'), { force: true, recursive: true })
  const pNeg = new LocalizationPipeline({ jobId: 'g-e-neg', lang: 'ta', outDir, makeChunk: makeWavChunk })
  await pNeg.ingest({ timedScenes: plan(TA_SRC), title: 'Guarantee E3' })
  await pNeg.translate()
  await pNeg.localizeNarration({ videoPath: 'output-ta/final.mp4' })
  fs.rmSync(pNeg.state.subtitles.srtPath) // delete the contract artifact
  await pNeg.runGates()
  let blocked = null
  try { await pNeg.finalizePublish({ videoPath: 'output-ta/final.mp4' }) } catch (e) { blocked = e }
  assert.ok(blocked instanceof PipelineBlocked, 'missing localized captions must block finalize')
  assert.equal(blocked.stage, 6)
  assert.match(blocked.message, /localized captions missing/)
  assert.equal(pNeg.state.status, 'publish_blocked')
  assert.equal(pNeg.publishable(), false)

  // E4 — EN passthrough (translate:false) has no sidecars BY DESIGN → exempt
  const pEn = new LocalizationPipeline({ jobId: 'g-e-pass', lang: 'en', outDir: path.join(ROOT, 'g-e-pass') })
  await pEn.run({ timedScenes: plan(TA_SRC), title: 'EN master', videoPath: 'output/final.mp4' })
  assert.ok(pEn.publishable(), 'passthrough locale publishes without caption sidecars')
  assert.equal(pEn.state.publish.subtitles, null)
  assert.equal(pEn.state.publish.videoPath, 'output/final.mp4')
  assert.match(pEn.state.publish.title, /English/)
})

test('F: editorial review gate — a pending item blocks ONLY its locale', async () => {
  process.env.TRANSLATION_REVIEW = '1'
  try {
    const p = new LocalizationPipeline({ jobId: 'g-f', lang: 'si', outDir: path.join(ROOT, 'g-f') })
    await p.ingest({ timedScenes: plan(SI_SRC), title: 'Guarantee F' })
    await p.translate()
    const first = p.state.translations[0]
    ReviewStore.flag('si', { sourceText: first.source, translation: first.text, issues: ['uncertain:name'], segment: { index: first.index } })
    let blocked = null
    try { await p.runGates() } catch (e) { blocked = e }
    assert.ok(blocked instanceof PipelineBlocked, 'pending review must block this locale')
    assert.match(blocked.message, /editorial review pending/)
    assert.equal(p.state.status, 'pending_review')
    assert.equal(p.publishable(), false)
    // even finalize cannot resurrect a pending-review locale
    let finErr = null
    try { await p.finalizePublish() } catch (e) { finErr = e }
    assert.ok(finErr instanceof PipelineBlocked)
    assert.equal(pipelineStatus('g-f').si.publishable, false)
  } finally {
    delete process.env.TRANSLATION_REVIEW
  }
})

test('G: resume integrity — completed locale resumes publishable, zero artifact re-work', async () => {
  const outDir = path.join(ROOT, 'iso-ta')
  const before = outFiles(outDir).length
  const p2 = new LocalizationPipeline({ jobId: 'iso-job', lang: 'ta', outDir, makeChunk: makeWavChunk })
  const st0 = p2.resume()
  assert.ok(st0.stage >= 4, 'resume restores the completed stage')
  await p2.translate()
  const loc = await p2.localizeNarration()
  assert.equal(loc.skipped, true, 'stage-3/4 artifacts verified, not re-rendered')
  // finalize short-circuits on the retained publish manifest (no re-pay)
  const fin = await p2.finalizePublish()
  assert.equal(fin.skipped, true, 'stage 6 complete → publish manifest retained')
  assert.equal(fin.publish.videoPath, 'output-ta/final.mp4', 'retained manifest carries videoPath')
  assert.match(fin.publish.title, /தமிழ்/)
  assert.ok(p2.publishable(), 'still publishable after resume')
  assert.equal(outFiles(outDir).length, before, 'resume does not re-render or add artifacts')
})

test('H: streaming pushSegment localizes an arrived segment (cache-first, one call)', async () => {
  const p = new LocalizationPipeline({ jobId: 'g-h', lang: 'ta', outDir: path.join(ROOT, 'g-h') })
  await p.ingest({ timedScenes: plan(TA_SRC), title: 'Guarantee H' })
  await p.translate()
  const streamed = await p.pushSegment({ index: 99, start: 3.2, end: 5.0, source: TA_SRC[3] })
  assert.ok(streamed && scriptRegion('ta').test(streamed.text), 'pushed segment localized in-script')
  assert.ok(p.state.translations.some((s) => s.index === 99), 'streamed segment recorded in locale state')
})

test('T: font gates — vendored fonts cover the ACTUAL content; tofu content refused', async () => {
  // REAL vendored fonts, REAL HarfBuzz shaping (offline): ta + si packs must
  // pass category/canvas/canary checks with zero .notdef.
  const { assertLanguageFonts, assertContentCovers } = await import('../src/i18n/FontPreflight.mjs')
  const taReport = await assertLanguageFonts(LANGUAGES.ta)
  assert.equal(taReport.ok, true, 'ta pack fonts parse + shape canary corpus + register on canvas')
  const siReport = await assertLanguageFonts(LANGUAGES.si)
  assert.equal(siReport.ok, true, 'si pack fonts parse + shape canary corpus + register on canvas')

  // CONTENT coverage (the operator's no-tofu requirement): the actual seeded
  // translations — including Tamil-with-Latin-brand ("News Monster") — must
  // shape with ZERO .notdef through the same shaper the renderer uses.
  const taCovered = await assertContentCovers(LANGUAGES.ta, TA_OUT, { label: 'test ta content' })
  assert.equal(taCovered.ok, true)
  const siCovered = await assertContentCovers(LANGUAGES.si, SI_OUT, { label: 'test si content' })
  assert.equal(siCovered.ok, true, 'si content incl. Latin "News Monster" covered (Noto Sans Sinhala carries Latin per canary-verified fact)')

  // NEGATIVE: a codepoint Noto Sans Tamil cannot draw must be REFUSED loudly,
  // with the offending codepoint named in the error.
  let tofuErr = null
  try { await assertContentCovers(LANGUAGES.ta, ['சரி 字 வார்த்தை'], { label: 'tofu probe' }) } catch (e) { tofuErr = e }
  assert.ok(tofuErr, 'content with an uncovered glyph must be refused')
  assert.match(tofuErr.message, /RENDER_PREFLIGHT_FAILED/)
  assert.match(tofuErr.message, /5B57/, "names the offending codepoint U+5B57 '字'")

  // RENDER BACKSTOP: even if tofu content somehow reaches the draw path,
  // drawShaped REFUSES to draw boxes (hard stop, not a console.warn).
  const { drawShaped, setRenderLanguage } = await import('../src/i18n/ShapedText.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  setRenderLanguage(LANGUAGES.ta)
  try {
    const ctx = createCanvas(64, 64).getContext('2d')
    await assert.rejects(
      () => drawShaped(ctx, 'க 字', 10, 20, { fontFile: LANGUAGES.ta.fontFiles, size: 24, weight: 400 }),
      (e) => /SHAPED_TOFU/.test(e.message),
      'draw must refuse tofu instead of painting boxes into the video'
    )
  } finally {
    setRenderLanguage(null)
  }

  // END-TO-END: a translation carrying uncovered content must BLOCK its locale
  // at stage 4 BEFORE any speech/render cost (no tofu reaches a video).
  seedCache('ta', [['Uncovered glyph tends to appear in exotic sources.', 'வெளிப்படை 字 மொழிபெயர்ப்பு.']])
  const pTofu = new LocalizationPipeline({ jobId: 'g-t-tofu', lang: 'ta', outDir: path.join(ROOT, 'g-t-tofu'), makeChunk: makeWavChunk })
  await pTofu.ingest({ timedScenes: plan(['Uncovered glyph tends to appear in exotic sources.', ...TA_SRC.slice(1)]), title: 'Font gate' })
  await pTofu.translate()
  let blocked = null
  try { await pTofu.localizeNarration({ videoPath: null }) } catch (e) { blocked = e }
  assert.ok(blocked instanceof PipelineBlocked, 'tofu content must block the locale')
  assert.equal(blocked.stage, 4)
  assert.match(blocked.message, /font preflight failed/)
  assert.equal(pTofu.state.status, 'failed_fonts')
  assert.ok(pTofu.state.gates.fonts === undefined || pTofu.state.gates.fonts.pass !== true, 'font gate did not pass for tofu content')
})

test('U: realtime cross-locale pair (si source → ta target) via cache, Google-Translate pinning', async () => {
  // Seed a genuine si→ta pair in the TA target cache (Translator keys by
  // target lang+source text, so cross-pairs sharing a source are distinct).
  const si2taSrc = 'මෝසම් වැසි ගෝලීය සහල් අස්වැන්න අපේක්ෂාව ඉහළ නැංවීම'
  const si2taOut = 'பருவமழை மழை உலக அரிசி அறுவடை வாய்ப்பைக் கிறக்குகிறது, இலங்கையில் தயாரிப்பு அதிகரிக்கும் எனக் காட்டுகிறது.'
  seedCache('ta', [[si2taSrc, si2taOut]])
  const p = new LocalizationPipeline({ jobId: 'g-u-xpair', lang: 'ta', outDir: path.join(ROOT, 'g-u-xpair') })
  const t0 = process.hrtime.bigint()
  const streamed = await p.pushSegment({ index: 777, start: 0, end: 1, source: si2taSrc, sourceLang: 'si' })
  const dtMs = Number(process.hrtime.bigint() - t0) / 1e6
  assert.equal(streamed.text, si2taOut, 'cross-locale pair returned pinned (sl=→tl=) output')
  assert.ok(dtMs < 250, `streamed cross-locale segment localized in realtime (${dtMs.toFixed(2)}ms < 250ms)`)
})

test('V: gemini generation config — broadcast translation runs at the realtime tier (thinking off, token caps unified)', async () => {
  // NO NETWORK pin of the provider latency contract. Live A/B (2026-10-28):
  // a 2-line broadcast batch with default thinking measured 2532 total tokens
  // (2341 of them thoughts) in 12.2s; the identical shape at thinkingBudget:0
  // measured 72 tokens in 1.18s. Realtime speech windows cannot wait on a
  // reasoning pass nobody asked for.
  const { _internals } = await import('../src/i18n/Translator.mjs')
  const { fileURLToPath } = await import('node:url')
  const saved = {
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_THINKING: process.env.GEMINI_THINKING,
    I18N_MAX_TOKENS: process.env.I18N_MAX_TOKENS,
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  try {
    delete process.env.GEMINI_MODEL
    delete process.env.GEMINI_THINKING
    delete process.env.I18N_MAX_TOKENS
    const cfg = _internals.geminiGenerationConfig()
    assert.equal(cfg.temperature, 0)
    assert.equal(cfg.maxOutputTokens, 16000, 'I18N_MAX_TOKENS tier parity with the openai-compat paths')
    assert.equal(cfg.thinkingConfig?.thinkingBudget, 0, 'gemini-2.5+ must default to zero thinking')

    // Legacy models: do not send them the thinking field at all.
    process.env.GEMINI_MODEL = 'gemini-2.0-flash'
    assert.equal(_internals.geminiGenerationConfig().thinkingConfig, undefined, 'pre-2.5 models get no unknown field')

    // Operator opt-in restores the thinking pass.
    process.env.GEMINI_MODEL = 'gemini-2.5-flash'
    process.env.GEMINI_THINKING = '1'
    assert.equal(_internals.geminiGenerationConfig().thinkingConfig, undefined, 'GEMINI_THINKING=1 restores thinking')

    // BOTH call sites (UI-string batches AND context-aware segments) share the
    // helper — a src-level pin so a future path cannot silently regress.
    const src = fs.readFileSync(fileURLToPath(new URL('../src/i18n/Translator.mjs', import.meta.url)), 'utf8')
    const uses = (src.match(/generationConfig: geminiGenerationConfig\(\)/g) || []).length
    assert.equal(uses, 2, 'both gemini fetch sites must use the shared realtime config')
  } finally {
    restore()
  }
})

test('W: translation purity gate — script-salad output is rejected, brands stay Latin-exempt', async () => {
  // NO NETWORK pin of validateOutput's purity rule. Live origin (2026-10-28):
  // a real batch half-untranslated a Sinhala line and CONCATENATED the halves
  // — 30 Sinhala chars + 43 Tamil chars — which the presence-only gate
  // admitted and would have cached forever. Mesh purity is the contract.
  const { _internals } = await import('../src/i18n/Translator.mjs')
  const validate = (outs, lang = 'ta') =>
    _internals.validateOutput(outs.map((text) => ({ key: 'k', text: 'x' })), outs, lang)

  // THE exact poison measured live: must be rejected now.
  assert.equal(
    validate(['නව බදු ප්‍රතිපත්තිය කුඩා ව්‍යාපාරවලට லாபத்தை ஈட்டித்தரும் என எதிர்பார்க்கப்படுகிறது.']),
    false,
    'Sinhala glyphs inside Tamil copy = script salad = reject'
  )
  // Clean native output passes; Latin brand words stay exempt.
  assert.equal(validate(['மத்திய வங்கி இன்று வட்டி விகிதத்தை 4 சதவீதமாக உயர்த்தியது.']), true)
  assert.equal(validate(['தினசரி தொகுப்புகளுக்கு News Monster-ை பின்தொடருங்கள்.']), true, 'Latin brand exempt')
  // Symmetric direction: Tamil glyphs inside Sinhala copy must reject too.
  assert.equal(validate(['மத்திய வங்கி මහ බැංකුව අද පොලී වැඩි කළේ ප්‍රතිශතයකිනි.'], 'si'), false)
  assert.equal(validate(['මහ බැංකුව අද පොලී වැඩි කළේ 4 ප්‍රතිශතයකිනි.'], 'si'), true)
  // Pre-existing semantics preserved.
  assert.equal(validate(['Latin-only long sentence without target script.']), false, 'English-back rejection (pre-existing)')
  assert.equal(validate(['சரி']), true, 'short strings skip script checks (pre-existing)')
  assert.equal(
    _internals.validateOutput([{ key: 'k', text: 'x' }], ['முதல்', 'இரண்டு'], 'ta'),
    false,
    'array length must match items (pre-existing)'
  )
})
