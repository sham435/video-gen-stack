/**
 * requireAuth — shared admin-key middleware for the API + dashboard.
 *
 * Fails CLOSED: if ADMIN_API_KEY is not configured, every protected route
 * returns 503 so nothing ships unauthenticated by accident.
 */

export function requireAuth(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey) {
    return res.status(503).json({ error: 'ADMIN_API_KEY not configured on server' })
  }
  const presented = req.headers['x-api-key'] || req.query.apiKey
  if (!presented || presented !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing x-api-key' })
  }
  next()
}
