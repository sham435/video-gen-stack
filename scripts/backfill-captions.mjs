// backfill-captions.mjs — upload KEPT caption sidecars for already-published
// localized videos (Task-131 sweep). Idempotent: re-runs are no-ops when the
// track already exists (local state store + remote captions.list + 409
// backstop). Never re-uploads the video itself; failures are non-fatal and
// recorded in data/captions-state.json at videoId|language granularity.
//
// Usage:
//   node scripts/backfill-captions.mjs                       # all tracked target pairs
//   node scripts/backfill-captions.mjs --video ID --language ta --srt output-ta/captions.srt [--name NAME] [--force-verify]
//
// Tracking (Task-130 verified artifacts):
//   SI  y9PnwMVyA7U  ← output-si/captions.srt  (32.876s sidecar @ 36.5s video)
//   TA  SVzHQ6UtFBs  ← output-ta/captions.srt  (39.972s sidecar @ 42.7s video)
import 'dotenv/config'
import fs from 'node:fs'
import { publishCaptionTrack } from '../src/publishing/CaptionTrackPublisher.mjs'

const BACKFILL_TARGETS = [
  { videoId: 'y9PnwMVyA7U', language: 'si', name: 'සිංහල', srtPath: 'output-si/captions.srt' },
  { videoId: 'SVzHQ6UtFBs', language: 'ta', name: 'தமிழ்', srtPath: 'output-ta/captions.srt' },
]

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--video') args.videoId = argv[++i]
    else if (argv[i] === '--language') args.language = argv[++i]
    else if (argv[i] === '--srt') args.srtPath = argv[++i]
    else if (argv[i] === '--name') args.name = argv[++i]
    else if (argv[i] === '--force-verify') args.forceRemoteCheck = true
  }
  return args
}

const cli = parseArgs(process.argv.slice(2))
let targets = BACKFILL_TARGETS
if (cli.videoId || cli.srtPath) targets = [{ ...cli }]

console.log(`[BACKFILL-CAPTIONS] ${targets.length} target(s)`)
for (const t of targets) {
  const exists = t.srtPath && fs.existsSync(t.srtPath)
  if (!exists) {
    console.log(`[BACKFILL-CAPTIONS] sidecar missing language=${t.language || 'n/a'} srt=${t.srtPath || '(none)'} — skipping`)
  }
}

const results = []
for (const t of targets) {
  if (!t.srtPath || !fs.existsSync(t.srtPath)) {
    results.push({ ...t, status: 'skipped', reason: 'NO_SIDECAR' })
    continue
  }
  const r = await publishCaptionTrack({
    videoId: t.videoId,
    srtPath: t.srtPath,
    language: t.language,
    name: t.name,
    // Backfill ALWAYS consults remote truth so a fresh clone / wiped store
    // cannot double-insert a track that already exists on the channel.
    forceRemoteCheck: cli.forceRemoteCheck === true,
  })
  results.push({ videoId: t.videoId, language: t.language, srtPath: t.srtPath, ...r })
}

console.log('[BACKFILL-CAPTIONS] summary:')
for (const r of results) {
  console.log(`  ${r.videoId || '(none)'} ${r.language || '(none)'} → ${r.status}${r.trackId ? ` trackId=${r.trackId}` : ''}${r.reason ? ` (${r.reason})` : ''}${r.error ? ` error=${r.error}` : ''}${r.attempts ? ` attempts=${r.attempts}` : ''}`)
}
// Exit code stays 0 unless EVERY target hard-failed — partial success is a
// normal operational outcome for a sweep and the operator re-runs idempotently.
const hardFailures = results.filter((r) => r.status === 'failed').length
if (hardFailures === results.length && hardFailures > 0) process.exitCode = 1
