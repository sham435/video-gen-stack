// MusicFamily — mood/music-family resolution for NEWS-MONSTER videos.
//
// The 48-track cinematic collection (scripts/gen-music.mjs) is organized in
// four families. Every article is mapped to a family by keyword + category
// scoring, and the video deterministically picks a track INSIDE that family
// via the title hash. So a tech story gets the tech-reveal underscore while
// a human story gets the warm rainy-season lo-fi — and consecutive uploads
// still rotate through DIFFERENT tracks.
//
// The family names carry the requested moods:
//   cinematic-tech-reveal — curiosity, discovery, future
//   emotional-story       — nostalgia, warmth (the "Rainy Season Memories"
//                           Suno-reference FEELING: tanpura drone, rain,
//                           vocal-warm pads, vinyl)
//   action-energy         — urgency, trailer tension
//   luxury-future         — premium, epic, documentary space

import fs from 'fs'
import path from 'path'

const MANIFEST_PATH = path.join(process.cwd(), 'assets', 'music', 'manifest.json')

export const FAMILY_KEYS = ['cinematic-tech-reveal', 'emotional-story', 'action-energy', 'luxury-future']

export const FAMILY_KEYWORDS = {
  'action-energy': [
    'war', 'crisis', 'crash', 'fire', 'attack', 'urgent', 'breaking', 'explosion',
    'strike', 'battle', 'hack', 'bomb', 'dead', 'death', 'killed', 'disaster',
    'clash', 'surge', 'collapse', 'spike', 'critical', 'shock', 'evacuat',
    'lawsuit', 'fraud', 'scandal', 'turmoil', 'emergency', 'wildfire', 'storm',
  ],
  'emotional-story': [
    'story', 'human', 'family', 'wedding', 'cancer', 'veteran', 'rescue',
    'artist', 'singer', 'poet', 'mother', 'father', 'child', 'teacher',
    'doctor', 'romance', 'tribute', 'music', 'film', 'movie', 'book', 'museum',
    'lost', 'save', 'hope', 'heart', 'tears', 'legacy', 'memory', 'generation',
  ],
  'luxury-future': [
    'luxury', 'billionaire', 'rolls', 'bentley', 'mercedes', 'ferrari', 'porsche',
    'lamborghini', 'watch', 'jet', 'supercar', 'mansion', 'estate', 'yacht',
    'private island', 'penthouse', 'net worth', 'titanic', 'milestone', 'record',
    'empire', 'fortune',
  ],
}

export const FAMILY_FALLBACK = {
  technology: 'cinematic-tech-reveal',
  business: 'cinematic-tech-reveal',
  science: 'cinematic-tech-reveal',
  health: 'emotional-story',
  entertainment: 'emotional-story',
  sports: 'action-energy',
  default: 'cinematic-tech-reveal',
}

/**
 * Score an article against the keyword families and return the best family.
 * @param {{title?:string, category?:string, source?:string}} article
 * @returns {string} one of FAMILY_KEYS
 */
export function resolveMusicFamily(article) {
  const text = String(article?.title || '') + ' ' + String(article?.category || '')
  const lower = text.toLowerCase()
  let best = FAMILY_KEYS[0]
  let bestScore = 0
  for (const family of FAMILY_KEYS) {
    const kw = FAMILY_KEYWORDS[family] || []
    let score = 0
    for (const k of kw) {
      if (lower.includes(k)) score += 2
    }
    // category affinity (half weight)
    for (const k of kw) {
      if (String(article?.category || '').toLowerCase() === k) score += 1
    }
    if (score > bestScore) { bestScore = score; best = family }
  }
  if (bestScore === 0) best = FAMILY_FALLBACK[article?.category] || FAMILY_FALLBACK.default
  return best
}

/**
 * Deterministic hash — same algorithm as trackIndexFor in AudioMixer so a
 * title always maps to the same track.
 */
export function trackIndexFor(seed, count = 48) {
  const s = String(seed || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % count
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Pick the music file for an article.
 * @param {{title?:string, category?:string}} article
 * @param {{family?:string, verbose?:boolean}} [opts] family forces the mood family
 * @returns {{ file: string, index: number, total: number, family: string }|null}
 */
export function pickMusicTrack(article, opts = {}) {
  if (!article?.title) return null
  const family = opts.family || resolveMusicFamily(article)
  const manifest = readManifest()
  let pool = null

  if (manifest && Array.isArray(manifest.tracks) && manifest.tracks.length > 0) {
    const famTracks = manifest.tracks.filter(t => t.family === family).sort((a, b) => a.index - b.index)
    pool = famTracks.length > 0 ? famTracks : manifest.tracks
  } else {
    // Fallback: parse family out of the filename (nm-track-NN-<family>-<bpm>.mp3)
    try {
      const files = fs.readdirSync(path.dirname(MANIFEST_PATH))
        .filter(f => f.startsWith('nm-track-') && f.endsWith('.mp3'))
        .sort()
      const famFiles = files.filter(f => f.includes(`-${family}-`))
      pool = (famFiles.length > 0 ? famFiles : files).map(f => ({ file: f, index: parseInt(f.match(/^nm-track-(\d+)/)?.[1] || '0', 10) }))
    } catch {
      return null
    }
  }

  const idx = trackIndexFor(article.title, pool.length)
  const chosen = pool[idx]
  const file = path.join(path.dirname(MANIFEST_PATH), chosen.file)
  if (opts.verbose) {
    console.log(`🎵 Music track ${idx + 1}/${pool.length} [${family}]: ${chosen.file} (for "${String(article.title).slice(0, 40)}")`)
  }
  return { file, index: idx + 1, total: pool.length, family }
}