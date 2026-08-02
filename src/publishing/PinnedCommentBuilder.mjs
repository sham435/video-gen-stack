import { subjectOf } from '../ai/thumbnail/CuriosityEngine.mjs'

// Pinned Comment Builder — the community loop for a new video.
//
// Real analytics: the S27 Ultra leak hit 100% "stayed to watch" and 20% CTR
// but zero likes/comments/shares. A pinned question converts the retained
// audience into commenters, which signals interest back to the algorithm.
// Builds a topic-specific question deterministically (no admin intervention).
const QUESTION_BANK = {
  technology: (b, a, c) => `Which upgrade are you more excited for: ${a || 'the new camera'} or ${c || 'the battery'}? 📸🔋`,
  ai: (b, a, c) => `Will ${a || 'this model'} actually beat ${c || 'the competition'}? Tell us what you think 🤖`,
  science: (b, a, c) => `What should researchers investigate ${a || 'next'}: ${c || 'the anomaly'}? 🚀`,
  gaming: (b, a, c) => `Day-one buy or wait for reviews on ${a || 'this launch'}? 🎮`,
  finance: (b, a, c) => `Are you bullish or bearish after ${a || 'this move'}? 📈📉`,
  space: (b, a, c) => `Would you fly on ${a || 'this mission'}? Yes or no 🚀`,
  sports: (b, a, c) => `Who wins the rematch: ${a || 'the underdog'} or ${c || 'the favorite'}? 🏆`,
  default: (b, a, c) => `What do you think about ${a || 'this news'} — ${c || 'good or bad'} for the industry? 👇`,
}

export class PinnedCommentBuilder {
  constructor() {
    this.forbidden = ['hidden', 'revealed', 'secret', 'shocking', "you won't believe", 'exposed', 'buried']
    this.stopwords = new Set(['about', 'their', 'there', 'which', 'these', 'those', 'after', 'before', 'being', 'while', 'still', 'massive', 'between', 'through', 'during', 'without', 'leaked', 'leak', 'reported', 'according', 'including', 'beginning', 'month', 'announced', 'release', 'new'])
  }

  _aspects(article) {
    const text = `${article?.description || ''} ${article?.title || ''}`
      .toLowerCase().replace(/[^a-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
    const words = text.split(' ').filter(w => w.length > 4 && !this.stopwords.has(w))
    return [words[0], words[1]].filter(Boolean)
  }

  build(article) {
    const { brand, topic } = subjectOf(article, { forbidden: this.forbidden })
    const category = (article?.category || 'default').toLowerCase()
    const [a, c] = this._aspects(article)
    const bank = QUESTION_BANK[category] || QUESTION_BANK.default
    return {
      question: bank(brand || 'NEWS-MONSTER', a, c),
      brand: brand || 'NEWS-MONSTER',
      topic: topic,
      hint: 'Pin this comment to the video after publishing (YouTube API can create it; pinning is manual)',
    }
  }
}
