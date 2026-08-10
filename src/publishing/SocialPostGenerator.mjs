import { HashtagBuilder } from './HashtagBuilder.mjs'

// SocialPostGenerator — builds the platform-specific promotional post from the
// same published-video metadata.
//
// Input shape (from the publish contract):
//   { title, videoUrl, thumbnailPath, category, hook, summary, hashtags }
//
// The post is NOT the YouTube description — it is a curiosity-driven social
// update with a hook, value statement, YouTube CTA, hashtags and branding.

const LINKEDIN_MAX_COMMENTARY = 1500 // Posts API commentary cap
const HOOK_PREFIXES = ['BREAKING:', 'JUST IN:', 'HUGE:', 'FYI:']

function cleanTitle(title = '') {
  return title
    .replace(/\| NEWS-MONSTER$/i, '')
    .replace(/🎬|📰|🚨/g, '')
    .trim()
}

/** Derive a curiosity hook from the title if not provided by the caller. */
function deriveHook(title = '', summary = '') {
  const words = title.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length <= 3) return title || 'The story everyone missed.'
  // "X just did Y" style curiosity line from the leading subject.
  const subject = words.slice(0, Math.min(3, words.length)).join(' ')
  return `${subject} — here's what just happened.`
}

export class SocialPostGenerator {
  build(video) {
    const title = cleanTitle(video.title || 'NEWS-MONSTER')
    const videoUrl = video.videoUrl || `https://youtu.be/${video.videoId || ''}`
    const summary = video.summary || video.hook || ''
    const hook = video.hook || deriveHook(title, summary)

    const hashtags = Array.isArray(video.hashtags) && video.hashtags.length
      ? video.hashtags
      : HashtagBuilder.buildList({
          topic: video.category || 'news',
          category: video.category || 'news',
          pipelineProfile: 'breaking',
          channel: 'NEWS-MONSTER',
        })

    return {
      title,
      videoId: video.videoId || null,
      videoUrl,
      thumbnailPath: video.thumbnailPath || null,
      category: video.category || 'news',
      hook,
      summary,
      hashtags,
      platforms: {
        linkedin: { ...this.linkedinPost({ title, videoUrl, hook, summary, hashtags }), thumbnailPath: video.thumbnailPath || null },
        youtubeCommunity: { ...this.youtubeCommunityPost({ title, videoUrl, hook, summary, hashtags }), thumbnailPath: video.thumbnailPath || null },
      },
    }
  }

  /** Colourful LinkedIn promotional post. */
  linkedinPost({ title, videoUrl, hook, summary, hashtags }) {
    const lines = [
      `🚨 NEW: ${hook}`,
      ``,
      summary ? `${summary}` : `A ${title.toLowerCase()} story that's worth two minutes of your time.`,
      ``,
      `▶ Watch the full story:`,
      `${videoUrl}`,
      ``,
      `What do you think?`,
      ``,
      hashtags.join(' '),
    ]
    const text = lines.join('\n')
    return {
      commentary: text.slice(0, LINKEDIN_MAX_COMMENTARY),
      media: { url: videoUrl },
      hashtags: hashtags.slice(0, 5),
    }
  }

  /** YouTube Community post — currently queued for manual publication. */
  youtubeCommunityPost({ title, videoUrl, hook, summary, hashtags }) {
    const lines = [
      `🚨 NEW: ${hook}`,
      ``,
      summary ? `${summary}` : `A ${title.toLowerCase()} story you should see.`,
      ``,
      `▶ Watch: ${videoUrl}`,
      ``,
      hashtags.join(' '),
    ]
    return {
      title,
      text: lines.join('\n'),
      thumbnailPath: null, // set by the manager when the asset exists
      hashtags,
    }
  }
}