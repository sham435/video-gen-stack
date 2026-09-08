import { VisualIntentEngine } from './VisualIntentEngine.mjs'

// Semantic Visual Ranking V2 — converts the CompositionJudge from a quality
// gate into an active visual selection optimizer.
//
// Ranks the candidate pool by lexical-semantic similarity between the
// scene/article meaning and each candidate's image slug, blended with the
// VisualIntent manifest (brand/mustShow/avoid/emotion terms). The engine
// calls rerank() when the judge flags visual_unrelated, excluding the
// current selection so a better scene asset is picked automatically.
//
// Deterministic + offline — CI-safe. An embedding scorer can be plugged in
// later without changing the caller interface.
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'is', 'are', 'was', 'were', 'will', 'has', 'have', 'its', 'their', 'what', 'when', 'why', 'how', 'new', 'about', 'over', 'after', 'into', 'them', 'his', 'her', 'you', 'your', 'our', 'not', 'but', 'they', 'these', 'those'])
const SLUG_NOISE = new Set(['pexels', 'photo', 'images', 'image', 'photos', 'cdn', 'com', 'http', 'https', 'www', 'jpeg', 'jpg', 'png', 'webp', 'id', 'view'])
const EMOTION_TERMS = {
  shock: ['explosion', 'surprise', 'impact'], curiosity: ['mystery', 'question', 'hidden'],
  awe: ['spectacular', 'amazing', 'wonder'], excitement: ['celebration', 'energy', 'launch'],
  tension: ['drama', 'dark', 'suspense'], neutral: ['clean', 'simple', 'studio'],
}

export class SemanticVisualRankerV2 {
  constructor(options = {}) {
    this.visualIntent = new VisualIntentEngine()
    this.memory = options.memory || null
  }

  _keywords(...texts) {
    const out = new Set()
    for (const t of texts) {
      for (const w of String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ')) {
        if (w.length > 3 && !STOPWORDS.has(w)) out.add(w)
      }
    }
    return [...out].slice(0, 8)
  }

  _slugWords(url) {
    const cleaned = decodeURIComponent(String(url || '').split('?')[0]).toLowerCase()
    return cleaned.split(/[/._\-]+/).filter(w => w.length > 2 && !SLUG_NOISE.has(w))
  }

  // Pure lexical-semantic overlap of story keywords vs image slug
  _semanticScore(url, scene, article, intent) {
    const keywords = this._keywords(article?.title, scene.narration, scene.caption)
    const slugWords = this._slugWords(url)
    if (keywords.length === 0 || slugWords.length === 0) return 40

    const hits = keywords.filter(k => slugWords.some(w => w === k || w.includes(k) || k.includes(w)))
    let score = Math.round((hits.length / Math.min(3, keywords.length)) * 75) + 20

    // Intent-aware boosts/penalties
    if ((intent.brandTerms || []).some(t => slugWords.includes(t))) score += 12
    if ((intent.mustShow || []).some(t => slugWords.includes(t))) score += 10
    const avoidHits = (intent.avoid || []).filter(t => String(url || '').toLowerCase().includes(t))
    if (avoidHits.length) score -= 30
    const emotionTerms = EMOTION_TERMS[intent.emotion] || []
    if (emotionTerms.some(t => slugWords.includes(t))) score += 8
    if (/w=1920|large2x|hd/.test(url || '')) score += 5

    return Math.max(0, Math.min(99, score))
  }

  // Rank candidates best-first, blending semantic similarity (60%) with the
  // VisualIntent weighted score (40%). Optionally exclude already-used URLs.
  rerank(candidates, scene, article = {}, options = {}) {
    const intent = this.visualIntent.buildIntent(scene, article)
    return (candidates || [])
      .filter(Boolean)
      .filter(url => !(options.exclude || []).includes(url))
      .map(url => {
        const semantic = this._semanticScore(url, scene, article, intent)
        const intentScore = this.visualIntent.scoreCandidate(url, intent).score
        return { url, score: Math.round(0.6 * semantic + 0.4 * intentScore), semantic, intent: intentScore }
      })
      .sort((a, b) => b.score - a.score)
  }

  // Judge-feedback optimization: pick a different asset for a flagged scene.
  // Mutates the scene in place and returns the new selection or null.
  applyFeedback(scene, article = {}) {
    const verdict = scene.judge
    const flagged = verdict && (verdict.issues?.includes('visual_unrelated') || verdict.recommendation === 'regenerate_scene')
    if (!flagged) return null

    const pool = [...new Set([...(scene.visualPlan?.images || []), ...(scene.images || [])])]
    if (pool.length < 2) return null

    const reranked = this.rerank(pool, scene, article, { exclude: [scene.image] })
    const best = reranked[0]
    if (!best) return null

    scene.image = best.url
    scene.bRoll = best.url
    scene.images = reranked.slice(0, 4).map(r => r.url)
    scene.visualRelevanceScore = best.score
    scene.visualReranked = true
    this.memory?.learn('visual_unrelated', { status: 'resolved', preventedBy: 'SemanticVisualRankerV2', preferredFix: 'rerank_candidates' })
    return best
  }
}
