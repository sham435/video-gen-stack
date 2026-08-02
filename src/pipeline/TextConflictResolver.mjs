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

    const emphasis = manifest.text_layers.find(x => x.type === 'emphasis')
    const headline = manifest.text_layers.find(x => x.type === 'headline')
    const caption = manifest.text_layers.find(x => x.type === 'caption')

    if (!emphasis || !caption) return manifest

    // Close scenes have no headline renderer — the caption IS the on-screen
    // CTA. Never hide it even if it echoes the (undrawn) headline text.
    const noHeadlineDrawn = ['close', 'brand_close'].includes(manifest.type)

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
