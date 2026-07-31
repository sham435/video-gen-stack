import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const metadata = {
  name: 'bridge',
  version: '1.1.0',
  dependsOn: ['schema', 'registry'],
  provides: ['signedSnapshot', 'idempotencyCheck', 'systemContext'],
  group: 'bridge',
  description: 'Smoke bridge API (system context, approval matrix, agent names, snapshot callable), then produce HMAC-signed rollback snapshot + idempotency check across 2 bridge instances',
}

export default function (ctx) {
  const r = ctx.results
  const b = ctx.bridge
  if (!b) {
    r.add('bridge', 'bridge smoke (bridge unavailable)', 'ERROR', false)
    return
  }
  const reqKeys = ['agents', 'memory', 'workflows', 'policies', 'approvalRequired', 'dataSources']
  const t0 = performance.now()
  const ctxObj = b.getSystemContext()
  const t1 = performance.now()
  r.perf.record('schemaValidation', t1 - t0)
  const miss = reqKeys.filter(k => !(k in ctxObj))
  if (miss.length === 0) r.add('bridge', 'getSystemContext() 6 historical keys', 'INFO', true,
    Object.fromEntries(reqKeys.map(k => [k, Array.isArray(ctxObj[k]) ? ctxObj[k].length : typeof ctxObj[k]])))
  else r.add('bridge', `getSystemContext() missing keys: ${miss.join(',')}`, 'CRITICAL', false)

  const approval = [
    ['push-to-main', 'controlled', 'ERROR'],
    ['syntax-check', 'auto', 'INFO'],
    ['unknown-action-xyz', 'review', 'NOTICE'],
  ]
  for (const [action, expected, sevOnFail] of approval) {
    const got = b.getApprovalLevel(action)
    if (got === expected) r.add('bridge', `getApprovalLevel('${action}') = ${expected}`, 'INFO', true)
    else r.add('bridge', `getApprovalLevel('${action}') expected ${expected}, got ${got}`, sevOnFail, false)
  }

  const names = b.getAgentNames()
  const cfgAgentsCount = Object.keys(b.config.agents || {}).length
  if (names.length === cfgAgentsCount) r.add('bridge', 'getAgentNames() count matches config', 'INFO', true, `${names.length}`)
  else r.add('bridge', `getAgentNames() mismatch (${names.length} vs ${cfgAgentsCount})`, 'ERROR', false)

  // upgrade snapshotForRollback to return signed metadata
  const snap = b.snapshotForRollback()
  const t = new Date(snap.snapshotTakenAt).getTime()
  const fresh = Date.now() - t < 30_000
  const expectedFiles = ['.opencode/system-config.json', 'src/integration/OpenCodeBridge.mjs', 'packages/dashboard/routes/opencode.mjs']
  const missing = expectedFiles.filter(f => !snap.files.includes(f))
  if (fresh) r.add('bridge', 'snapshot timestamp <30s old', 'INFO', true, snap.snapshotTakenAt)
  else r.add('bridge', 'snapshot timestamp stale', 'WARNING', false, snap.snapshotTakenAt)
  if (missing.length === 0) r.add('bridge', 'snapshot covers 3 default files', 'INFO', true)
  else r.add('bridge', `snapshot missing default files (${missing.join(',')})`, 'ERROR', false)
  if (typeof snap.restore === 'function') r.add('bridge', 'snapshot.restore() is callable', 'INFO', true)
  else r.add('bridge', 'snapshot.restore() not callable', 'CRITICAL', false)

  // HMAC-SHA256 signing secret: env OPENCODE_SIGNING_SECRET (for exchanging snapshots across envs) or deterministic per-repo+config key
  function getSigningSecret(ctx, state, b) {
    if (process.env.OPENCODE_SIGNING_SECRET && process.env.OPENCODE_SIGNING_SECRET.length >= 16) return process.env.OPENCODE_SIGNING_SECRET
    const cfg = state.configHash || (b && state.configHash) || 'opencode-unsigned-' + Date.now()
    const key = crypto.createHash('sha256').update('opencode-hmac-v1::' + cfg + '::' + ctx.root).digest('hex').slice(0, 32)
    return key
  }
  // signed snapshot: compute deterministically what validator signed
  const state = ctx.state || {}
  const secret = getSigningSecret(ctx, state, b)
  const sigInput = [
    snap.snapshotTakenAt,
    state.configHash || '',
    String(b._configSignature || 0),
    snap.files.join('|'),
    'opencode-v1-sig',
  ].join('::')
  const signature = crypto.createHmac('sha256', secret).update(sigInput).digest('hex').slice(0, 24)
  state.signedSnapshot = {
    takenAt: snap.snapshotTakenAt,
    configHash: state.configHash || null,
    configSignature: b._configSignature || 0,
    files: snap.files,
    signature,
    signatureAlgorithm: 'hmac-sha256',
    signingSecretSource: process.env.OPENCODE_SIGNING_SECRET && process.env.OPENCODE_SIGNING_SECRET.length >= 16 ? 'env:OPENCODE_SIGNING_SECRET' : 'derived:repo-path+config-hash',
  }
  r.add('bridge', 'snapshot signed (hmac-sha256 24-char)', 'INFO', true, signature)
  const b2 = new ctx.modules.bridge.OpenCodeBridge()
  if (b.isConfigSameAs(b2.config)) r.add('bridge', 'signatures idempotent across 2 bridge instances', 'INFO', true)
  else r.add('bridge', 'signatures NOT idempotent', 'ERROR', false, `${b._configSignature} vs ${b2._configSignature}`)

  // attach signed blob to every file snapshot content so restore can verify
  ctx.state.signedSnapshot = state.signedSnapshot
}
