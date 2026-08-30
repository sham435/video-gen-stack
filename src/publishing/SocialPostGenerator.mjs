import { HashtagBuilder } from './HashtagBuilder.mjs'

// SocialPostGenerator — builds platform-specific promotional posts from
// published-video metadata. LinkedIn posts are luxury image posts with
// thumbnail, YouTube link, and GitHub landing page link.
//
// Input shape (from the publish contract):
//   { title, videoUrl, videoId, thumbnailPath, category, hook, summary, hashtags }

const LINKEDIN_MAX_COMMENTARY = 1500
const LANDING_PAGE = 'https://sham435.github.io/video-gen-stack/'

function cleanTitle(title = '') {
  return title
    .replace(/\| NEWS-MONSTER$/i, '')
    .replace(/🎬|📰|🚨/g, '')
    .trim()
}

/** Niche-style hook: "Scientists Just Set Up What Comes Next" */
function nicheHook(title = '') {
  const words = title.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length <= 4) return title || 'Breaking story from NEWS-MONSTER'
  // Take leading subject as hook
  return words.slice(0, Math.min(5, words.length)).join(' ')
}

export class SocialPostGenerator {
  build(video) {
    const title = cleanTitle(video.title || 'NEWS-MONSTER')
    const videoId = video.videoId || null
    const videoUrl = video.videoUrl || (videoId ? `https://youtu.be/${videoId}` : '')
    // Aspect-aware canonical link: a Standard 16:9 upload uses the watch URL,
    // only a 9:16 Shorts upload uses /shorts/. Driven by RENDER_ASPECT (same
    // single source as composer), default 16:9.
    const isShorts = (process.env.RENDER_ASPECT || '16:9') === '9:16'
    const youtubeShortsUrl = videoId
      ? (isShorts ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`)
      : videoUrl
    const summary = video.summary || video.hook || ''
    const hook = nicheHook(title)
    const category = video.category || 'news'

    const hashtags = Array.isArray(video.hashtags) && video.hashtags.length
      ? video.hashtags
      : HashtagBuilder.buildList({
          topic: category,
          category,
          pipelineProfile: 'breaking',
          channel: 'NEWS-MONSTER',
        })

    return {
      title,
      videoId,
      videoUrl,
      youtubeShortsUrl,
      thumbnailPath: video.thumbnailPath || null,
      category,
      hook,
      summary,
      hashtags,
      platforms: {
        linkedin: {
          ...this.linkedinPost({ title, hook, summary, videoUrl, youtubeShortsUrl, hashtags, category }),
          thumbnailPath: video.thumbnailPath || null,
        },
        youtubeCommunity: { ...this.youtubeCommunityPost({ title, videoUrl, hook, summary, hashtags }), thumbnailPath: video.thumbnailPath || null },
      },
    }
  }

  /** Luxury LinkedIn image post with thumbnail + both links. */
  linkedinPost({ title, hook, summary, videoUrl, youtubeShortsUrl, hashtags, category }) {
    const ytLink = youtubeShortsUrl || videoUrl
    const lines = [
      `${hook}`,
      ``,
      summary ? `${summary.slice(0, 200)}` : `A ${category} story worth your time.`,
      ``,
      `▶ Watch on YouTube:`,
      `${ytLink}`,
      ``,
      `🌐 Full gallery:`,
      `${LANDING_PAGE}`,
      ``,
      hashtags.join(' '),
    ]
    const text = lines.join('\n')
    return {
      commentary: text.slice(0, LINKEDIN_MAX_COMMENTARY),
      media: { url: ytLink },
      hashtags: hashtags.slice(0, 5),
    }
  }

  /** YouTube Community post — currently queued for manual publication. */
  youtubeCommunityPost({ title, videoUrl, hook, summary, hashtags }) {
    const lines = [
      `🚨 NEW: ${hook}`,
      ``,
      summary ? `${summary.slice(0, 200)}` : `A ${title.toLowerCase()} story you should see.`,
      ``,
      `▶ Watch: ${videoUrl}`,
      ``,
      hashtags.join(' '),
    ]
    return {
      title,
      text: lines.join('\n'),
      thumbnailPath: null,
      hashtags,
    }
  }
}