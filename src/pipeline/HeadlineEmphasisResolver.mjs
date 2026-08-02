// Headline Emphasis Resolver — picks the best animated keyword for a scene.
// The headline (BREAKING banner) and the emphasis (animated keyword) are both
// derived from the same story, so they can pick the same word and visually
// duplicate it. This resolver scores candidate keywords and chooses the one
// that creates curiosity without repeating information the headline already
// shows.
//
// Scoring rules (calibrated so the SECRET APPLE VISION PRO example resolves
// SECRET -> PRICE for technology):
//   base 100
//   - 60  word already visible in the headline
//   - 80  brand / person word (already implied by the headline subject)
//   + 25  category-preferred word (PRICE, SPEED, RESIGNS, UPSET, ...)
//   + 10  emotional word (SECRET, SHOCKING, REVEALED, ...)
//   + 40  word taught by production memory learning
//   +  5  stability bias for the current keyword (only replace when clearly better)

export const STOPWORDS = new Set([
  'BREAKING', 'THE', 'A', 'AN', 'AND', 'OR', 'BUT', 'IN', 'ON', 'AT', 'OF', 'FOR',
  'TO', 'WITH', 'BY', 'FROM', 'IS', 'ARE', 'WAS', 'WERE', 'HAS', 'HAVE', 'HAD',
  'ITS', 'IT', 'THIS', 'THAT', 'THESE', 'THOSE', 'NEW', 'ALL', 'ANY', 'OVER',
  'UNDER', 'BEFORE', 'AFTER', 'BETWEEN', 'INTO', 'THROUGH', 'DURING', 'ABOUT',
  'OUT', 'UP', 'DOWN', 'OFF', 'BE', 'BEEN', 'BEING', 'DO', 'DOES', 'DID', 'NOT',
  'NO', 'YES', 'MORE', 'MOST', 'SOME', 'SUCH', 'THAN', 'TOO', 'VERY', 'CAN',
  'WILL', 'JUST', 'SHOULD', 'COULD', 'WOULD', 'MAYBE', 'MAY', 'MIGHT', 'AGAIN',
  'ONCE', 'NEVER', 'ALWAYS', 'HERE', 'THERE', 'WHERE', 'WHEN', 'WHY', 'HOW',
  'SAYS', 'SAID', 'ANNOUNCES', 'ANNOUNCED', 'REPORTED',
  'REPORT', 'COMING', 'GETS', 'GET', 'LEAKED', 'LEAK', 'EVERY', 'YOUR', 'YOU',
])

const EMOTIONAL = new Set([
  'SECRET', 'SHOCKING', 'SHOCK', 'HIDDEN', 'REVEALED', 'WARNING', 'MISSED',
  'CHANGED', 'CHANGE', 'UPSET', 'MASSIVE', 'HISTORIC', 'CRAZY', 'INSANE',
  'CHANGES', 'EVERYTHING', 'NOTHING', 'NOBODY', 'OMG', 'BREAKING', 'FINALLY',
])

const CATEGORY_PREFERRED = {
  technology: ['PRICE', 'FEATURE', 'SPEED', 'BATTERY', 'AI', 'CAMERA', 'CHIP', 'SPECS', 'LAUNCH', 'SCREEN'],
  politics: ['RESIGNS', 'CHAOS', 'SCANDAL', 'VOTE', 'LAWSUIT', 'CRISIS', 'BACKLASH', 'DEEPLY', 'PROMISES'],
  sports: ['FINAL', 'UPSET', 'RECORD', 'COMEBACK', 'CHAMPION', 'TRADE', 'INJURY', 'OVERTIME', 'SCORE'],
  business: ['PRICE', 'STOCK', 'PROFIT', 'BANKRUPTCY', 'MERGER', 'LAWSUIT', 'CUTS', 'BILLION'],
  entertainment: ['EXCLUSIVE', 'RETURN', 'SEASON', 'TRAILER', 'BREAKUP', 'SCANDAL', 'AWARD', 'DEBUT'],
  science: ['BREAKTHROUGH', 'DISCOVERY', 'STUDY', 'MISSION', 'FOUND', 'SOLAR', 'GENOME', 'SIGNAL'],
}

const BRAND_WORDS = new Set([
  'APPLE', 'IPHONE', 'IPAD', 'MACBOOK', 'GOOGLE', 'PIXEL', 'ANDROID', 'CHROME',
  'MICROSOFT', 'WINDOWS', 'XBOX', 'META', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP',
  'AMAZON', 'SAMSUNG', 'GALAXY', 'TESLA', 'NVIDIA', 'OPENAI', 'CHATGPT', 'GPT',
  'BIDEN', 'TRUMP', 'PARLIAMENT', 'CONGRESS', 'SENATE', 'PUTIN', 'X',
])

const GENERIC_BRAND_HINTS = ['CORP', 'INC', 'LTD', 'LLC', 'CEO', 'COMPANY', 'FIRM']

export class HeadlineEmphasisResolver {
  // Resolve the best emphasis keyword for a scene.
  //   { headline, title, current, category, lessons } -> string ('' if none)
  resolve({ headline, title, current, category = 'technology', lessons = [] } = {}) {
    const head = String(headline || '')
    const ttl = String(title || '')
    const candidates = this._candidates(ttl, current, category)
    if (!candidates.length) return current || ''

    const headlineWords = this._words(head)
    // A lesson only applies to the duplicate word it was learned for:
    // "when SECRET was the emphasis, REVEALED retained better" — never a
    // blanket bonus for every taught word.
    const lessonWords = (lessons || [])
      .filter(l => !category || !l.category || l.category === category)
      .filter(l => !current || !l.replaced || l.replaced === current.toUpperCase())
      .map(l => String(l.with || '').toUpperCase())

    let best = null
    let bestScore = -Infinity
    for (const cand of candidates) {
      const s = this.score(cand, { headlineWords, category, lessonWords, current })
      if (s > bestScore || (s === bestScore && best && cand.split(' ').length < best.split(' ').length)) {
        bestScore = s
        best = cand
      }
    }
    // Stability: keep the current keyword unless a clearly better word exists
    if (best && current && best.toUpperCase() === current.toUpperCase()) return current
    if (best && bestScore > 0) return best
    return current || ''
  }

  // Score a single candidate word.
  //   score(word, { headlineWords, category, lessonWords, current }) -> number
  score(word, { headlineWords = [], category = 'technology', lessonWords = [], current = '' } = {}) {
    const normalized = String(word || '').toUpperCase()
    if (!normalized) return -Infinity
    const words = normalized.split(' ')
    const single = words[0]

    let score = 100
    // Visible if any word of the candidate (or a stem variant, e.g.
    // REVEALS/REVEALED) already appears in the headline — animating it
    // would repeat on-screen text.
    if (words.some(w => this._visibleInHeadline(w, headlineWords))) score -= 60
    if (words.some(w => BRAND_WORDS.has(w)) || GENERIC_BRAND_HINTS.some(h => normalized.includes(h))) score -= 80
    if ((CATEGORY_PREFERRED[category] || []).includes(normalized) || (CATEGORY_PREFERRED[category] || []).includes(single)) score += 25
    if (EMOTIONAL.has(single)) score += 10
    if (lessonWords.includes(normalized) || lessonWords.includes(single)) score += 40
    if (current && normalized === String(current).toUpperCase()) score += 5
    return score
  }

  _visibleInHeadline(word, headlineWords) {
    if (headlineWords.has(word)) return true
    if (word.length < 5) return false
    const stem = word.slice(0, 5)
    for (const hw of headlineWords) {
      if (hw.length >= 5 && hw.slice(0, 5) === stem) return true
    }
    return false
  }

  // Candidate keywords: title words + the current keyword + category-preferred
  // words that appear in the title. Capped so resolution stays cheap.
  _candidates(title, current, category) {
    const seen = new Set()
    const out = []
    const push = (w) => {
      const norm = String(w || '').trim().toUpperCase()
      if (!norm || seen.has(norm)) return
      if (STOPWORDS.has(norm) || BRAND_WORDS.has(norm)) return
      seen.add(norm)
      out.push(norm)
    }
    const titleWords = String(title || '').split(/\s+/)
    // Single words first (favored over phrases by the tie-break), then
    // multi-word phrases (e.g. "VISION PRO")
    for (const w of titleWords) push(w)
    for (let i = 0; i < titleWords.length - 1; i++) {
      push(`${titleWords[i]} ${titleWords[i + 1]}`.toUpperCase())
    }
    push(current)
    for (const pref of CATEGORY_PREFERRED[category] || []) {
      if (String(title || '').toUpperCase().includes(pref)) push(pref)
    }
    return out.slice(0, 10)
  }

  _words(text) {
    return new Set(String(text || '').toUpperCase().split(/\s+/).map(w => w.replace(/[^\w]/g, '')).filter(Boolean))
  }
}
