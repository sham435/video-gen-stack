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

const CHANNEL_URL = 'https://www.youtube.com/@sham435'
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
  constructor() {
    this.video = new VideoPostFormatter()
    this.article = new ArticlePostFormatter()
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
}
