/**
 * LanguagePack — tri-lingual broadcast configuration (EN / தமிழ் / සිංහල).
 *
 * One story may render in multiple languages: the same visual plan, translated
 * narration/captions, a per-language TTS voice, and per-language font shaping.
 * Adding a language = one entry here + its Noto font vendored in assets/fonts.
 *
 * Invariants:
 *  - 'en' is the primary broadcast and must never regress (no shaping, no
 *    translation call — zero behavior change when LANGS=en or unset).
 *  - TA/SI pass through edge-tts only (ElevenLabs has no Sinhala voice);
 *    the keyless pipeline keeps working.
 *  - Tags/UI strings stay English (brand consistency); only content
 *    text is localized onto the target script.
 */

export const LANGUAGES = Object.freeze({
  en: Object.freeze({
    code: 'en',
    label: 'English',
    nativeLabel: 'English',
    primary: true,
    provider: 'auto',           // ElevenLabs if key exists, edge-tts fallback (unchanged path)
    edgeVoice: 'en-US-AriaNeural',
    fontFamily: null,           // English uses the existing Anton/Montserrat stack
    fontFiles: null,
    titleTag: '',               // no suffix on upload titles
    langHashtag: '',            // no extra language hashtag
    translate: false,
  }),
  // en-LK — natural English narration for Sri Lankan audiences. Same English
  // texts (translate:false → zero regression on the EN master), a catalog-
  // verified South-Asian-English accent (en-IN-NeerjaNeural; the catalog has
  // NO en-LK voice — accent fallback is EXPLICIT here, not silent), overridable.
  'en-LK': Object.freeze({
    code: 'en-LK',
    label: 'English (LK)',
    nativeLabel: 'English (LK)',
    primary: false,
    provider: 'edge',
    edgeVoice: 'en-IN-NeerjaNeural', // catalog-verified natural accent fallback for en-LK
    fontFamily: null,
    fontFiles: null,
    titleTag: 'English (LK)',
    langHashtag: '#EnglishLK',
   translate: false,
  }),
  ta: Object.freeze({
    code: 'ta',
    label: 'Tamil',
    nativeLabel: 'தமிழ்',
    primary: false,
    provider: 'edge',           // edge-tts: ta-LK-SaranyaNeural (female, Sri Lanka)
    edgeVoice: 'ta-LK-SaranyaNeural',
    fontFamily: 'Noto Sans Tamil',
    fontFiles: [
      'assets/fonts/NotoSansTamil-Regular.ttf',
      'assets/fonts/NotoSansTamil-Bold.ttf',
    ],
    titleTag: 'தமிழ்',
    langHashtag: '#தமிழ்Trending',
    translate: true,
  }),
  si: Object.freeze({
    code: 'si',
    label: 'Sinhala',
    nativeLabel: 'සිංහල',
    primary: false,
    provider: 'edge',           // edge-tts: si-LK-ThiliniNeural (female, Sri Lanka) — verified live from the voice catalog
    edgeVoice: 'si-LK-ThiliniNeural',
    fontFamily: 'Noto Sans Sinhala',
    fontFiles: [
      'assets/fonts/NotoSansSinhala-Regular.ttf',
      'assets/fonts/NotoSansSinhala-Bold.ttf',
    ],
    titleTag: 'සිංහල',
    langHashtag: '#සිංහල',
    translate: true,
  }),
})

export const PRIMARY_LANG = 'en'

/**
 * Parse a LANGS spec ('en,ta', 'en', 'en,ta,si') into ordered language packs.
 * Unknown or duplicate codes throw loudly — silent truncation creates
 * half-localized videos, which is worse than no variant.
 */
export function parseLangSpec(spec) {
  const raw = (spec ?? process.env.LANGS ?? 'en').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (raw.length === 0) return [LANGUAGES.en]
  // Case-insensitive lookup: spec slugs are lowercased but codes carry locale
  // casing (en-LK). Unknown codes still fail loud (operator typo guard).
  const resolved = []
  for (const code of raw) {
    const match = Object.keys(LANGUAGES).find((k) => k.toLowerCase() === code)
    if (!match) throw new Error(`UNKNOWN_LANGUAGE: "${code}" — known: ${Object.keys(LANGUAGES).join(',')}`)
    if (!resolved.includes(match)) resolved.push(match)
  }
  // Primary first, then extras in requested order
  return [
    LANGUAGES[PRIMARY_LANG],
    ...resolved.filter((c) => c !== PRIMARY_LANG).map((c) => LANGUAGES[c]),
  ].filter((p) => resolved.includes(p.code))
}
