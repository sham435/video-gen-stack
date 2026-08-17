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
    const token = process.env.LINKEDIN_ACCESS_TOKEN
    const urn = process.env.LINKEDIN_MEMBER_URN
    if (!token || !urn) return res.status(503).json({ error: 'LinkedIn not configured' })

    // Post as person — skip sharePost which reads LINKEDIN_ORG_SOCIAL env
    const body = {
      author: urn,
      commentary: commentary.slice(0, 1500),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }
    if (linkUrl) {
      body.content = {
        article: {
          source: linkUrl.slice(0, 2000),
          title: 'NEWS-MONSTER — Automated AI Breaking News',
          description: 'Breaking news, AI, science, sports & future tech — AI-generated video shorts every 30 minutes.',
        },
      }
    }
    const r = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202605',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await r.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = {} }
    if (!r.ok) throw new Error(data.message || data.serviceErrorCode || `HTTP ${r.status}`)
    const postId = r.headers.get('x-restli-id') || data.id || data.urn || null
    const url = postId
      ? `https://www.linkedin.com/feed/update/${postId.replace('urn:li:share:', '').replace('urn:li:ugcPost:', '')}`
      : null
    res.json({ ok: true, postId, url })
  } catch (err) {
    console.error('[LinkedIn]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
