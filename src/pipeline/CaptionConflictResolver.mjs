// Caption Conflict Resolver — semantic-aware caption cleanup.
// The old TextConflictResolver removed the emphasis keyword from captions
// blindly, which mangled natural language ("The real price of the headset" ->
// "The real of the headset"). This resolver only strips when the text is a
// true duplicate:
//
//   Case 1  keyword-style caption (all-caps) that repeats the emphasis word
//           -> strip the repeated keyword ("SECRET APPLE LEAK" -> "APPLE LEAK")
//   Case 2  mid-sentence / compound-noun usage -> keep
//           ("The real price of the headset", "Battery life improved by 40%")
//   Case 3  caption that only re-states the headline -> strip headline words
//           ("Apple Vision Pro price details revealed" -> "Details revealed")
//
// Stripping never leaves a gap: a word with kept words on both sides stays.

const PREPOSITIONS = new Set(['OF', 'IN', 'FOR', 'AT', 'WITH', 'FROM', 'TO', 'BY', 'ON', 'AFTER', 'BEFORE', 'ABOUT', 'INTO', 'THROUGH', 'UNDER', 'OVER'])
const STOPWORDS = new Set(['A', 'AN', 'THE', 'AND', 'OR', 'BUT', 'IS', 'ARE', 'WAS', 'WERE', 'HAS', 'HAVE', 'HAD', 'THIS', 'THAT', 'IT', 'ITS', 'BE', 'BEEN', 'NOT', 'NO'])

export class CaptionConflictResolver {
  // { focus, caption, headline } -> { caption, visible }
  resolve({ focus, caption, headline = '' } = {}) {
    const text = String(caption || '')
    if (!text.trim()) return { caption: text, visible: true }

    const focusWords = this._words(focus)
    const keywordStyle = !/[a-z]/.test(text) // all-uppercase caption

    let words = text.split(/\s+/)

    // Focus-word stripping (grammar-aware)
    if (focusWords.size) {
      words = words.filter((w, i) => {
        if (!focusWords.has(this._norm(w))) return true
        if (keywordStyle) return false // case 1: keyword captions repeat the emphasis
        return this._isEssential(words, i) // case 2: keep grammatical usage
      })
    }

    // Headline-word stripping (case 3): only for sentence-style captions,
    // and never leaving a gap between kept words
    if (headline && !keywordStyle) {
      const headlineWords = this._words(headline)
      const stripped = new Array(words.length).fill(false)
      for (let i = 0; i < words.length; i++) {
        if (!headlineWords.has(this._norm(words[i]))) continue
        const predKept = i > 0 && !stripped[i - 1] && !headlineWords.has(this._norm(words[i - 1]))
        const succKept = i < words.length - 1 && !headlineWords.has(this._norm(words[i + 1]))
        if (!(predKept && succKept)) stripped[i] = true
      }
      words = words.filter((_, i) => !stripped[i])
    }

    const clean = words.join(' ')
    if (!clean.trim()) return { caption: '', visible: false }
    return { caption: clean, visible: true }
  }

  // A word is grammatically essential when it has a preceding word (compound
  // phrase like "real price", "stock price") or heads a compound noun at the
  // start of the caption ("Battery life", "AI model").
  _isEssential(words, idx) {
    if (idx > 0) return true
    const next = words[idx + 1]?.toUpperCase()
    if (!next) return false
    return !PREPOSITIONS.has(next) && !STOPWORDS.has(next)
  }

  _norm(word) {
    return String(word || '').replace(/[^\w]/g, '').toUpperCase()
  }

  _words(text) {
    return new Set(String(text || '').toUpperCase().split(/\s+/).map(w => w.replace(/[^\w]/g, '')).filter(Boolean))
  }
}
