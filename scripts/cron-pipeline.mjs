#!/usr/bin/env node
/**
 * M10 Auto-Pipeline — runs every 30min via GitHub Actions cron
 *
 * Flow: fetch news → pickAlgorithm (1-48) → PublishingEnhancer (M9 hashtags+CTA)
 *       → track algos-used.json + pexels-used.json → render → publish --with-algo
 *
 * Usage:
 *   node scripts/cron-pipeline.mjs --with-algo --dry-run
 *   node scripts/cron-pipeline.mjs --with-algo
 *   node scripts/cron-pipeline.mjs --with-algo --hideBranding   # clean Short mode
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const withAlgo = process.argv.includes('--with-algo')
const dryRun = process.argv.includes('--dry-run')
const hideBranding = process.argv.includes('--hideBranding')

if (!withAlgo) {
  console.error('Usage: node scripts/cron-pipeline.mjs --with-algo [--dry-run] [--hideBranding]')
  process.exit(1)
}

// ─── Imports ─────────────────────────────────────────────────────────────────
const { pickAlgorithm, ALGORITHMS_LIST } = await import('../src/ai/StoryAlgorithmRegistry.mjs')
const { PublishingEnhancer } = await import('../src/publishing/PublishingEnhancer.mjs')
const { AlgorithmPerformanceTracker } = await import('../src/analytics/AlgorithmPerformanceTracker.mjs')

// ─── Load/create trackers ────────────────────────────────────────────────────
const algosPath = path.join(ROOT, 'data', 'algos-used.json')
const pexelsPath = path.join(ROOT, 'data', 'pexels-used.json')

function loadJson(p, fallback = []) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}

function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 0))
}

const algoHistory = loadJson(algosPath)
const pexelsHistory = loadJson(pexelsPath)

// 48h TTL for pexels reuse check
const PEXELS_TTL = 48 * 60 * 60 * 1000
function prunePexels() {
  const cutoff = Date.now() - PEXELS_TTL
  return pexelsHistory.filter(e => (e.at || 0) > cutoff)
}

// ─── Fetch fresh news (Politico RSS or fallback) ─────────────────────────────
async function fetchNews() {
  try {
    const res = await fetch('https://rss.politico.com/politics-news.xml')
    if (!res.ok) throw new Error(`RSS ${res.status}`)
    const xml = await res.text()
    // Simple XML parse — extract first <item>
    const titleMatch = xml.match(/<title><!\[CDATA\[(.+?)\]\]><\/title>/)
    const descMatch = xml.match(/<description><!\[CDATA\[(.+?)\]\]><\/description>/)
    const linkMatch = xml.match(/<link>(.+?)<\/link>/)
    if (!titleMatch) throw new Error('No title in RSS')
    return {
      title: titleMatch[1],
      description: descMatch?.[1] || '',
      source: 'Politico',
      url: linkMatch?.[1] || '',
      category: 'politics',
      publishedAt: new Date().toISOString(),
    }
  } catch (e) {
    console.warn(`⚠️  RSS fetch failed: ${e.message}, using fallback`)
    return {
      title: 'Markets hold steady amid trade talks',
      description: 'Stock markets remain calm as negotiations continue.',
      source: 'NEWS-MONSTER',
      category: 'business',
      publishedAt: new Date().toISOString(),
    }
  }
}

// ─── Pick unique algorithm (avoid recent repeats) ────────────────────────────
function pickUniqueAlgorithm(article) {
  const recentNumbers = algoHistory.slice(-20).map(e => e.algoNumber)
  let algo = pickAlgorithm(article)
  let attempts = 0
  while (recentNumbers.includes(algo.number) && attempts < 48) {
    algo = pickAlgorithm({ ...article, title: article.title + ' ' + attempts })
    attempts++
  }
  if (attempts > 0) console.log(`🔄 Re-rolled ${attempts}x to avoid recent algo repeat`)
  return algo
}

// ─── Check photo uniqueness (48h window) ─────────────────────────────────────
function isPhotoUnique(photoId) {
  const recent = prunePexels()
  return !recent.some(e => e.photo === photoId)
}

// ─── Main pipeline ───────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`M10 AUTO-PIPELINE — ${new Date().toISOString()}`)
console.log(`${'='.repeat(60)}`)

const article = await fetchNews()
console.log(`\n📰 Article: ${article.title}`)
console.log(`   Source: ${article.source} | Category: ${article.category}`)

// Pick algorithm (1-48) — unique from last 20
const algo = pickUniqueAlgorithm(article)
console.log(`\n🎲 ALGO #${algo.number}/48`)
console.log(`   Hook: ${algo.hook} | Arc: ${algo.arc}`)
console.log(`   Visual: ${algo.visual?.id} | Tone: ${algo.tone?.id}`)
console.log(`   Niche: ${algo.niche}`)

// M9: Enhance with hashtags + CTA
const enhanced = PublishingEnhancer.enhance({
  title: article.title,
  category: article.category,
  source: article.source,
  algorithm: algo,
})

console.log(`\n🏷️  Hashtags (${enhanced.hashtags.length}): ${enhanced.hashtags.slice(0, 8).join(' ')}...`)
console.log(`📝 CTA: ${(enhanced.pinnedComment || '').slice(0, 80)}...`)
console.log(`📄 Description preview:`)
console.log(`   ${(enhanced.fullDescription || '').slice(0, 200)}...`)

// Track algo usage
algoHistory.push({
  at: Date.now(),
  algoNumber: algo.number,
  algoId: algo.id,
  hook: algo.hook,
  arc: algo.arc,
  visual: algo.visual?.id,
  tone: algo.tone?.id,
  title: article.title,
  category: article.category,
  photo: article.photo || null,
  hideBranding,
})

// Track photo (if any) — check uniqueness
if (article.photo) {
  if (!isPhotoUnique(article.photo)) {
    console.warn(`⚠️  Photo ${article.photo} was used in last 48h — possible duplicate`)
  }
  pexelsHistory.push({ at: Date.now(), photo: article.photo, algoNumber: algo.number })
}

// Diversity check
const last20 = algoHistory.slice(-20)
const uniqueAlgos = new Set(last20.map(e => e.algoNumber))
console.log(`\n📊 Diversity: ${uniqueAlgos.size}/20 unique algos in last 20 runs`)

// No "Actually See" check
const hasActuallySee = algoHistory.some(e =>
  (e.title || '').toLowerCase().includes('actually see')
)
console.log(`🚫 Actually See in history: ${hasActuallySee ? '⚠️ FOUND' : '✅ Clean'}`)

if (dryRun) {
  console.log(`\n🏁 DRY RUN — would publish:`)
  console.log(`   Title: ${article.title} | NEWS-MONSTER`)
  console.log(`   ALGO: #${algo.number}/48 • ${algo.visual?.id} • ${algo.tone?.id}`)
  console.log(`   hideBranding: ${hideBranding}`)
  console.log(`   Hashtags: ${enhanced.hashtags.join(' ')}`)
  console.log(`   CTA: ${(enhanced.pinnedComment || '').slice(0, 120)}`)
} else {
  // Save trackers
  saveJson(algosPath, algoHistory)
  saveJson(pexelsPath, prunePexels())

  console.log(`\n✅ Algo + photo tracked. Run composer to render & publish:`)
  console.log(`   node scripts/composer.mjs '${article.title}'`)
  console.log(`   node scripts/publish-news-with-algo.mjs --with-algo`)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`M10 pipeline complete`)
console.log(`${'='.repeat(60)}`)
