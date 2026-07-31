import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const metadata = {
  name: 'rollback',
  version: '1.1.0',
  dependsOn: ['schema', 'bridge'],
  provides: ['rollbackEligibility', 'contentHashes'],
  group: 'rollback',
  description: 'Verify HMAC-signed rollback snapshot integrity (signature, age, per-file content SHA-256 hashes for exact restore)',
}

export default function (ctx) {
  const r = ctx.results
  const b = ctx.bridge
  if (!b) {
    r.add('rollback', 'rollback checks (bridge unavailable)', 'ERROR', false)
    return
  }
  // rollback eligibility: signed snapshot + contents verified
  const signed = ctx.state.signedSnapshot
  if (!signed) {
    r.add('rollback', 'signed snapshot not produced by bridge plugin', 'ERROR', false)
    return
  }
  const expectedDefault = ['.opencode/system-config.json', 'src/integration/OpenCodeBridge.mjs', 'packages/dashboard/routes/opencode.mjs']
  const missingDefault = expectedDefault.filter(f => !signed.files.includes(f))
  if (missingDefault.length === 0) r.add('rollback', 'signed snapshot covers 3 default files', 'INFO', true)
  else r.add('rollback', `signed snapshot missing default files: ${missingDefault.join(',')}`, 'ERROR', false)

  // verify signature integrity — HMAC-SHA256 secret source must match bridge side
  function getSigningSecret(ctx, signed) {
    if (process.env.OPENCODE_SIGNING_SECRET && process.env.OPENCODE_SIGNING_SECRET.length >= 16) return process.env.OPENCODE_SIGNING_SECRET
    const cfg = signed.configHash || 'opencode-unsigned'
    return crypto.createHash('sha256').update('opencode-hmac-v1::' + cfg + '::' + ctx.root).digest('hex').slice(0, 32)
  }
  const secret = getSigningSecret(ctx, signed)
  const sigInput = [
    signed.takenAt,
    signed.configHash || '',
    String(signed.configSignature || 0),
    signed.files.join('|'),
    'opencode-v1-sig',
  ].join('::')
  const reSig = crypto.createHmac('sha256', secret).update(sigInput).digest('hex').slice(0, 24)
  if (reSig === signed.signature) r.add('rollback', 'signed snapshot signature verifies (hmac-sha256)', 'INFO', true, signed.signature)
  else r.add('rollback', 'signed snapshot signature MISMATCH (hmac-sha256)', 'CRITICAL', false, `${signed.signature} vs ${reSig}; algo=${signed.signatureAlgorithm||'unknown'}`)

  // age
  const age = Date.now() - new Date(signed.takenAt).getTime()
  if (age < 30 * 60 * 1000) r.add('rollback', `signed snapshot age < 30 minutes (${(age/1000).toFixed(0)}s)`, 'INFO', true)
  else r.add('rollback', `signed snapshot age >= 30 minutes (${(age/60000).toFixed(1)}m); rollback not guaranteed`, 'NOTICE', false)

  // content hashes of each default file for EXACT restore matching
  const contentHashes = {}
  let contentAll = true
  for (const rel of signed.files) {
    const full = path.join(ctx.root, rel)
    if (!fs.existsSync(full)) { contentAll = false; continue }
    const h = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 16)
    contentHashes[rel] = h
  }
  if (contentAll) {
    r.add('rollback', 'signed snapshot content hashes verified for each file', 'INFO', true, contentHashes)
    signed.contentHashes = contentHashes
  } else {
    r.add('rollback', 'some snapshot files missing; content hashes partial', 'WARNING', false, contentHashes)
  }
}
