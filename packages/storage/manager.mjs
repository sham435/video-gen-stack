/**
 * Asset Storage Manager (V3 Newsroom)
 *
 * Every project gets isolated file storage organized by date/category/title.
 * Manages: images, audio, video, subtitles, snapshots.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, statSync, readFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || resolve(__dirname, '..', '..', 'storage')

/**
 * Ensure storage directory structure for a project.
 *
 * Layout:
 *   storage/<YYYYMMDD>/<category>/<project-slug>/
 *     article.json
 *     script.json
 *     storyboard.json
 *     assets/images/
 *     assets/audio/
 *     assets/subtitle/
 *     render/
 *     publish/
 */
export function initProjectStorage(article) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const category = (article.category || 'technology').toLowerCase().replace(/[^a-z0-9]/g, '-')
  const slug = (article.title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)

  const base = resolve(STORAGE_ROOT, date, category, `${slug}-${Math.random().toString(36).slice(2, 6)}`)

  const dirs = {
    base,
    images: join(base, 'assets', 'images'),
    audio: join(base, 'assets', 'audio'),
    subtitle: join(base, 'assets', 'subtitle'),
    render: join(base, 'render'),
    publish: join(base, 'publish'),
  }

  for (const d of Object.values(dirs)) {
    mkdirSync(d, { recursive: true })
  }

  return dirs
}

/**
 * Write a JSON file to the project storage.
 */
export function writeJSON(dir, filename, data) {
  writeFileSync(resolve(dir, filename), JSON.stringify(data, null, 2))
}

/**
 * Copy a file into project storage.
 */
export function storeFile(sourcePath, targetDir, filename) {
  const target = resolve(targetDir, filename)
  copyFileSync(sourcePath, target)
  return target
}

/**
 * Compute SHA256 hash of a file.
 */
export function fileHash(filePath) {
  const data = readFileSync(filePath)
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}

/**
 * List all projects in storage (for dashboard).
 */
export function listStorageProjects() {
  if (!existsSync(STORAGE_ROOT)) return []
  const projects = []
  const dates = readdirSync(STORAGE_ROOT)
  for (const date of dates) {
    const datePath = resolve(STORAGE_ROOT, date)
    if (!statSync(datePath).isDirectory()) continue
    const categories = readdirSync(datePath)
    for (const cat of categories) {
      const catPath = resolve(datePath, cat)
      if (!statSync(catPath).isDirectory()) continue
      const slugs = readdirSync(catPath)
      for (const slug of slugs) {
        projects.push({
          date,
          category: cat,
          slug,
          path: resolve(catPath, slug),
        })
      }
    }
  }
  return projects.sort((a, b) => b.date.localeCompare(a.date))
}

if (import.meta.url.endsWith('storage.mjs')) {
  console.log(`📦 Storage root: ${STORAGE_ROOT}`)
  const projects = listStorageProjects()
  console.log(`Projects: ${projects.length}`)
  if (projects.length > 0) {
    console.log('Recent:')
    projects.slice(0, 5).forEach(p => console.log(`  ${p.date}/${p.category}/${p.slug}`))
  }
}
