import { BrandStyleResolver, ANCHOR_CONFIG } from './BrandStyleResolver.mjs'

const HOOK_TEXT = {
  NOBODY_EXPECTED: 'NOBODY EXPECTED THIS MOVE',
  LOST_IN_RAIN: 'LOST IN RAIN 🌧️',
  BULLIED: 'BULLIED 😭',
  FELL_IN_RIVER: 'FELL IN RIVER 🌊',
  BROKEN_TOY: 'BROKEN DREAM 😭',
  LEFT_BEHIND: 'LEFT BEHIND 🚌',
  HUNGRY_STOLE: 'HUNGRY FOR CHANGE 🍌',
  SHOCKING_NUMBER: 'SHOCK NUMBER',
}

// Blacklist — never render on any video frame or cover.
const BAD_OVERLAYS = new Set([
  'ACTUALLY SEE', 'ACTUALLY', 'SEE HOW', 'SEE WHY', 'SEE WHAT',
  'THIS IS', 'HERE IS', 'LOOK AT', 'CHECK OUT',
])

function sanitizeOverlay(text) {
  const up = (text || '').toUpperCase().trim()
  if (!up || BAD_OVERLAYS.has(up)) return null
  return up
}

export class CoverConceptEngine {
  constructor(aiProvider = null) {
    this.ai = aiProvider
    this.resolver = new BrandStyleResolver()
  }

  async generate(article, options = {}) {
    if (this.ai) {
      try {
        const result = await this.ai.generate([
          {
            role: 'system',
            content: `You are ${ANCHOR_CONFIG.label}, a visual anchor for a news video channel. Given a news headline, category, and summary, extract a cover concept as JSON.

NEVER use these phrases as overlay text: "ACTUALLY SEE", "ACTUALLY", "SEE HOW", "SEE WHY", "SEE WHAT", "THIS IS", "HERE IS", "LOOK AT", "CHECK OUT". Use punchy 2-4 word badges instead (e.g. "ROBOTAXI LEAK", "RECORD HIGH", "BREAKING").

Output ONLY JSON:
{
  "subject": "primary subject (company/product/entity)",
  "visual_keywords": ["3 specific objects for the background"],
  "mood": "one word: hype|breaking|mysterious|epic|serious|futuristic|energetic|discovery",
  "brand_color": "#HEX",
  "headline_style": "breaking|reveal|question|stat",
  "overlay_text": "short 2-4 word teaser badge (e.g. SWITCH 2 LEAK, XBOX VS PS5)"
}`
          },
          {
            role: 'user',
            content: `Title: ${article.title || ''}\nCategory: ${article.category || 'technology'}\nSummary: ${(article.description || '').slice(0, 400)}`
          }
        ], { json: true })

        if (result && (result.subject || result.visual_keywords)) {
          const fallback = this._deterministic(article)
          return {
            subject: result.subject || fallback.subject,
            visualKeywords: result.visual_keywords || fallback.visualKeywords,
            mood: result.mood || fallback.mood,
            brandColor: result.brand_color || fallback.brandColor,
            headlineStyle: result.headline_style || 'breaking',
            overlayText: sanitizeOverlay(result.overlay_text) || fallback.overlayText,
            algorithm: fallback.algorithm,
            source: 'ai',
          }
        }
      } catch (e) {
        console.log(`[CoverConcept] AI failed, using deterministic: ${e.message}`)
      }
    }
    return { ...this._deterministic(article), source: 'deterministic' }
  }

  _deterministic(article) {
    const title = article.title || 'Tech News'
    const category = article.category || 'technology'
    const resolved = this.resolver.resolve(title, category)
    const algo = resolved.algorithm
    const words = title.replace(/[^a-zA-Z0-9 ]/g, ' ').split(' ').filter(w => w.length > 3)
    const subject = resolved.brand || (words[0] || 'TECH').toUpperCase()
    const overlay = HOOK_TEXT[algo.hook] || resolved.anchorHook
    return {
      subject,
      visualKeywords: [algo.visual.pexels, algo.arc.toLowerCase().replace(/_/g, ' '), `${category} ${algo.hook.toLowerCase()}`],
      mood: resolved.mood,
      brandColor: resolved.brandColor,
      headlineStyle: 'breaking',
      overlayText: algo.hook === 'SHOCKING_NUMBER' ? `$${(algo.seed % 90) + 10}B SHOCK` : overlay,
      style: algo.visual.prompt,
      algorithm: algo,
      hash: algo.hash,
    }
  }
}
