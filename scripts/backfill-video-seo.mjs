#!/usr/bin/env node
/**
 * backfill-video-seo.mjs — apply SEO (tags[] + categoryId) to ALREADY-PUBLISHED
 * YouTube videos.
 *
 * Videos published before SEO wiring (snippet.tags + categoryId) can be updated
 * in place via the YouTube Data API `videos.update`. This script derives the SEO
 * bundle from a category/niche — Sports→17, Music→10, Politics→25, etc. — plus
 * brand + category keyword tags, and pushes them to the target video(s).
 *
 * Usage:
 *   node scripts/backfill-video-seo.mjs <videoId> --category SPORTS [--title "..." --description "..."]
 *   node scripts/backfill-video-seo.mjs --video-id dQw4w9WgXcQ --category music --article-tags tag1,tag2
 *   node scripts/backfill-video-seo.mjs --help
 *
 * Category must be one of the mapped niches (any case): SPORTS, MUSIC, POLITICS,
 * GAMING, TECH, AI, CLIMATE, HEALTH, CRYPTO, STOCKS, MOVIES, FINANCE, BUSINESS,
 * SPACE, ENTERTAINMENT, LIFESTYLE, SCIENCE, ...
 */

const USAGE = `Usage:
  node scripts/backfill-video-seo.mjs <videoId> [--category CAT] [--title T] [--description D] [--article-tags a,b,c]
  node scripts/backfill-video-seo.mjs --video-id <videoId> [same flags]
  node scripts/backfill-video-seo.mjs --list-categories

Requires YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN (same
OAuth as publishing).`

function parseArgs(argv) {
  const args = { category: null, title: null, description: null, articleTags: [], showHelp: false, listCategories: false }
  let positionalVideoId = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.showHelp = true
    else if (a === '--list-categories') args.listCategories = true
    else if (a === '--video-id') args.videoId = argv[++i]
    else if (a === '--category' || a === '-c') args.category = argv[++i]
    else if (a === '--title' || a === '-t') args.title = argv[++i]
    else if (a === '--description' || a === '-d') args.description = argv[++i]
    else if (a === '--article-tags') {
      args.articleTags = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    } else if (!a.startsWith('-') && !positionalVideoId) {
      positionalVideoId = a
    }
  }
  if (!args.videoId && positionalVideoId) args.videoId = positionalVideoId
  return args
}

const CATEGORIES = ['SPORTS', 'MUSIC', 'POLITICS', 'GAMING', 'TECH', 'AI', 'CLIMATE', 'HEALTH',
  'CRYPTO', 'STOCKS', 'MOVIES', 'FINANCE', 'BUSINESS', 'SPACE', 'ENTERTAINMENT', 'LIFESTYLE', 'SCIENCE']

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.showHelp) { console.log(USAGE + '\n\nCategories: ' + CATEGORIES.join(', ')); return }
  if (args.listCategories) { console.log('Available categories:\n  ' + CATEGORIES.join('\n  ')); return }

  if (!args.videoId) {
    console.error('ERROR: missing <videoId>. ' + USAGE)
    process.exit(2)
  }

  const { updateVideoSEO } = await import('../apps/api/publishers/youtube.js')

  // Validate category key before hitting the API so a typo fails fast.
  const key = (args.category || '').trim().toUpperCase()
  if (args.category && !CATEGORIES.includes(key)) {
    console.error(`ERROR: unknown category "${args.category}". Valid: ${CATEGORIES.join(', ')}`)
    process.exit(2)
  }

  const result = await updateVideoSEO({
    videoId: args.videoId,
    category: key || null,
    articleTags: args.articleTags,
    title: args.title,
    description: args.description,
  })

  console.log('\n[SEO BACKFILL] updated videoId=' + result.videoId)
  console.log('  title        : ' + result.title)
  console.log('  categoryId   : ' + result.categoryId)
  console.log('  tags (' + result.tags.length + '): ' + result.tags.join(', '))
  console.log('\nHashtags for the description (external): #' + result.tags.join(' #'))
}

main().catch((e) => {
  console.error('[BACKFILL] failed:', e.message)
  process.exit(1)
})
