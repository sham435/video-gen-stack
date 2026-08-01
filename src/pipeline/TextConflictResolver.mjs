// Text Conflict Resolver — removes duplicate words between emphasis and caption
// layers BEFORE rendering. This is the permanent fix for the SECRET/secret class.
export class TextConflictResolver {
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

  // Resolve a text manifest — ensure caption never repeats the emphasis keyword
  process(manifest) {
    if (!manifest?.text_layers) return manifest

    const emphasis = manifest.text_layers.find(x => x.type === 'emphasis')
    const caption = manifest.text_layers.find(x => x.type === 'caption')

    if (!emphasis || !caption) return manifest

    const resolved = this.removeDuplicateWords(emphasis.text, caption.text)
    caption.text = resolved

    // If the entire caption was the emphasis word, hide it (no empty subtitle box)
    if (!resolved.trim()) {
      caption.visible = false
      caption.text = ''
    }

    return manifest
  }
}
