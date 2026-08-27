#!/usr/bin/env node
/**
 * verify-recovery.mjs — Re-verify existing published videos after OAuth re-authorization.
 *
 * Does NOT republish. Reads ledger, finds entries with verificationState needing
 * recovery, runs YouTubePropagationVerifier + PostPublishVerifier, updates ledger.
 *
 * Usage:
 *   node scripts/verify-recovery.mjs                    # recover all pending entries
 *   node scripts/verify-recovery.mjs --video-id abc123  # recover single video
 *   node scripts/verify-recovery.mjs --dry-run          # preview without writing
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const outDir = process.env.OUT_DIR || 'output'
const resolvedOutDir = process.cwd() === outDir ? outDir : outDir
const ledgerPath = process.env.LEDGER_PATH || join(outDir, 'data', 'publication-ledger.json')
const topLevelLedgerPath = join('data', 'publication-ledger.json')
const dryRun = process.argv.includes('--dry-run')
const videoIdArg = process.argv.find((_, i, a) => a[i - 1] === '--video-id')

function findLedger() {
  const candidates = [ledgerPath, topLevelLedgerPath]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

async function main() {
  console.log(`[VERIFY-RECOVERY] ${dryRun ? 'DRY RUN' : 'LIVE'} — ${new Date().toISOString()}`)

  // Load ledger
  const actualLedgerPath = findLedger()
  if (!actualLedgerPath) {
    console.error(`[VERIFY-RECOVERY] No ledger found at ${ledgerPath} or ${topLevelLedgerPath}`)
    process.exit(1)
  }
  console.log(`[VERIFY-RECOVERY] Using ledger: ${actualLedgerPath}`)
  const ledger = JSON.parse(readFileSync(actualLedgerPath, 'utf-8'))
  const entries = ledger.entries || []
  console.log(`[VERIFY-RECOVERY] Ledger has ${entries.length} entries`)

  // Filter to entries needing verification recovery
  const needsRecovery = entries.filter(e => {
    if (videoIdArg && e.videoId !== videoIdArg) return false
    return e.verificationState === 'API_UNAVAILABLE'
      || e.verificationState === 'PENDING'
      || e.verificationState === 'VIDEO_NOT_VISIBLE_YET'
  })

  if (needsRecovery.length === 0) {
    console.log('[VERIFY-RECOVERY] No entries need recovery. All verified or rejected.')
    process.exit(0)
  }

  console.log(`[VERIFY-RECOVERY] ${needsRecovery.length} entries need recovery:`)
  for (const e of needsRecovery) {
    console.log(`  - ${e.videoId} (${e.verificationState}) — ${e.title || 'untitled'}`)
  }

  // Get OAuth token
  let token
  try {
    const { getAccessToken } = await import('../apps/api/publishers/youtube.js')
    token = await getAccessToken()
    console.log('[VERIFY-RECOVERY] OAuth token obtained')
  } catch (e) {
    console.error(`[VERIFY-RECOVERY] OAuth failed: ${e.message}`)
    console.error('[VERIFY-RECOVERY] Re-authorize with youtube.readonly scope, then re-run.')
    process.exit(1)
  }

  // Load verifiers
  const { YouTubePropagationVerifier, VerifyState } = await import('../src/publishing/YouTubePropagationVerifier.mjs')
  const { PostPublishVerifier } = await import('../src/publishing/PostPublishVerifier.mjs')

  let updated = 0
  let failed = 0

  for (const entry of needsRecovery) {
    console.log(`\n[VERIFY-RECOVERY] Verifying ${entry.videoId}...`)

    // 1. Propagation verifier (thumbnail check)
    let thumbnailResult
    try {
      const verifier = new YouTubePropagationVerifier({ token })
      thumbnailResult = await verifier.verify({ videoId: entry.videoId })
      console.log(`  thumbnail: ${thumbnailResult.state} (${thumbnailResult.durationMs}ms)`)
    } catch (e) {
      thumbnailResult = { state: VerifyState.VERIFICATION_FAILED, error: e.message }
      console.log(`  thumbnail: VERIFICATION_FAILED — ${e.message}`)
    }

    // 2. Post-publish verifier (video reachable + title + visibility)
    let verification
    try {
      const verifier = new PostPublishVerifier({ token })
      verification = await verifier.verify({
        videoId: entry.videoId,
        expectedTitle: entry.title,
        expectedVisibility: 'public',
        jobId: entry.jobId,
      })
      console.log(`  post-publish: ${verification.passed ? 'PASS' : 'FAIL'} (${verification.durationMs}ms)`)
      if (!verification.passed) console.log(`    failures: ${verification.failures.join('; ')}`)
    } catch (e) {
      verification = { passed: false, reason: e.message }
      console.log(`  post-publish: ERROR — ${e.message}`)
    }

    // 3. Determine new verification state
    const newVerificationState = thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_ACCEPTED
      ? 'VERIFIED'
      : thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_REJECTED
        ? 'REJECTED'
        : thumbnailResult.state === VerifyState.VERIFICATION_FAILED && thumbnailResult.errorType
          ? 'API_UNAVAILABLE'
          : thumbnailResult.state === VerifyState.VIDEO_NOT_VISIBLE_YET
            ? 'VIDEO_NOT_VISIBLE_YET'
            : 'PENDING'

    const newThumbnailState = thumbnailResult.hasCustomThumbnail
      ? 'CUSTOM_THUMBNAIL_ACCEPTED'
      : thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_REJECTED
        ? 'CUSTOM_THUMBNAIL_REJECTED'
        : 'UPLOADED'

    console.log(`  → verificationState: ${entry.verificationState} → ${newVerificationState}`)
    console.log(`  → thumbnailState: ${entry.thumbnailState} → ${newThumbnailState}`)

    // 4. Update ledger entry
    if (!dryRun && newVerificationState !== entry.verificationState) {
      entry.verificationState = newVerificationState
      entry.thumbnailState = newThumbnailState
      entry.verifiedAt = new Date().toISOString()
      entry.checks = {
        ...entry.checks,
        thumbnailState: newThumbnailState,
        verificationState: newVerificationState,
        recoveryVerifiedAt: new Date().toISOString(),
      }
      updated++
    } else if (dryRun) {
      console.log('  [DRY RUN] Would update ledger')
    }

    if (newVerificationState === 'VERIFIED' || verification.passed) {
      updated++
    } else {
      failed++
    }
  }

  // Save ledger
  if (!dryRun && updated > 0) {
    mkdirSync(dirname(actualLedgerPath), { recursive: true })
    writeFileSync(actualLedgerPath, JSON.stringify(ledger, null, 2))
    console.log(`\n[VERIFY-RECOVERY] Ledger saved. ${updated} entries updated.`)
  }

  // Summary
  console.log(`\n[VERIFY-RECOVERY] Complete:`)
  console.log(`  total: ${needsRecovery.length}`)
  console.log(`  recovered: ${updated}`)
  console.log(`  still pending: ${failed}`)

  // Show final state
  const finalEntries = dryRun ? entries : JSON.parse(readFileSync(actualLedgerPath, 'utf-8')).entries || []
  const states = {}
  for (const e of finalEntries) {
    const s = e.verificationState || 'UNKNOWN'
    states[s] = (states[s] || 0) + 1
  }
  console.log('  ledger state:')
  for (const [s, count] of Object.entries(states)) {
    console.log(`    ${s}: ${count}`)
  }
}

main().catch(e => {
  console.error(`[VERIFY-RECOVERY] Fatal: ${e.message}`)
  process.exit(1)
})
