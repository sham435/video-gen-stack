// Brand Outro — the fixed NEWS-MONSTER end card.
//
// Every Short ends with this card, GENERATED INDEPENDENTLY OF THE ARTICLE.
// The close scene must NEVER inherit story text (headline words like
// "Replacing SIRI" leaking into the outro was a real defect: TopicCtaBuilder
// derived the CTA brand from the headline). This module is the single
// source of truth for the outro content — renderers, StoryDirector and the
// LLM prompt all consume these constants.

export const BRAND_OUTRO = {
  headline: 'STAY WITH', // golden yellow
  brand: 'NEWS-MONSTER',
  tagline: 'UNFILTERED BREAKING NEWS FROM THE FUTURE',
  narration: 'Stay with NEWS-MONSTER. Unfiltered breaking news from the future.',
  duration: 3,
  colors: {
    headline: '#FFC107', // golden yellow
    brand: '#FFFFFF',
    tagline: '#FFFFFF',
    backgroundTop: '#0A0E1A', // dark navy
    backgroundBottom: '#05060A',
  },
}

/** Build the fixed close scene — identical for every video, plus the story's
 * news source so the end card can credit it ("Source: The Washington Post").
 * When a topic CTA is supplied it travels with the scene so the renderer can
 * draw the engagement question on-screen — no manual pinned comment needed. */
export function brandOutroScene(article = {}, cta = null) {
  return {
    id: 'close',
    type: 'close',
    purpose: 'brand outro',
    duration: BRAND_OUTRO.duration,
    narration: cta?.narration || BRAND_OUTRO.narration,
    source: article.source || 'News',
    cta: cta ? { text: cta.cta, caption: cta.caption, engagement: cta.engagement } : null,
    visual: { subject: 'NEWS-MONSTER brand logo', style: 'red and cyan futuristic', composition: 'medium' },
    camera: 'pull_back',
    motion: null,
    transition: 'fade',
    emotion: 'excitement',
    caption: { focus: 'STAY WITH', fullText: 'STAY WITH NEWS-MONSTER' },
    outro: true,
  }
}