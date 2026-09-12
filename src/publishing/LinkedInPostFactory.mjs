/**
 * LinkedInPostFactory — deterministic luxury LinkedIn post formatter.
 *
 * Single source of truth for all LinkedIn copy across the pipeline.
 * Luxury formatting is a production policy, not an AI preference.
 *
 *   LinkedInPostFactory
 *     ├── VideoPostFormatter   (Hook → Story → WhyItMatters → CTA → Hashtags)
 *     └── ArticlePostFormatter (Headline → Story → BiggerPicture → CTA → Hashtags)
 *
 * Invariant: every LinkedIn post passes through this factory.
 * C2PA/provenance is preserved via thumbnailPath in the result.
 */

const CHANNEL_URL = 'https://www.youtube.com/@news-monster'
const LANDING_PAGE = 'https://sham435.github.io/video-gen-stack/'
const MAX_COMMENTARY = 1500
const DIVIDER = '━'.repeat(16)

function stripNoise(s = '') {
  return s.replace(/\| NEWS-MONSTER$/i, '').replace(/🎬|📰|🚨/g, '').trim()
}

function nicheFromCategory(category = '') {
  const map = {
    technology: 'Technology', science: 'Science', business: 'Business',
    sports: 'Sports', entertainment: 'Entertainment', health: 'Health',
    politics: 'Politics', world: 'World', general: 'News',
  }
  return map[category] || category.charAt(0).toUpperCase() + category.slice(1)
}

export class VideoPostFormatter {
  /**
   * @param {object} video
   * @param {string} video.title
   * @param {string} video.summary
   * @param {string} video.category
   * @param {string} video.videoUrl
   * @param {string} video.youtubeShortsUrl
   * @param {string[]} video.hashtags
   * @param {string} video.thumbnailPath
   */
  format(video) {
    const title = stripNoise(video.title || '')
    const summary = video.summary || ''
    const category = nicheFromCategory(video.category || 'news')
    const videoUrl = video.youtubeShortsUrl || video.videoUrl || ''
    const hashtags = (video.hashtags || []).slice(0, 5)

    const lines = [
      title,
      '',
      summary || `A ${category.toLowerCase()} story worth your time.`,
      '',
      `Why it matters:`,
      `${summary ? summary.slice(0, 120) : 'This matters because it shapes what comes next.'}`,
      '',
      DIVIDER,
      '',
      `▶ Watch the full story:`,
      videoUrl,
      '',
      `🌐 Follow the latest:`,
      LANDING_PAGE,
      '',
      `🔔 Follow NEWS-MONSTER:`,
      CHANNEL_URL,
      '',
      hashtags.join(' '),
    ]

    return {
      type: 'video',
      commentary: lines.join('\n').slice(0, MAX_COMMENTARY),
      media: { url: videoUrl },
      hashtags,
      thumbnailPath: video.thumbnailPath || null,
    }
  }
}

export class ArticlePostFormatter {
  /**
   * @param {object} article
   * @param {string} article.title
   * @param {string} article.description
   * @param {string} article.url
   * @param {string} article.source
   * @param {string} article.category
   * @param {string[]} article.hashtags
   * @param {string} article.thumbnailPath
   */
  format(article) {
    const headline = stripNoise(article.title || '')
    const description = article.description || ''
    const category = nicheFromCategory(article.category || 'news')
    const articleUrl = article.url || ''
    const hashtags = (article.hashtags || []).slice(0, 5)

    const lines = [
      headline,
      '',
      description || `${category} development worth noting.`,
      '',
      `The bigger picture:`,
      `${description ? description.slice(0, 120) : 'This is part of a larger shift in the industry.'}`,
      '',
      DIVIDER,
      '',
      `🌐 Read more:`,
      articleUrl,
      '',
      `🔔 Follow NEWS-MONSTER for daily updates.`,
      LANDING_PAGE,
      '',
      hashtags.join(' '),
    ]

    return {
      type: 'article',
      commentary: lines.join('\n').slice(0, MAX_COMMENTARY),
      hashtags,
      thumbnailPath: article.thumbnailPath || null,
    }
  }
}

export class LinkedInPostFactory {
  constructor({ linkedin = null } = {}) {
    this.video = new VideoPostFormatter()
    this.article = new ArticlePostFormatter()
    // Optional DI seam for tests: { shareVideoBuffer, resolveAllAuthorUrns,
    // introspectToken }. When omitted, loads the real publisher lazily.
    this.linkedin = linkedin
  }

  /**
   * Build a luxury LinkedIn post. Determines formatter from input shape.
   * @param {object} input — either video (has videoUrl/videoId) or article (has url)
   * @returns {{ type, commentary, media?, hashtags, thumbnailPath }}
   */
  build(input) {
    if (input.videoId || input.videoUrl || input.youtubeShortsUrl) {
      return this.video.format(input)
    }
    return this.article.format(input)
  }

  /** Direct access for explicit formatting. */
  videoPost(video) { return this.video.format(video) }
  articlePost(article) { return this.article.format(article) }

  /**
   * Resolve which profiles to post to, in order.
   *
   * Env-driven via LINKEDIN_POST_TARGETS ('profile' | 'company' | 'both'):
   *   - 'profile' explicit → member only (no introspection needed)
   *   - 'company' explicit → org only when configured + scope confirmed
   *   - 'both' (default when org configured) → profile + company
   *   - default when no org configured → profile only
   *
   * IMPORTANT: running this triggers token introspection (network) when the
   * company target is a candidate, to confirm w_organization_social scope.
   *
   * @param {string} memberUrn - urn:li:person:…
   * @param {{ resolveScope?: (token: string) => Promise<boolean> }} [opts]
   * @returns {Promise<Array<{urn: string, target: 'profile'|'company'}>>}
   */
  async resolveTargetUrns(memberUrn, opts = {}) {
    const mode = (process.env.LINKEDIN_POST_TARGETS || '').toLowerCase()
    const orgUtl = () => process.env.LINKEDIN_ORGANIZATION_URN
      || (process.env.LINKEDIN_ORG_ID ? `urn:li:organization:${process.env.LINKEDIN_ORG_ID}` : null)

    // Candidate set from the requested mode.
    let wantsProfile = mode !== 'company'
    let wantsCompany = mode === 'company' || mode === 'both'
    if (!mode) {
      // Default: both when org posting is enabled, otherwise profile only.
      wantsCompany = process.env.LINKEDIN_ORG_SOCIAL === '1' && !!orgUtl()
    }

    const targets = []
    if (wantsProfile) targets.push({ urn: memberUrn, target: 'profile' })

    if (wantsCompany) {
      const orgUrn = orgUtl()
      if (!orgUrn) {
        console.warn('[LINKEDIN] company target requested but LINKEDIN_ORGANIZATION_URN/LINKEDIN_ORG_ID not set — skipping')
      } else if (process.env.LINKEDIN_ORG_SOCIAL !== '1') {
        console.warn('[LINKEDIN] company target requested but LINKEDIN_ORG_SOCIAL!=1 — skipping')
      } else {
        let hasScope = false
        if (typeof opts.resolveScope === 'function') {
          try { hasScope = await opts.resolveScope(memberUrn) || false } catch { hasScope = false }
        }
        if (hasScope) targets.push({ urn: orgUrn, target: 'company' })
        else console.warn('[LINKEDIN] token lacks w_organization_social — company page posts disabled')
      }
    }
    return targets
  }

  /**
   * Upload + post native video to every enabled target (dual-profile).
   *
   * Uses the 2026 LinkedIn Videos API (initializeUpload → multipart PUT →
   * finalizeUpload → poll AVAILABLE → rest/posts with content.media.id), via
   * the shared publisher in apps/api/publishers/linkedin.js. The local MP4
   * buffer is uploaded SEPARATELY per target (each owner needs its own upload).
   *
   * @param {string} token - access token (w_member_social [+ w_organization_social])
   * @param {string} memberUrn - urn:li:person:…
   * @param {Buffer} buffer - final.mp4 bytes (local render, no re-download)
   * @param {object} videoMeta - { title, summary, category, videoUrl, youtubeShortsUrl, hashtags, thumbnailPath }
   * @returns {Promise<Array<{target, success, id?, urn?, error?}>>}
   */
  async publishVideo(token, memberUrn, buffer, videoMeta) {
    const impl = this.linkedin || await import('../../apps/api/publishers/linkedin.js')
    const resolveAllAuthorUrns = impl.resolveAllAuthorUrns
    const shareVideoBuffer = impl.shareVideoBuffer
    const introspectToken = impl.introspectToken
    const post = this.videoPost(videoMeta)

    let targets
    try {
      // Pass resolveScope so the org candidate is confirmed against the LIVE
      // token's scopes (w_organization_social). Without this, hasScope stays
      // false and the company page is silently skipped even when configured.
      const resolveScope = async () => {
        const scopes = (await introspectToken(token)).scope || []
        return scopes.includes('w_organization_social')
      }
      targets = await this.resolveTargetUrns(memberUrn, { resolveScope })
      // Empty resolves (no candidate enabled) → fall back to the shared
      // resolver which defensively always includes the member profile.
      if (!targets.length) targets = await resolveAllAuthorUrns(token, memberUrn)
    } catch {
      targets = await resolveAllAuthorUrns(token, memberUrn)
    }

    const results = []
    for (const { urn: owner, target } of targets) {
      try {
        const result = await shareVideoBuffer(token, owner, buffer, post.commentary)
        results.push({
          target, success: true, id: result.id || result.urn, urn: result.urn,
          url: result.id ? `https://www.linkedin.com/feed/update/${result.id}` : null,
        })
        console.log(`[LINKEDIN] video post to ${target}: ${result.id || result.urn}`)
      } catch (e) {
        results.push({ target, success: false, error: e.message })
        console.error(`[LINKEDIN] video post to ${target} failed: ${e.message}`)
      }
    }
    return results
  }

  /** Alias for parity with the shared publisher's dual-profile helper. */
  async shareVideoToAll(token, memberUrn, buffer, commentary) {
    const { shareVideoToAll: shared } = await import('../../apps/api/publishers/linkedin.js')
    return shared(token, memberUrn, buffer, commentary)
  }
}
