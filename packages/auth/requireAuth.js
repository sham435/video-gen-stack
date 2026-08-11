/**
 * requireAuth — shared admin-key middleware for the API + dashboard.
 *
 * Fails CLOSED: if ADMIN_API_KEY is not configured, every protected route
 * returns 503 so nothing ships unauthenticated by accident.
 *
 * Authentication sources (in priority order):
 *   1. `x-api-key` header (the raw admin key) — used by API clients & CLI.
 *   2. `nm_session` httpOnly cookie — issued at login, carries browsers and
 *      EventSource streams (which cannot send custom headers) without ever
 *      putting the key in a URL.
 *
 * The admin key is NEVER accepted in the query string — keys in URLs leak
 * into access logs, referer headers and browser history.
 */

import { randomBytes, timingSafeEqual } from 'crypto'

const SESSION_TTL_MS = 1000 * 60 * 60 * 12 // 12h sliding
const sessions = new Map() // token -> { expiresAt }

function issueSession(token) {
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS })
}

function isSessionValid(token) {
  if (!token) return false
  const s = sessions.get(token)
  if (!s) return false
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token)
    return false
  }
  s.expiresAt = Date.now() + SESSION_TTL_MS // sliding refresh
  return true
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  const pa = Buffer.from(a)
  const pb = Buffer.from(b)
  return timingSafeEqual(pa, pb)
}

/** Create an authenticated session cookie value for the admin. */
export function createAdminSession() {
  const token = randomBytes(32).toString('hex')
  issueSession(token)
  return token
}

/** Non-throwing gates used by open (login) routes: is the request authed? */
function cookieValue(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export function isAuthed(req) {
  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey) return false
  const header = req.headers['x-api-key']
  if (typeof header === 'string' && constantTimeEqual(header, adminKey)) return true
  if (isSessionValid(cookieValue(req, 'nm_session'))) return true
  return false
}

export function requireAuth(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey) {
    return res.status(503).json({ error: 'ADMIN_API_KEY not configured on server' })
  }
  const header = req.headers['x-api-key']
  const cookie = cookieValue(req, 'nm_session')
  const okHeader = typeof header === 'string' && constantTimeEqual(header, adminKey)
  const okCookie = isSessionValid(cookie)
  if (!okHeader && !okCookie) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing x-api-key' })
  }
  next()
}