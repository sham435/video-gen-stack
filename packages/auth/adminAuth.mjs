/**
 * adminAuth — dependency-free JWT (HS256) + password hashing for the admin RBAC.
 *
 * Uses only Node's built-in `crypto` (no jsonwebtoken / bcrypt npm deps):
 *   - Password hashing: scrypt (N=16384,r=8,p=1) stored as
 *       scrypt$16384$8$1$<salt-b64>$<hash-b64>
 *     Salt is random per hash; verify uses timingSafeEqual.
 *   - Session tokens: standard HS256 JWT (header.payload.signature) built and
 *     verified with crypto HMAC-SHA256, base64url-encoded.
 *
 * Admin credentials come from env:
 *   ADMIN_USER        — admin username (default 'admin')
 *   ADMIN_PASS_HASH   — scrypt hash of the password (use scripts/admin-hash.mjs)
 *   JWT_SECRET        — secret used to sign admin session tokens
 *
 * Env is surfaced lazily (not captured at import) so tests/CLIs can set env
 * before first use and so a missing secret fails CLOSED at request time.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 32
const TOKEN_TTL_S = 60 * 60 * 24 // 24h
const COOKIE_NAME = 'admin_jwt'

// ── Password hashing (scrypt) ──────────────────────────────────────────────
export function hashPassword(password) {
  if (!password || typeof password !== 'string') throw new Error('password required')
  const salt = randomBytes(16).toString('base64')
  const hash = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('base64')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`
}

export function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false
  const parts = String(storedHash).split('$')
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false
  const [, n, r, p, salt, expected] = parts
  try {
    const derived = scryptSync(password, salt, KEYLEN, { N: Number(n), r: Number(r), p: Number(p) })
    const a = Buffer.from(derived)
    const b = Buffer.from(expected, 'base64')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── JWT (HS256) ────────────────────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export function signToken(payload, { secret = process.env.JWT_SECRET, ttlS = TOKEN_TTL_S } = {}) {
  if (!secret) throw new Error('JWT_SECRET not configured')
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlS }))
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

/** Returns the decoded payload if the token is valid + role==='admin'; else null. */
export function verifyToken(token, { secret = process.env.JWT_SECRET } = {}) {
  if (!secret || !token || typeof token !== 'string') return null
  const [header, body, sig] = token.split('.')
  if (!header || !body || !sig) return null
  const expected = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null
  if (payload.role !== 'admin') return null
  return payload
}

// ── Cookie helpers ─────────────────────────────────────────────────────────
function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export function setAdminCookie(res, token, { secure = process.env.NODE_ENV === 'production' } = {}) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_S * 1000,
  })
}

export function clearAdminCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, path: '/' })
}

/** Non-throwing: is this request an authenticated admin? (for open pages) */
export function isAdminAuthed(req) {
  const token = readCookie(req, COOKIE_NAME)
  return verifyToken(token) !== null
}

/** Middleware: protects /admin/* routes. Fails CLOSED if JWT_SECRET unset. */
export function requireAdmin(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'JWT_SECRET not configured — admin unavailable' })
  }
  const token = readCookie(req, COOKIE_NAME)
  const payload = verifyToken(token)
  if (!payload) {
    const wantsHtml = (req.headers.accept || '').includes('text/html')
    if (wantsHtml) return res.redirect('/admin/login')
    return res.status(401).json({ error: 'Unauthorized: admin login required' })
  }
  req.admin = payload
  next()
}
