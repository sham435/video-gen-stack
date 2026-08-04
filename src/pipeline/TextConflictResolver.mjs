// Text Conflict Resolver — removes duplicate words between emphasis and caption
// layers BEFORE rendering. This is the permanent fix for the SECRET/secret class.
import { CaptionConflictResolver } from './CaptionConflictResolver.mjs'
import { STOPWORDS } from './HeadlineEmphasisResolver.mjs'

export class TextConflictResolver {
  constructor() {
    this.captionResolver = new CaptionConflictResolver()
  }

  normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim()
  }

  // Remove emphasis words from the caption (case-insensitive, punctuation-safe)
  removeDuplicateWords(emphasis, caption) {
    const emphasisWords = this.normalize(emphasis).split(' ').filter(Boolean)
    if (emphasisWords.length === 0) return caption

    let captionWords = this.normalize(caption).split(' ').filter(Boolean)
    captionWords = captionWords.filter(word => !emphasisWords.includes(word))
    return captionWords.join(' ')
  }

  // Resolve a text manifest — ensure the caption never repeats the emphasis
  // keyword and never merely re-states the headline (grammar-aware).
  process(manifest) {
    if (!manifest?.text_layers) return manifest

    // Word-overlap guard: drop any layer where 60%+ of its non-stopword words
    // already exist in the anchor (headline) text. The headline is the primary
    // content; the emphasis keyword (the resolver should have picked a word
    // the headline lacks — this is the render-time safety net) and the caption
    // must never re-state it. Close scenes are exempt: their CTA is designed
    // to echo the headline.
    const noHeadlineDrawn = ['close', 'brand_close'].includes(manifest.type)
    if (!noHeadlineDrawn) {
      const layers = manifest.text_layers
      const words = l => String(l.text || '').toUpperCase().split(/\s+/).filter(w => !STOPWORDS.has(w))
      const headlineLayer = layers.find(x => x.type === 'headline')
      const emphasisLayer = layers.find(x => x.type === 'emphasis')
      const captionLayer = layers.find(x => x.type === 'caption')
      const headWords = headlineLayer ? new Set(words(headlineLayer)) : new Set()
      if (headWords.size && emphasisLayer) {
        const em = words(emphasisLayer)
        if (em.length && em.filter(w => headWords.has(w)).length / em.length >= 0.6) {
          emphasisLayer.visible = false
          emphasisLayer.text = ''
        }
      }
      if (headWords.size && captionLayer) {
        const anchor = new Set([...headWords, ...(emphasisLayer?.text ? words(emphasisLayer) : [])])
        const cap = words(captionLayer)
        if (cap.length && cap.filter(w => anchor.has(w)).length / cap.length >= 0.6) {
          captionLayer.visible = false
          captionLayer.text = ''
        }
      }
    }

    const emphasis = manifest.text_layers.find(x => x.type === 'emphasis')
    const headline = manifest.text_layers.find(x => x.type === 'headline')
    const caption = manifest.text_layers.find(x => x.type === 'caption')

    if (!emphasis || !caption) return manifest

    // Emphasis-caption overlap: when the caption re-states more than one
    // non-stopword the emphasis layer animates ("CHANGED THE PLAN" + "This
    // changed the plan overnight"), hide the caption — one thought per frame.
    // Computed on the raw caption: the caption resolver strips the keyword
    // below, which would erase the overlap before it can be counted.
    let overlapHidden = false
    if (caption.text) {
      const emphasisWords = new Set(
        String(emphasis.text || '').toUpperCase().split(/\s+/).filter(w => !STOPWORDS.has(w))
      )
      const captionWords = String(caption.text || '').toUpperCase().split(/\s+/).filter(w => !STOPWORDS.has(w))
      const overlap = captionWords.filter(w => emphasisWords.has(w)).length
      overlapHidden = overlap > 1
    }

    const resolved = this.captionResolver.resolve({
      focus: emphasis.text,
      caption: caption.text,
      headline: noHeadlineDrawn ? '' : (headline?.text || ''),
    })
    caption.text = resolved.caption

    // If the entire caption was the emphasis word, hide it (no empty subtitle box)
    if (!resolved.visible || !resolved.caption.trim() || overlapHidden) {
      caption.visible = false
      caption.text = ''
    }

    return manifest
  }
}
