// Cover regeneration — swap fresh, visually-distinct covers onto existing
// uploads (thumbnail-only, no re-render). Uses the shared visual-diversity
// selector so every cover picks a hero photo not used in the last 48h.
//
// Usage: node scripts/recover.mjs

import path from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const TARGETS = [
  { videoId: 'qKjgZr4wnnQ', title: '6 Mini Gadgets To Add To Your Wishlist In 2026 - SlashGear', category: 'technology', source: 'SlashGear' },
  { videoId: '2WWm3NiMyYo', title: "'Sandwich generation' is getting younger and not any better prepared - USA Today", category: 'business', source: 'USA Today' },
  { videoId: 'zYiVoumcNiw', title: "This 1979 Mercedes-Benz 280TE Was Trapped Inside An Italian Garage For 38 Years, Now It's", category: 'business', source: 'NewsAPI' },
]

const { CoverGenerator } = await import(path.join(ROOT, 'src', 'video-studio', 'CoverGenerator.mjs'))
const { getAccessToken, setThumbnail } = await import(path.join(ROOT, 'apps', 'api', 'publishers', 'youtube.js'))

const token = await getAccessToken()
if (!token) throw new Error('OAuth token unavailable — re-auth via scripts/get-youtube-token.mjs')

for (const t of TARGETS) {
  const outDir = path.join(ROOT, 'output', `recover-${t.videoId}`)
  const article = { title: t.title, category: t.category, source: t.source, url: '', imageUrl: null }
  console.log(`\n=== cover for ${t.videoId} (${t.title.slice(0, 50)}...) ===`)
  const gen = new CoverGenerator(null)
  const res = await gen.generateTournament(article, outDir, { styles: ['breaking', 'cinematic', 'minimal'] })
  console.log(`winner: ${res.winner} (CTR ${res.winnerCtr})`)
  const ok = await setThumbnail(token, t.videoId, res.path)
  console.log(ok ? `✅ thumbnail set on ${t.videoId}` : `❌ thumbnail FAILED on ${t.videoId}`)
}

console.log('\nCover regeneration complete')
