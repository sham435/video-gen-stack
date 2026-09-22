import { BrandStyleResolver } from '../visual/BrandStyleResolver.mjs'
import { seededFrom } from '../style/seeded-random.mjs'

const CATEGORY_VISUALS = {
  technology: { hero: 'cinematic close-up of a futuristic smartphone, AI holographic interface, dramatic lighting, dark premium technology background, 8K', style: 'premium tech magazine', mood: 'innovative futuristic' },
  ai: { hero: 'futuristic AI neural interface, glowing holographic brain, dark cinematic environment, cyberpunk lighting, 8K', style: 'sci-fi editorial', mood: 'innovative futuristic' },
  gaming: { hero: 'next generation gaming console, neon cyberpunk environment, dramatic cinematic lighting, esports magazine style, 8K', style: 'esports magazine', mood: 'hype' },
  space: { hero: 'Mars colony, astronaut silhouette, deep space background, National Geographic documentary style, 8K', style: 'documentary', mood: 'epic' },
  science: { hero: 'laboratory research, microscopic detail, blue scientific lighting, photorealistic, 8K', style: 'scientific journal', mood: 'discovery' },
  politics: { hero: 'documentary photojournalism, authoritative newsroom, dramatic lighting, 8K', style: 'news documentary', mood: 'serious' },
  finance: { hero: 'premium newsroom, stock market tickers, gold and navy accents, professional, 8K', style: 'financial report', mood: 'authoritative' },
  health: { hero: 'clean medical visualization, clinical white environment, professional, 8K', style: 'medical editorial', mood: 'trustworthy' },
  sports: { hero: 'peak action moment, dramatic stadium lighting, motion energy, 8K', style: 'sports broadcast', mood: 'energetic' },
  default: { hero: 'cinematic news scene, dramatic lighting, premium editorial quality, 8K', style: 'news editorial', mood: 'breaking' },
}

const OVERLAY_PAIRS = [
  ['AI REVEAL', 'GAME CHANGER'],
  ['EXCLUSIVE', 'BREAKTHROUGH'],
  ['BREAKING', 'NEW DETAILS'],
  ['FIRST LOOK', 'INNOVATION'],
  ['WHY IT', 'MATTERS'],
  ['THE TRUTH', 'BEHIND IT'],
  ['INSIDE', 'THE STORY'],
  ['NOBODY', 'EXPECTED THIS'],
  ['CHANGED', 'OVERNIGHT'],
  ['WHAT HAPPENED', 'NEXT'],
]

// ── High-CTR prompt refiner ────────────────────────────────────────────────
// Deterministic (no AI required) composition engine that turns a base image
// prompt into a refined, story-hook-tailored, Midjourney-style thumbnail
// prompt: named subjects + composition + environment + lighting + aura +
// quality modifiers + style flag. Hook-specific so each story tells a
// different visual story instead of the generic category card.

const HOOK_COMPOSITIONS = {
  NOBODY_EXPECTED:   { comp: 'Epic composition of {subject} back-to-back against a massive glowing adversary, striking fierce stances', env: 'rainy neon alley', aura: 'dramatic platform-exclusive aura (vibrant glow)', energy: 'intense sparks and motion blur' },
  SHOCKING_NUMBER:   { comp: 'A giant glowing number towering over {subject} looking up in disbelief', env: 'dystopian newsroom at night', aura: 'hot amber number glow casting long shadows', energy: 'floating data particles and shockwave rings' },
  LOST_IN_RAIN:      { comp: 'Lone silhouette of {subject} under a flickering neon sign', env: 'rain-soaked city street reflecting red and cyan', aura: 'cold blue rain haze with a warm rescue light in the distance', energy: 'water splash freeze-frame and lens streaks' },
  BULLIED:           { comp: 'Crowd of looming shadows encircling one defiant {subject} standing tall', env: 'moody underpass lit by a single spotlight', aura: 'white-hot defiance aura around the subject', energy: 'dust particles kicked up, slow-motion tension' },
  FELL_IN_RIVER:     { comp: 'A fallen giant of {subject} surging from rushing water, fist raised', env: 'storm river with debris and a broken barrier', aura: 'electric blue current energy', energy: 'splashing water droplets frozen mid-air' },
  BROKEN_TOY:        { comp: 'Close-up of {subject} rebuilding a shattered object, hands glowing with fix-power', env: 'dim workshop with hanging work lights', aura: 'spark fountain from the repair', energy: 'tools in motion, hope-lit face' },
  LEFT_BEHIND:       { comp: 'One figure of {subject} sprinting toward a blinding gate of light', env: 'empty platform at dawn, train leaving in the distance', aura: 'golden hour flare cutting the frame', energy: 'speed lines and airborne dust' },
  HUNGRY_STOLE:      { comp: '{subject} grabbing the last glowing resource with both hands', env: 'crowded market alley at midnight', aura: 'neon greed-light on grasping hands', energy: 'flying scraps and flashbulbs' },
}

const CATEGORY_ENV = {
  gaming: 'photorealistic 8k game scene, hyper-detailed assets, torn costumes, high-energy competitive poster',
  technology: 'premium tech editorial, sleek surfaces, hyper-detailed product lighting',
  sports: 'peak-action stadium moment, dramatic arena lighting, high-frame-rate energy',
  space: 'epic documentary scale, deep-space atmosphere, National Geographic realism',
  science: 'laboratory realism, macro detail, scientific break light',
  finance: 'authoritative financial drama, ticker glow, premium boardroom lighting',
  default: 'cinematic editorial realism, bold contrast',
}

const PROMPT_SUFFIX = 'cinematic volumetric lighting, bold contrast, explosive action atmosphere, hyper-detailed, 8k, high-CTR thumbnail composition'

export function extractNames(title) {
  // Join consecutive Proper-noun tokens into full names ("Terry Bogard" is ONE
  // subject, not two) while skipping capitalized stopwords like "And"/"At".
  const STOP = new Set(['The','And','At','In','On','For','With','From','Over','Under','Into','Vs','Versus','This','That','New','Top','Next','Why','What','When','How'])
  const tokens = String(title || '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  const names = []
  let cur = []
  for (const t of tokens) {
    if (/^[A-Z][a-z]{1,}/.test(t) && !STOP.has(t)) cur.push(t)
    else { if (cur.length) { names.push(cur.join(' ')); cur = [] } }
  }
  if (cur.length) names.push(cur.join(' '))
  return names
}

export function stripMjFlags(prompt = '') {
  // Midjourney-style flags (--ar, --stylize …) are meaningless tokens for
  // SD.cpp / SDXL / FAL image backends — strip them before generation.
  return String(prompt).replace(/\s*--[\w]+(?:\s+[\w:/.,]+)?/g, '').trim()
}

export function refineHighCtrPrompt(base, article = {}, opts = {}) {
  const hook = (opts.hook || article.hook || 'NOBODY_EXPECTED').toUpperCase()
  const cat = (article.category || 'default').toLowerCase()
  const comp = HOOK_COMPOSITIONS[hook] || HOOK_COMPOSITIONS.NOBODY_EXPECTED
  const subject = opts.subject || article.brand || (article.title || 'the hero')
  // Named subjects: pull the 2 strongest Proper-Noun phrases from the title
  // so the prompt names the actual story players (e.g. "Terry Bogard and Rock
  // Howard") instead of a generic "hero".
  const named = extractNames(article.title)
  const subjectA = named[0] || subject
  const subjectB = named.length > 1 ? named[1] : subjectA
  const env = CATEGORY_ENV[cat] || CATEGORY_ENV.default
  const aspect = opts.aspect === '16:9' ? '--ar 16:9' : '--ar 9:16'
  const stylize = opts.stylize ?? 250
  const subj = subjectA === subjectB ? subjectA : `${subjectA} and ${subjectB}`
  const body = comp.comp.replace(/\{subject\}/g, subj)
  return [
    `${body}, massive glow in the background, ${comp.env}, ${comp.aura}, ${comp.energy}`,
    `${env}`,
    `${PROMPT_SUFFIX}`,
    `${aspect} --stylize ${stylize}`,
  ].join(', ')
}

// Bad overlays the AI sometimes generates from headlines — must never render on video.
const BAD_OVERLAYS = new Set([
  'ACTUALLY SEE', 'ACTUALLY', 'SEE HOW', 'SEE WHY', 'SEE WHAT',
  'THIS IS', 'HERE IS', 'LOOK AT', 'CHECK OUT',
])

function sanitizeOverlay(text) {
  const up = (text || '').toUpperCase().trim()
  if (!up || BAD_OVERLAYS.has(up)) return null
  // Also reject if it's just 1 word that's a common verb/preposition
  if (up.split(/\s+/).length === 1 && /^(THE|A|AN|IS|ARE|WAS|WERE|HAS|HAVE|HAD|DO|DOES|DID|CAN|COULD|WILL|WOULD|SHOULD|MAY|MIGHT|SEE|ACTUALLY|LOOK|CHECK|GET|GO|COME|TAKE|MAKE|USE|FIND|SHOW|TELL|ASK|SAY|SPEAK|HEAR|LISTEN|READ|WRITE|RUN|WALK|STOP|START|END|BEGIN|OPEN|CLOSE|PUSH|PULL|HOLD|KEEP|LET|PUT|SET|CUT|HIT|BEAT|WIN|LOSE|PLAY|PAUSE|WAIT|NEXT|BACK|DONE|OK|YES|NO|NOT|BUT|AND|OR|FOR|NOR|SO|YET|ALL|SOME|MANY|FEW|MORE|MOST|BEST|WORST|TOP|NEW|OLD|BIG|SMALL|GOOD|BAD|HIGH|LOW|FAST|SLOW|HOT|COLD|LONG|SHORT|EASY|HARD|TRUE|FALSE)$/.test(up)) return null
  return up
}

export class CoverDirector {
  constructor(aiProvider = null) {
    this.ai = aiProvider
    this.resolver = new BrandStyleResolver()
  }

  async analyzeStory(article, options = {}) {
    const fallback = this._deterministic(article)
    const ai = await this._aiConcept(article, { hook: fallback.algorithm?.hook || article.hook })
    // Style variant override for tournament mode
    const styleOverride = options.style ? this._styleVariant(options.style, fallback) : null
    // HIGH-CTR PROMPT REFINER: the hero_prompt that reaches the image generator
    // (Pexels fallback → SD.cpp → FAL) is now a refined, story-hook-tailored,
    // Midjourney-style thumbnail prompt (named subjects + composition +
    // environment + lighting + aura + quality flags). Prefer the AI's raw
    // refined prompt when present; otherwise refine the best deterministic base.
    const aiHero = ai.hero_prompt || ''
    // AI-authored prompts are already refined by the upgraded system prompt —
    // pass them through untouched. Deterministic/style-override bases are
    // short and generic, so wrap them in the high-CTR composition engine
    // (precedence: styleOverride → AI → deterministic fallback).
    const isAiSourced = !!aiHero && !styleOverride?.hero_prompt
    const baseForRefine = styleOverride?.hero_prompt || fallback.hero_prompt || ''
    const hook = fallback.algorithm?.hook || article.hook || 'NOBODY_EXPECTED'
    const brand = fallback.algorithm?.visual?.brand || ai.brand || fallback.brand || ''
    const refined = isAiSourced
      ? aiHero
      : baseForRefine
        ? refineHighCtrPrompt(baseForRefine, { ...article, brand, hook }, {
            hook,
            subject: brand || fallback.subject,
            aspect: options.aspect || '9:16',
          })
        : ''
    return {
      headline: article.title || 'Tech News',
      subject: ai.subject || fallback.subject,
      visual_style: styleOverride?.visual_style || ai.style || fallback.visual_style,
      mood: styleOverride?.mood || ai.mood || fallback.mood,
      accent_color: ai.brandColor || fallback.accent_color,
      hero_prompt: refined || styleOverride?.hero_prompt || ai.hero_prompt || fallback.hero_prompt,
      text_overlay: {
        top: sanitizeOverlay(styleOverride?.text_overlay?.top || ai.text_overlay?.top) || sanitizeOverlay(fallback.text_overlay?.top) || 'BREAKING',
        bottom: sanitizeOverlay(styleOverride?.text_overlay?.bottom || ai.text_overlay?.bottom) || sanitizeOverlay(fallback.text_overlay?.bottom) || 'NEW DETAILS'
      },
      keywords: ai.keywords || fallback.keywords,
      source: ai.source || 'deterministic',
      style_variant: options.style || null,
      algorithm: fallback.algorithm || ai.algorithm || null,
    }
  }

  _styleVariant(style, fallback) {
    const base = fallback
    switch (style) {
      case 'breaking':
        return { visual_style: 'breaking news broadcast', mood: 'breaking', text_overlay: { top: base.text_overlay?.top || 'BREAKING', bottom: 'NEW DETAILS' }, hero_prompt: 'high urgency newsroom, red alert lighting, breaking news ticker, 8K' }
      case 'cinematic':
        return { visual_style: 'cinematic film', mood: 'epic', hero_prompt: `${base.hero_prompt || base.subject}, cinematic film grade, anamorphic, dramatic, 8K` }
      case 'minimal':
        return { visual_style: 'minimal editorial', mood: 'clean', text_overlay: { top: base.text_overlay?.top, bottom: base.text_overlay?.bottom }, hero_prompt: 'clean minimal composition, negative space, soft even lighting, premium editorial' }
      case 'reaction':
        return { visual_style: 'reaction close-up', mood: 'emotional', hero_prompt: 'extreme close-up emotional subject, dramatic eyes, shallow depth of field, high contrast' }
      case 'data':
        return { visual_style: 'data visualization', mood: 'authoritative', hero_prompt: 'big numbers, data charts, infographic style, glowing data on dark background, professional' }
      default:
        return null
    }
  }

  async _aiConcept(article, opts = {}) {
    if (!this.ai) return {}
    try {
      const result = await this.ai.generate([
        {
          role: 'system',
          content: `You are a Cover Director for a high-CTR YouTube/Shorts news channel. Given a headline and category, output a cover brief as JSON.

Your hero_prompt must be a REFINED, high-CTR thumbnail prompt SPECIFICALLY TAILORED to this exact story hook — write it like a top Midjourney prompt:
- NAME the actual subjects/entities from the headline (e.g. "Terry Bogard and Rock Howard" not "two fighters")
- State the COMPOSITION explicitly (split-screen back-to-back, over-the-shoulder, extreme close-up, lone figure against X…)
- Give the ENVIRONMENT (rainy alley, neon room, stadium, office…) 
- Give LIGHTING + AURA (volumetric, neon glow, dramatic rim light…)
- Give MOTION/ENERGY (sparks, motion blur, dust, shockwave…)
- End with quality + style + aspect flags like: photorealistic 8k, cinematic volumetric lighting, bold contrast, high-energy poster, --ar 9:16 --stylize 250
The prompt is FOR AN IMAGE GENERATOR — no words about "thumbnail" UI, no text overlay instructions.

Output ONLY JSON:
{
  "subject": "main visual subject (named)",
  "hero_prompt": "refined high-CTR image prompt tailored to the story hook",
  "visual_style": "editorial style name",
  "mood": "one word",
  "accent_color": "#HEX",
  "text_overlay": { "top": "2-3 word badge", "bottom": "2-3 word badge" },
  "keywords": ["3 visual search terms"]
}`
        },
        {
          role: 'user',
          content: `Headline: ${article.title || ''}\nCategory: ${article.category || 'technology'}\nStory hook: ${opts.hook || 'NOBODY_EXPECTED'}\nSummary: ${(article.description || '').slice(0, 400)}`
        }
      ], { json: true })
      if (!result || (!result.subject && !result.hero_prompt)) return {}
      return {
        subject: result.subject,
        hero_prompt: result.hero_prompt,
        visual_style: result.visual_style,
        mood: result.mood,
        accent_color: result.accent_color,
        text_overlay: { top: sanitizeOverlay(result.text_overlay?.top) || 'BREAKING', bottom: sanitizeOverlay(result.text_overlay?.bottom) || 'NEW DETAILS' },
        keywords: result.keywords || [],
        source: 'ai',
      }
    } catch { return {} }
  }

  _deterministic(article) {
    const category = (article.category || 'default').toLowerCase()
    const catVisual = CATEGORY_VISUALS[category] || CATEGORY_VISUALS.default
    // 48-algorithm diversity: resolve() now returns algorithm + shifted color +
    // per-algorithm visual style, so covers never repeat the same look twice.
    const resolved = this.resolver.resolve(article.title || '', category)
    const algo = resolved.algorithm
    const brand = resolved.brand
    const subject = brand || (article.title || 'TECH').split(' ').slice(0, 2).join(' ')
    // Deterministic overlay pick — seeded by title so identical input → identical cover.
    const idx = seededFrom(article.title || '') % OVERLAY_PAIRS.length
    const [top, bottom] = OVERLAY_PAIRS[idx]
    const words = (article.title || '').replace(/[^a-zA-Z0-9 ]/g, ' ').split(' ').filter(w => w.length > 3)
    const badge = brand ? brand.toUpperCase() : (words[0] || 'TECH').toUpperCase()
    return {
      subject,
      brand: brand || subject,
      visual_style: algo?.visual?.prompt || catVisual.style,
      mood: catVisual.mood,
      accent_color: resolved.brandColor || '#E10600',
      hero_prompt: catVisual.hero,
      text_overlay: { top: badge, bottom },
      keywords: [algo?.visual?.pexels, ...words.slice(0, 2)].filter(Boolean),
      source: 'deterministic',
      algorithm: algo,
    }
  }
}
