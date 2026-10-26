import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { redactSecrets, appendAgentAudit, auditEntries, actorFrom, RateLimiter } from '../packages/dashboard/agentAudit.mjs'
import { AgentTaskStore } from '../packages/dashboard/agentTasks.mjs'

function tmpdir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-audit-')))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// ── redaction: the audit trail must never become a secret leak ─────────────

test('agent-audit: redactSecrets scrubs provider token shapes verbatim', () => {
  const out = redactSecrets('key is sk-or-v1-abcdef1234567890 and AIzaSyC-abcdefghijklmnop123 Bearer abc123def456')
  assert.match(out, /«redacted»/)
  assert.ok(!out.includes('sk-or-v1-'), 'partial sk-or-v1 prefix must not survive')
  assert.ok(!out.includes('AIzaSy'), 'AIza prefix must not survive')
  assert.ok(!out.includes('Bearer abc123'), 'bearer value must not survive')
  // ordinary prose untouched
  assert.equal(redactSecrets('repo has 27 tests and six failing'), 'repo has 27 tests and six failing')
})

test('agent-audit: redactSecrets scrubs secret-named OBJECT fields regardless of value', () => {
  const out = redactSecrets({ config: { api_key: 'plain-anything', password: 'hunter2', safe: 'visible' }, nested: { token: 'tok-123-abcd-efgh' } })
  assert.equal(out.config.api_key, '«redacted»')
  assert.equal(out.config.password, '«redacted»')
  assert.equal(out.nested.token, '«redacted»')
  assert.equal(out.config.safe, 'visible')
  // and the same effect for stringified JSON bodies
  const s = redactSecrets('{"authorization":"Bearer rawpass"}')
  assert.match(s, /«redacted»/)
})

// ── append + read-back (explicit file — never the live audit trail) ────────

test('agent-audit: appendAgentAudit writes JSONL and readback redacts secrets', t => {
  const dir = tmpdir(t)
  const file = path.join(dir, 'audit.jsonl')
  assert.equal(appendAgentAudit({ type: 'chat', cid: 'c1', detail: 'please fix sk-or-v1-zzzz9876543210abcd' }, { auditFile: file }), true)
  assert.equal(appendAgentAudit({ type: 'approve', cid: 'c1', actions: ['push-to-main'] }, { auditFile: file }), true)
  const entries = auditEntries({ auditFile: file })
  assert.equal(entries.length, 2)
  assert.equal(entries[0].type, 'chat')
  assert.ok(!JSON.stringify(entries).includes('sk-or-v1-'), 'audit file must not contain the token')
  assert.match(entries[1].actions[0], /push-to-main/)
  // crash-safety contract: corrupt line → {raw}, no throw
  fs.appendFileSync(file, '{not json}\n')
  assert.equal(auditEntries({ auditFile: file }).pop().raw, '{not json}')
})

test('agent-audit: actorFrom sanitizes the header and defaults safely', () => {
  assert.equal(actorFrom({ headers: { 'x-actor': 'editing-desk@room1' } }), 'editing-desk@room1')
  assert.equal(actorFrom({ headers: { 'x-actor': 'e\u0000vi?l "quoted"' } }), 'e vi l quoted')
  assert.equal(actorFrom({ headers: {} }), 'admin-session')
})

// ── rate limiter: fixed window per key ─────────────────────────────────────

test('agent-audit: RateLimiter blocks past max and recovers after the window', async t => {
  const lim = new RateLimiter({ max: 3, windowMs: 200 })
  for (let i = 0; i < 3; i++) assert.equal(lim.check('ip1').ok, true, `hit ${i + 1} allowed`)
  const blocked = lim.check('ip1')
  assert.equal(blocked.ok, false)
  assert.ok(blocked.retryAfterS >= 1)
  // separate key unaffected
  assert.equal(lim.check('ip2').ok, true)
  // window elapses → allowed again
  await new Promise(r => setTimeout(r, 250))
  assert.equal(lim.check('ip1').ok, true)
})

// ── cancellation state machine (memory-mode store — no DB in tests) ────────

test('agent-audit: task store supports cancelled as a resumable stop state', t => {
  const dir = tmpdir(t)
  // A plain object where a better-sqlite3 db is expected is unusable → the
  // store takes its documented in-memory fallback path. No DB in tests.
  const store = new AgentTaskStore({ db: {}, file: path.join(dir, 'tasks.json') })
  const cid = 'test-' + Math.random().toString(36).slice(2, 10)
  const created = store.create(cid)
  assert.ok(store.get(cid), 'create registered the task')

  store.update(cid, { status: 'running', stage: 1, progress: 15 })
  store.update(cid, { status: 'cancelled', current_action: 'Stopped by user — say "proceed" to resume' })
  assert.equal(store.get(cid).status, 'cancelled', 'the /stop flip persists as cancelled')
  // resume accepts the cancelled state (chat route checks interrupted || cancelled)
  assert.ok(AgentTaskStore.resumeIntent('proceed, keep going'))
  assert.ok(['interrupted', 'cancelled'].includes(store.get(cid).status), 'stop state is in the resume-accept list')
  assert.ok(created)
})

// ── static wiring contract — the changed route code has the guards in place ─

test('agent-audit: dashboard chat loop wires limit, audit and cancellation', t => {
  const src = fs.readFileSync(new URL('../packages/dashboard/index.mjs', import.meta.url), 'utf8')
  assert.match(src, /agentChatLimiter\.check\(/, 'chat route must enforce the rate limit')
  assert.match(src, /appendAgentAudit\(\{ actor, type: 'chat'/, 'chat runs must be audit-logged')
  assert.match(src, /type: 'stop', cid: t\.conversation_id/, 'stop must be audit-logged')
  assert.match(src, /type: 'approve', cid: t\.conversation_id/, 'approve must be audit-logged')
  assert.match(src, /agentTasks\.get\(cid\)\?\.status === 'cancelled'/, 'mid-loop cancellation reads persisted task state')
  assert.match(src, /cancelled \? 'cancelled' : paused \? 'interrupted' : 'completed'/, 'persisted outcome honors a cancelled state')
  assert.match(src, /task\.status === 'interrupted' \|\| task\.status === 'cancelled'/, 'stop flip remains resumable')
})

test('agent-audit: system config approval matrix includes modify-content', t => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../.opencode/system-config.json', import.meta.url), 'utf8'))
  assert.ok(cfg.approval_required.includes('modify-content'), 'editorial review gate must be in approval_required')
  assert.ok(cfg.approval_required.includes('dependency-add'), 'dependency gate stays listed')
})
