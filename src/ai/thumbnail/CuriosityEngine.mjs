// Curiosity Engine — generates curiosity-gap titles from article signals.
//
// Seven curiosity types, each producing a different packaging angle so the
// channel never repeats a template (no more "HIDDEN X REVEALED" identity):
//
//   1. unexpected_discovery  — Nobody Expected This About X
//   2. contradiction         — X Said One Thing, Then Did This
//   3. before_after          — How X Changed Overnight
//   4. timeline_reveal       — What Happened After X
//   5. expert_disagreement   — Experts Disagree On X
//   6. future_prediction     — X Just Set Up What Comes Next
//   7. missing_information   — The Detail Everyone Missed

// Generic all-caps words never serve as the subject brand
const GENERIC_WORDS = new Set([
  'FEATURES', 'TRUTH', 'ABOUT', 'NEWS', 'UPDATE', 'REVEAL', 'BREAKING',
  'ANNOUNCEMENT', 'SECRET', 'EXPOSED', 'DISCOVERY', 'REVEALED',
  'HIDDEN', 'SHOCKING', 'DETAILS', 'DETAIL', 'STORY', 'TECH', 'ALERT',
])

// Extract the strongest topical keyword from an article title. Shared by the
// Curiosity Engine, the TopicCtaBuilder, and the PinnedCommentBuilder.
export function subjectOf(article, { forbidden = [] } = {}) {
  const title = (article?.title || '')
    .replace(/[^a-zA-Z0-9 .-]/g, ' ')
    .replace(/\s+/g, ' ').trim()
  // Strongest: entity followed by a number (iOS 27, ChatGPT 5) — checked
  // on the raw title because short numbers get filtered below
  const numbered = title.match(/\b([A-Za-z][A-Za-z0-9]+)\s+\d+(?:\.\d+)?\b/)
  if (numbered) return { brand: numbered[1].trim(), topic: numbered[1].trim() }
  const words = title.split(' ').filter(w => w.length > 2)
  // Forbidden packaging words and generic labels are never the subject
  const clean = words.filter(w => !forbidden.includes(w.toLowerCase()) && !GENERIC_WORDS.has(w.toUpperCase()))
  const cleanTitle = clean.join(' ')
  // Then: uppercase brand/entity token
  const brand = cleanTitle.match(/\b([A-Z][A-Z0-9.]{1,}|[A-Z][a-z]{2,})\b/)
  if (brand) return { brand: brand[1].trim(), topic: clean.slice(0, 3).join(' ') || brand[1] }
  return { brand: null, topic: clean.slice(0, 3).join(' ') || 'It' }
}

export class CuriosityEngine {
  constructor(options = {}) {
    this.forbidden = options.forbidden || ['hidden', 'revealed', 'secret', 'shocking', "you won't believe", 'exposed', 'buried']
  }

  // Extract the strongest topical keyword from an article title
  _subject(article) {
    return subjectOf(article, { forbidden: this.forbidden })
  }

  // Deterministic generator — one candidate per curiosity type (7 angles)
  generate(article, title = article?.title || '') {
    const { brand, topic } = this._subject(article)
    const b = brand || topic
    return {
      title,
      candidates: [
        { type: 'unexpected_discovery', title: `Nobody Expected This About ${b}`, reason: 'unexpected discovery — strongest curiosity gap' },
        { type: 'contradiction', title: `${b} Said One Thing, Then Did This`, reason: 'contradiction — opens a belief conflict' },
        { type: 'before_after', title: `How ${b} Changed Overnight`, reason: 'before/after — creates a change arc' },
        { type: 'timeline_reveal', title: `What Happened After ${b}`, reason: 'timeline reveal — promises the aftermath' },
        { type: 'expert_disagreement', title: `Experts Disagree On ${b}`, reason: 'expert disagreement — authority tension' },
        { type: 'future_prediction', title: `${b} Just Set Up What Comes Next`, reason: 'future prediction — stakes forward' },
        { type: 'missing_information', title: `The Detail Everyone Missed About ${b}`, reason: 'missing information — the overlooked detail' },
      ],
    }
  }

  isForbidden(text) {
    const t = (text || '').toLowerCase()
    return this.forbidden.find(w => t.includes(w)) || null
  }
}
