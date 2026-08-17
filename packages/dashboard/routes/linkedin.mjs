/**
 * LinkedIn posting routes — /api/linkedin/post, /api/linkedin/status
 *
 * Allows posting promotional content to LinkedIn from the dashboard.
 */

import { Router } from 'express'

const router = Router()

// GET /api/linkedin/status — check if LinkedIn is configured
router.get('/api/linkedin/status', (req, res) => {
  const hasToken = !!process.env.LINKEDIN_ACCESS_TOKEN
  const hasUrn = !!process.env.LINKEDIN_MEMBER_URN
  const hasOrg = !!process.env.LINKEDIN_ORG_ID
  res.json({
    configured: hasToken && hasUrn,
    hasToken,
    hasUrn,
    hasOrg,
    memberUrn: process.env.LINKEDIN_MEMBER_URN || null,
    orgId: process.env.LINKEDIN_ORG_ID || null,
  })
})

// POST /api/linkedin/post — publish a post to LinkedIn
router.post('/api/linkedin/post', async (req, res) => {
  const { commentary, linkUrl } = req.body || {}
  if (!commentary) return res.status(400).json({ error: 'commentary required' })

  try {
    const { sharePost } = await import('../../../apps/api/publishers/linkedin.js')
    const token = process.env.LINKEDIN_ACCESS_TOKEN
    const urn = process.env.LINKEDIN_MEMBER_URN
    if (!token || !urn) return res.status(503).json({ error: 'LinkedIn not configured' })

    const result = await sharePost(token, urn, commentary, linkUrl || null)
    const id = result?.id || result?.urn || null
    const url = id
      ? `https://www.linkedin.com/feed/update/${id.replace('urn:li:share:', '').replace('urn:li:ugcPost:', '')}`
      : null

    res.json({ ok: true, postId: id, url, result })
  } catch (err) {
    console.error('[LinkedIn]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
