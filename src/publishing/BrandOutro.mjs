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
  tagline: 'UNFILTERED NEWS FROM THE FUTURE',
  narration: 'Stay with NEWS-MONSTER. Unfiltered breaking news from the future.',
  duration: 4.5,
  colors: {
    headline: '#FFC107', // golden yellow
    brand: '#FFFFFF',
    tagline: '#FFFFFF',
    backgroundTop: '#0A0E1A', // dark navy
    backgroundBottom: '#05060A',
  },
  // Presentation-style outro (addendum v2): the end card is no longer a single
  // static frame — it plays as a short 3-beat mini-sequence. Each beat carries
  // a DIFFERENT background imagery spec (reused by the existing per-scene
  // visual-selection / asset-diversity system — never hand-picked), with the
  // brand narration running over top. The FINAL beat always ends on the same
  // fixed brand mark + tagline (the brand moment itself never changes, only the
  // presentation rhythm leading into it).
  //
  // `musicLevel` is the resting BGM bed multiplier for the whole outro window
  // (0.0-1.0). Lower than the default 1.0 so the BGM sits audibly lower under
  // the STAY WITH + NEWS-MONSTER narration/callout — a mix-level change (the
  // AudioMixer already ducks against voice; this lowers the bed underneath).
  presentation: {
    beats: [
      { label: 'STAY WITH', subject: 'newsroom anchor desk, red and cyan broadcast lighting, abstract', style: 'cinematic', weight: 1 },
      { label: 'WATCH NEXT', subject: 'futuristic broadcast control room, red and cyan haze, wide', style: 'cinematic', weight: 1 },
      { label: 'NEWS-MONSTER', subject: 'NEWS-MONSTER brand logo, red and cyan futuristic, center', style: 'brand', weight: 1 },
    ],
    musicLevel: 0.5,
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
    caption: { focus: 'STAY_WITH', fullText: 'STAY WITH NEWS-MONSTER' },
    outro: true,
    presentation: { ...BRAND_OUTRO.presentation },
    // Hard boundary: the outro headline is rendered by InformationLayer only.
    // Generic caption/text scheduling must never interpret this as story content.
    textPolicy: {
      allowStoryCaptions: false,
      allowGenericCaptionScheduling: false,
      allowEmphasisLayer: false,
    },
  }
}
