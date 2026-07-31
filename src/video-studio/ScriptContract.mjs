import { BrandStyleResolver } from '../visual/BrandStyleResolver.mjs'

export class ScriptContract {
  constructor() {
    this.resolver = new BrandStyleResolver()
  }

  build(article, directorStory) {
    const { brand, brandColor } = this.resolver.resolveBrand(article.title || '')
    const category = article.category || 'technology'
    const catStyle = BrandStyleResolver.CATEGORY_STYLES[category] || BrandStyleResolver.CATEGORY_STYLES.default

    const emotion = directorStory?.scenePlan?.[0]?.emotion || directorStory?.emotionalArc?.[0] || 'shock'
    const headline = directorStory?.headline || (article.title || 'Tech News')
    const brandTag = (brand || article.title?.split(' ')[0] || 'TECH').toUpperCase()

    return {
      video_id: `nm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      story: {
        headline,
        hook: directorStory?.scenePlan?.[0]?.narration || directorStory?.hookStrategy || '',
        angle: this._angleFromEmotion(emotion),
        target_audience: this._audienceFor(category),
      },
      cover: {
        headline: brandTag,
        subheadline: (directorStory?.scenePlan?.[0]?.caption?.fullText || 'BREAKING').slice(0, 24),
        visual_subject: directorStory?.scenePlan?.[0]?.visual?.subject || brandTag,
        emotion,
        ctr_target: 85,
        accent_color: brandColor || catStyle.color,
      },
      scenes: (directorStory?.scenePlan || []).map((s, i) => ({
        id: i + 1,
        type: s.type,
        duration: s.duration || 3,
        narration: s.narration || '',
        visual_prompt: `${s.visual?.subject || ''}, ${s.visual?.style || 'cinematic'}, ${s.visual?.composition || 'wide'}`.trim(),
        camera: s.camera || 'push_in',
        transition: s.transition || 'cut',
        emotion: s.emotion || 'neutral',
        caption_focus: s.caption?.focus || '',
        caption: s.caption?.fullText || s.narration || '',
      })),
      voice: {
        style: 'documentary',
        speed: 1.05,
        emotion: emotion === 'shock' || emotion === 'excitement' ? 'excited' : emotion === 'tension' ? 'urgent' : 'informative',
        pause_after_hook: 500,
      },
      retention: {
        pattern: emotion === 'shock' || emotion === 'curiosity' ? 'open loop' : 'sequential',
        hook_refresh: 15,
        first_3_seconds: {
          goal: 'stop_scroll',
          pattern: emotion === 'shock' ? 'shock' : emotion === 'curiosity' ? 'mystery' : emotion === 'excitement' ? 'energy' : 'question',
        },
        middle: {
          pattern: 'reveal_every_5_seconds',
          hooks: Math.max(2, Math.ceil((directorStory?.scenePlan || []).length / 3)),
        },
        ending: {
          pattern: 'follow_trigger',
          cta: directorStory?.cta || 'Follow NEWS-MONSTER for more.',
        },
      },
      cta: directorStory?.cta || 'Follow NEWS-MONSTER for more.',
      category,
      brand_color: brandColor || catStyle.color,
    }
  }

  _angleFromEmotion(emotion) {
    const angles = {
      shock: 'unexpected disruption', curiosity: 'hidden truth reveal',
      awe: 'industry milestone', tension: 'looming consequence',
      excitement: 'paradigm shift', neutral: 'developing story',
    }
    return angles[emotion] || 'technology disruption'
  }

  _audienceFor(category) {
    const audiences = {
      gaming: 'gamers', ai: 'tech enthusiasts', space: 'science fans',
      sports: 'sports fans', science: 'science enthusiasts',
      finance: 'investors', health: 'health-conscious viewers',
    }
    return audiences[category] || 'tech enthusiasts'
  }
}
