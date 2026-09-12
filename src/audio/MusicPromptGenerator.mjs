const CATEGORY_TEMPLATES = {
  tech_reveal: 'Original cinematic electronic score, hybrid orchestra and electronic sound design, minimal futuristic pulses, no vocals, strong ending impact.',
  emotional_story: 'Original cinematic lo-fi composition, warm piano, soft vinyl texture, ambient guitar, nostalgic and emotional, suitable for documentary storytelling.',
  shorts_intro: 'Original trailer-style music, fast rising tension, dark cinematic bass, percussion hits, modern short-form video energy, no recognizable melody.',
  luxury_future: 'Original futuristic orchestral-scale soundtrack, deep synth layers, massive atmosphere, premium documentary feeling, no recognizable melodies.',
  breaking_news: 'Original urgent cinematic score, driving percussion, brass stabs, mission-control tension, no vocals.',
  general: 'Original ambient cinematic underscore, neutral and unobtrusive, supports narration without competing.'
}

/**
 * @param {object} mood - output of analyzeMood()
 * @returns {string} a generation-ready prompt with no copyrighted references
 */
export function buildMusicPrompt(mood) {
  const base = CATEGORY_TEMPLATES[mood.category] || CATEGORY_TEMPLATES.general
  return [
    base,
    `Mood: ${mood.mood}, emotional tone: ${mood.emotion}.`,
    `Tempo: ${mood.tempo} (~${mood.bpm_hint} BPM).`,
    `Instrumentation: ${mood.instruments.join(', ')}.`,
    'No copyrighted melody, no sampled material, fully original composition.'
  ].join(' ')
}