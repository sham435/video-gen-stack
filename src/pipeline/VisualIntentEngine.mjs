// Visual Intent Engine — turns scene meaning into a visual intent manifest,
// then scores candidate images by weighted relevance so the renderer never
// picks a generic clip that doesn't support the story.
const WEIGHTS = { topic: 0.40, brand: 0.20, emotion: 0.15, viewer: 0.15, quality: 0.10 }

const BRAND_TERMS = {
  apple: ['iphone', 'siri', 'ios', 'macbook', 'apple'], samsung: ['galaxy', 'samsung'],
  google: ['pixel', 'google', 'android'], microsoft: ['microsoft', 'windows', 'xbox'],
  openai: ['openai', 'chatgpt', 'gpt'], tesla: ['tesla'], nvidia: ['nvidia', 'gpu', 'rtx'],
  meta: ['meta', 'facebook', 'instagram'], amazon: ['amazon', 'aws', 'alexa'],
}

const EMOTION_TERMS = {
  shock: ['explosion', 'surprise', 'impact'], curiosity: ['mystery', 'question', 'hidden'],
  awe: ['spectacular', 'amazing', 'wonder'], excitement: ['celebration', 'energy', 'launch'],
  tension: ['drama', 'dark', 'suspense'], neutral: ['clean', 'simple', 'studio'],
}

export class VisualIntentEngine {
  constructor() {
    this.brandTerms = BRAND_TERMS
  }

  // Build the intent manifest from a scene + article
  buildIntent(scene, article) {
    const title = (article?.title || '').toLowerCase()
    const narration = (scene.narration || scene.caption || '').toLowerCase()
    const brand = Object.keys(this.brandTerms).find(b => title.includes(b) || narration.includes(b)) || null

    return {
      sceneId: scene.id || 0,
      topic: (article?.title || '').slice(0, 40),
      emotion: scene.emotion || 'neutral',
      intent: this._intentFor(scene.type, article?.category),
      brand,
      mustShow: this._mustShow(title, narration, brand),
      avoid: this._avoidFor(scene.type),
      brandTerms: brand ? this.brandTerms[brand] : [],
    }
  }

  _intentFor(sceneType, category) {
    const map = {
      hook: 'attention-grabbing subject', fact: 'product/entity reveal',
      reveal: 'the big moment', explanation: 'context + diagram',
      retention: 'suspenseful visual', close: 'brand + call to action',
    }
    return map[sceneType] || 'story-relevant visual'
  }

  _mustShow(title, narration, brand) {
    const words = title.replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length > 3)
    return [...new Set([...(brand ? this.brandTerms[brand] : []), ...words.slice(0, 3)])].slice(0, 5)
  }

  _avoidFor(sceneType) {
    const avoid = ['generic robot', 'abstract stock', 'random animation']
    if (sceneType === 'hook') avoid.push('long establishing shot')
    return avoid
  }

  // Score a candidate image URL against the intent manifest
  scoreCandidate(url, intent) {
    const slug = decodeURIComponent(url || '').toLowerCase()
    let topic = 0, brand = 0, emotion = 0, viewer = 0

    // Topic match (40%)
    const mustHits = (intent.mustShow || []).filter(term => slug.includes(term)).length
    topic = intent.mustShow?.length ? Math.round((mustHits / Math.min(3, intent.mustShow.length)) * 100) : 40

    // Brand match (20%)
    const brandHits = (intent.brandTerms || []).filter(term => slug.includes(term)).length
    brand = intent.brandTerms?.length ? Math.round((brandHits / Math.min(2, intent.brandTerms.length)) * 100) : 20

    // Emotion match (15%)
    const emotionTerms = EMOTION_TERMS[intent.emotion] || []
    emotion = emotionTerms.some(t => slug.includes(t)) ? 85 : 55

    // Viewer relevance (15%) — landscape / high-resolution photos fill the
    // 16:9 canvas better, so prefer them.
    viewer = /w=1920|large2x|hd|landscape/.test(slug) ? 80 : 60

    // Quality (10%) — resolution signal
    const quality = /w=1920|large2x|hd/.test(slug) ? 85 : 70

    const score = Math.round(topic * WEIGHTS.topic + brand * WEIGHTS.brand + emotion * WEIGHTS.emotion + viewer * WEIGHTS.viewer + quality * WEIGHTS.quality)
    return { url, score, breakdown: { topic, brand, emotion, viewer, quality } }
  }

  // Rank a set of candidates, return best-first
  rankCandidates(urls, intent) {
    return (urls || [])
      .filter(Boolean)
      .map(url => this.scoreCandidate(url, intent))
      .sort((a, b) => b.score - a.score)
  }

  static get WEIGHTS() { return WEIGHTS }
}
