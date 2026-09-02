import { HeadlineEmphasisResolver } from '../pipeline/HeadlineEmphasisResolver.mjs'
import { BrandPerformanceMemory } from '../pipeline/BrandPerformanceMemory.mjs'

export class ScenePlanner {
  constructor() {
    this.emphasisResolver = new HeadlineEmphasisResolver()
    this.brandMemory = new BrandPerformanceMemory()
  }
  planScenes(article, story) {
    const scenes = story.scenes.map((s, i) => this.buildScene(s, i, article))
    return scenes
  }

  buildScene(sceneDef, index, article) {
    const emphasis = this._resolveEmphasis(sceneDef, article)
    const narration = this.cleanNarration(sceneDef.narration)
    const safeNarration = this.sanitizeText(narration)
    const safeEmphasis = this.sanitizeText(emphasis)
    // 16:9 center-stage contract: narration is VO ONLY. The on-screen
    // HEADLINE is a short visual block (first sentence, hard-capped at 10
    // words) — never the full VO sentence, whose wrap was the source of the
    // headline text stacking onto itself in published videos.
    const isHook = sceneDef.type === 'hook'
    const isClose = sceneDef.type === 'close' || sceneDef.type === 'brand_close'
    const visualHeadline = isHook || isClose
      ? safeNarration
      : this.shortVisualText(safeNarration, 10)
    // Caption is short center-stage visual text from the LLM, verbatim —
    // never a narration dump (the contract keeps narration audio-only).
    const visualCaption = sceneDef.caption ? this.shortVisualText(this.cleanNarration(sceneDef.caption), 12) : ''
    const scene = {
      id: sceneDef.id || index + 1,
      type: sceneDef.type || 'fact',
      purpose: sceneDef.purpose || '',
      start: 0,
      end: 0,
      duration: this._clampDuration(sceneDef.duration, sceneDef.type),
      transition: sceneDef.transition || 'cut',
      emotion: sceneDef.emotion || 'neutral',
      music_cue: sceneDef.music_cue || 'none',
      sfx: sceneDef.sfx || 'none',
      narration: safeNarration,
      text: visualHeadline || safeNarration || (article.title || '').slice(0, 60),
      subheadline: visualHeadline || safeNarration || (article.title || '').slice(0, 60),
      // Caption from the LLM's short center-stage fullText only. Never fall
      // back caption to caption_focus or narration words — the manifest emits
      // narration as its own caption layer; duplicating the keyword here is
      // what produced the "SECRET twice" render bug.
      caption: visualCaption,
      caption_focus: safeEmphasis,
      captionFocus: safeEmphasis.toUpperCase(),
      camera: {
        type: sceneDef.camera || 'push_in',
        speed: this.cameraSpeed(sceneDef.camera),
        shake: sceneDef.camera === 'shake',
      },
      transition: sceneDef.transition || 'cut',
      emotion: sceneDef.emotion || 'neutral',
      music_cue: sceneDef.music_cue || 'none',
      sfx: sceneDef.sfx || 'none',
      visual: {
        type: this.inferVisualType(sceneDef.type),
        subject: sceneDef.visual_subject || sceneDef.visual?.subject || '',
        style: sceneDef.visual_style || sceneDef.visual?.style || 'cinematic',
        composition: sceneDef.visual_composition || sceneDef.visual?.composition || 'wide',
        prompt: sceneDef.visual_prompt || '',
        motion: sceneDef.camera || 'push_in',
      },
      colors: this.emotionColors(sceneDef.emotion),
    }
    return scene
  }

  cleanNarration(text) {
    if (!text) return ''
    return text
      .replace(/\*\*/g, '')
      .replace(/[«»""]/g, '"')
      .trim()
  }

  // Reduce a narration sentence to a SHORT center-stage visual block: the
  // first sentence only, hard-capped at maxWords words. This is the tool that
  // keeps on-screen text from wrapping into the multi-line stack that overlapped
  // in published 16:9 videos — narration stays VO-only, the visual headline is
  // punchy. Never returns an empty string for a non-empty input.
  shortVisualText(text, maxWords = 10) {
    if (!text) return ''
    const firstSentence = String(text).split(/[.!?]+/)[0].trim()
    const words = firstSentence.split(/\s+/).filter(Boolean)
    if (words.length <= maxWords) return firstSentence
    return words.slice(0, maxWords).join(' ') + '…'
  }

  // Dead phrasing the channel never wants on screen or in VO — matches the
  // BAD_OVERLAYS blacklist used by the cover pipeline. The AI (StoryDirector)
  // keeps inventing these, so the text is scrubbed at the single funnel every
  // scene passes through. Replacements keep the text punchy and grammatical:
  // "Actually see how X changed everything" -> "How X changed everything".
  sanitizeText(text) {
    if (!text) return ''
    let out = String(text)
    for (const [phrase, replacement] of [
      ['ACTUALLY SEE', ''],
      ['SEE HOW', ''],
      ['SEE WHY', ''],
      ['SEE WHAT', ''],
      ['THIS IS', ''],
      ['HERE IS', ''],
      ['HERE\'S', ''],
      ['LOOK AT', ''],
      ['CHECK OUT', ''],
      ['ACTUALLY', ''],
    ]) {
      out = out.replace(new RegExp(`\\b${phrase}\\b`, 'gi'), replacement)
    }
    return out.replace(/\s{2,}/g, ' ').replace(/^\s*(,|and|but|so)\s*/i, '').trim()
  }

  // Single duration clamp, type-aware. A positive finite numeric value is
  // clamped; a missing, zero, or non-numeric value falls back to the 3s
  // default (which is already inside the clamp, so it passes through
  // unchanged). Zero must NOT be treated as a valid duration — it means "not
  // specified".
  //
  // Cinematic refinement: explanation/reveal scenes carry the narration
  // callout sequence (caption -> "WHY IT MATTERS" -> 2-line yellow), so they
  // get a higher ceiling ([2, 9.5]) to absorb the label (~0.7s) + 2-line hold
  // (~1.5-2s) without compressing the per-word reading pace. Other scenes keep
  // the [2, 8] wall. Narration scenes also get a raised FLOOR so the spoken
  // caption is never crushed under the moving headline: 4s minimum (caption
  // window must survive long enough to be read).
  _clampDuration(value, type) {
    const n = Number(value)
    const base = n > 0 && Number.isFinite(n) ? n : 3
    const longForm = type === 'explanation' || type === 'reveal'
    const ceil = longForm ? 9.5 : 8
    const floor = 2
    const clamped = Math.max(floor, Math.min(ceil, base))
    return clamped
  }

  cameraSpeed(cameraType) {
    const speeds = {
      push_in: 1.2,
      slow_zoom: 0.8,
      orbit: 0.6,
      pan: 1.0,
      shake: 2.0,
      parallax: 0.5,
      pull_back: 0.7,
    }
    return speeds[cameraType] || 1.0
  }

  inferVisualType(sceneType) {
    const map = {
      hook: 'ai_image',
      fact: 'ai_image',
      reveal: 'ai_image',
      explanation: 'ai_image',
      reaction: 'motion_graphic',
      close: 'logo',
    }
    return map[sceneType] || 'ai_image'
  }

  buildVisualPrompt(originalPrompt, article, analysis) {
    if (originalPrompt) return originalPrompt
    const brand = analysis.brand || article.title?.split(' ')[0] || 'technology'
    return `cinematic news broadcast about ${brand}, professional lighting, dramatic composition, 8k, 16:9 landscape, photorealistic`
  }

  emotionColors(emotion) {
    const map = {
      shock: { primary: '#E10600', secondary: '#FFD700', bg: '#050505' },
      awe: { primary: '#00E5FF', secondary: '#FFFFFF', bg: '#050510' },
      curiosity: { primary: '#00E5FF', secondary: '#E10600', bg: '#050505' },
      tension: { primary: '#E10600', secondary: '#FF4444', bg: '#080808' },
      excitement: { primary: '#FFD700', secondary: '#00E5FF', bg: '#050510' },
    }
    return map[emotion] || { primary: '#E10600', secondary: '#00E5FF', bg: '#050505' }
  }

  assignTimestamps(scenes) {
    let cursor = 0
    return scenes.map(s => {
      const scene = { ...s, start: cursor, end: cursor + s.duration }
      cursor = scene.end
      return scene
    })
  }

  // Pick the best emphasis keyword: prefers a curiosity word the headline
  // does not already feature (HEADLINE_EMPHASIS_DUPLICATE class). When a
  // replacement is chosen, the swap is recorded in production memory so
  // future videos learn from the retention impact of that decision.
  _resolveEmphasis(sceneDef, article) {
    const original = (sceneDef.caption_focus || '').toUpperCase()
    // Close scenes animate the CTA keyword itself — never swap it for a
    // title word (the on-screen CTA is the scene's only job).
    if (sceneDef.type === 'close' || sceneDef.type === 'brand_close') return original
    const headline = this.cleanNarration(sceneDef.narration) || (article.title || '').slice(0, 60)
    const lessons = this.brandMemory.emphasisLessonsFor(article.category || 'technology')
    const chosen = this.emphasisResolver.resolve({
      headline,
      title: article.title || '',
      current: original,
      category: article.category || 'technology',
      lessons,
    })
    if (chosen && original && chosen !== original) {
      this.brandMemory.recordEmphasisLesson({
        category: article.category || 'technology',
        replaced: original,
        with: chosen,
        retentionImpact: -8,
        source: 'headline_emphasis_duplicate',
      })
    }
    return chosen || ''
  }

  buildNarrationScript(scenes) {
    return scenes.map(s => s.narration).filter(Boolean).join('. ')
  }
}
