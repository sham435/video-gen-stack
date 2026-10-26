/**
 * agentAudit — server-side append-only audit trail for the embedded agent.
 *
 * WHY: approvals previously lived only on the task record — no actor
 * identity, no history (documented as risk 8 in docs/AGENT_SYSTEM_AUDIT_2026
 * and mandated by .opencode/policies/security.md §Secrets: "Audit trail").
 * Every chat run, stop, approval grant, and gated-tool attempt now lands as
 * one JSONL line in data/agent-audit.jsonl, with secret-shaped strings
 * redacted BEFORE serialization so the trail can never become a leak.
 */
import fs from 'fs'
import path from 'path'

export const AUDIT_FILE = path.resolve(process.cwd(), 'data', 'agent-audit.jsonl')

// Provider token shapes + bearer prefixes. Value-level redaction: the full
// lexeme is replaced, never truncated/partial — partial tokens still leak.
const SECRET_VALUE_RE = /\b(sk-or-v1-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|gh[puros]_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{8,})\b/g
// JSON/object field values whose KEY names a secret — redact regardless of shape.
const SECRET_FIELD_RE = /("(?:[A-Za-z0-9_-]*\b(?:api[_-]?key|apikey|secret|token|password|authorization)[A-Za-z0-9_-]*)"\s*:\s*")(?:[^"\\]|\\.)*(")/gi
// JSON/object field names whose presence makes the VALUE a secret — applied
// during object recursion (string keys are not inside quotes in JS objects).
const SECRET_FIELD_NAME_RE = /\b(?:api[_-]?key|apikey|secret|token|password|authorization|passwd|credential)\b/i

export function redactSecrets(value, depth = 0) {
  if (typeof value === 'string') {
    return value
      .replace(SECRET_VALUE_RE, '«redacted»')
      .replace(SECRET_FIELD_RE, '$1«redacted»$2')
  }
  if (depth >= 6 || value === null) return value
  if (Array.isArray(value)) return value.map(v => redactSecrets(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_FIELD_NAME_RE.test(k) ? '«redacted»' : redactSecrets(v, depth + 1)
    }
    return out
  }
  return value
}

/** Append one audit record. Never throws — the chat loop must not crash
 *  because the audit file is unwritable. */
export function appendAgentAudit(entry, { auditFile = AUDIT_FILE } = {}) {
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true })
    const rec = redactSecrets({ ts: new Date().toISOString(), ...entry })
    fs.appendFileSync(auditFile, JSON.stringify(rec) + '\n')
    return true
  } catch {
    return false
  }
}

/** Read back the audit trail (tail-bounded). Corrupt lines are surfaced as
 *  { raw } instead of aborting the read. */
export function auditEntries({ auditFile = AUDIT_FILE, tail = 200 } = {}) {
  try {
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-tail).map(l => {
      try { return JSON.parse(l) } catch { return { raw: l } }
    })
  } catch {
    return []
  }
}

/** Actor attribution. The dashboard is single-tenant (shared admin session),
 *  so optional x-actor header only accepts a safe display token — it is a
 *  label, never an authentication boundary. */
export function actorFrom(req) {
  const raw = String(req?.headers?.['x-actor'] || '').trim()
  return (raw.replace(/[^A-Za-z0-9._@: -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64)) || 'admin-session'
}

/** Plain in-memory fixed-window limiter (no dependency): per-bucket key →
 *  timestamps; check() is the only surface the chat route needs. */
export class RateLimiter {
  constructor({ max = 20, windowMs = 60000 } = {}) {
    this.max = max
    this.windowMs = windowMs
    this.hits = new Map() // key → [timestamps]
  }

  check(key) {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const list = (this.hits.get(key) || []).filter(ts => ts > windowStart)
    if (list.length >= this.max) {
      const retryAfterS = Math.ceil((this.windowMs - (now - list[0])) / 1000)
      this.hits.set(key, list)
      return { ok: false, retryAfterS: Math.max(1, retryAfterS), used: list.length, max: this.max }
    }
    list.push(now)
    this.hits.set(key, list)
    return { ok: true, used: list.length, max: this.max }
  }
}
