/**
 * Database connection + CRUD operations for the V3 Newsroom Platform.
 * Uses better-sqlite3 (already in package.json) for fast, synchronous SQLite.
 */

import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { CREATE_TABLES, SEED_DATA } from './schema.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || resolve(__dirname, '..', '..', 'data', 'newsroom.db')

let db = null

/**
 * Initialize database: create dir, open connection, run migrations.
 */
export function initDatabase() {
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(DB_PATH)

  // Enable WAL mode for concurrent reads during writes
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Run schema
  db.exec(CREATE_TABLES)

  // Seed default data
  db.exec(SEED_DATA)

  console.log(`🗄️  Database: ${DB_PATH}`)
  return db
}

/**
 * Get the active database connection.
 */
export function getDB() {
  if (!db) return initDatabase()
  return db
}

/**
 * Compute a dedup hash from article title + source
 */
export function articleHash(title, source) {
  return createHash('sha256').update(`${title}|${source}`).digest('hex').slice(0, 16)
}

// ===================================================================
// NEWS ARTICLES CRUD
// ===================================================================

export function insertArticle(article) {
  const d = getDB()
  const hash = articleHash(article.title, article.source || 'newsapi')
  const stmt = d.prepare(`
    INSERT INTO news_articles (external_id, source, title, description, content, url, image_url, published_at, category, language, hash, status)
    VALUES (@external_id, @source, @title, @description, @content, @url, @image_url, @published_at, @category, @language, @hash, 'NEW')
  `)
  const info = stmt.run({
    external_id: article.external_id || null,
    source: article.source || 'newsapi',
    title: article.title,
    description: article.description || null,
    content: article.content || null,
    url: article.url || null,
    image_url: article.imageUrl || article.image_url || null,
    published_at: article.publishedAt || article.published_at || null,
    category: article.category || 'technology',
    language: article.language || 'en',
    hash,
  })
  return info.lastInsertRowid
}

export function findArticleByHash(hash) {
  const d = getDB()
  return d.prepare(`SELECT * FROM news_articles WHERE hash = ? AND status != 'ARCHIVED' ORDER BY created_at DESC LIMIT 1`).get(hash)
}

export function findArticleByUrl(url) {
  const d = getDB()
  return d.prepare(`SELECT * FROM news_articles WHERE url = ? AND status != 'ARCHIVED' LIMIT 1`).get(url)
}

export function getArticles({ status = null, category = null, limit = 20, offset = 0 } = {}) {
  const d = getDB()
  const conditions = []
  const params = []
  if (status) { conditions.push('status = ?'); params.push(status) }
  if (category) { conditions.push('category = ?'); params.push(category) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return d.prepare(`SELECT * FROM news_articles ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
}

export function updateArticleStatus(id, status) {
  const d = getDB()
  d.prepare(`UPDATE news_articles SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id)
}

// ===================================================================
// EDITORIAL PROJECTS CRUD
// ===================================================================

export function createProject(articleId, title, { script, ttsScript, storyboard, seo, category, sourceName, imageUrl, templateId } = {}) {
  const d = getDB()
  const stmt = d.prepare(`
    INSERT INTO editorial_projects (article_id, title, script, tts_script, storyboard_json, seo_json, category, source_name, image_url, template_id, editor_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
  `)
  const info = stmt.run(
    articleId, title, script || null, ttsScript || null,
    storyboard ? JSON.stringify(storyboard) : null,
    seo ? JSON.stringify(seo) : null,
    category || 'technology', sourceName || null, imageUrl || null,
    templateId || null,
  )
  return info.lastInsertRowid
}

export function getProject(id) {
  const d = getDB()
  const p = d.prepare(`
    SELECT p.*, a.url as article_url, a.image_url as article_image
    FROM editorial_projects p
    LEFT JOIN news_articles a ON p.article_id = a.id
    WHERE p.id = ?
  `).get(id)
  if (p?.storyboard_json) p.storyboard_json = JSON.parse(p.storyboard_json)
  if (p?.seo_json) p.seo_json = JSON.parse(p.seo_json)
  return p
}

export function getProjects({ status = null, limit = 20, offset = 0 } = {}) {
  const d = getDB()
  const conditions = []
  const params = []
  if (status) { conditions.push('p.editor_status = ?'); params.push(status) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return d.prepare(`
    SELECT p.*, a.title as article_title, a.url as article_url
    FROM editorial_projects p
    LEFT JOIN news_articles a ON p.article_id = a.id
    ${where}
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
}

export function updateProjectStatus(id, status) {
  const d = getDB()
  d.prepare(`UPDATE editorial_projects SET editor_status = ?, updated_at = datetime('now'), version = version + 1 WHERE id = ?`).run(status, id)
}

export function updateProject(id, fields) {
  const d = getDB()
  const allowed = ['title', 'script', 'tts_script', 'storyboard_json', 'seo_json', 'quality_score', 'template_id']
  const sets = []
  const params = []
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = ?`)
      params.push(typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k])
    }
  }
  if (sets.length) {
    params.push(id)
    d.prepare(`UPDATE editorial_projects SET ${sets.join(', ')}, updated_at = datetime('now'), version = version + 1 WHERE id = ?`).run(...params)
  }
}

// ===================================================================
// VIDEO TEMPLATES CRUD
// ===================================================================

export function createTemplate(template) {
  const d = getDB()
  const stmt = d.prepare(`
    INSERT INTO video_templates (name, category, version, scene_schema, animation_config, font_config, color_config, transition_config, music_config, created_by, parent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const info = stmt.run(
    template.name, template.category || 'technology', template.version || '1.0',
    JSON.stringify(template.scene_schema || {}),
    JSON.stringify(template.animation_config || {}),
    JSON.stringify(template.font_config || {}),
    JSON.stringify(template.color_config || {}),
    JSON.stringify(template.transition_config || {}),
    JSON.stringify(template.music_config || {}),
    template.created_by || null,
    template.parent_id || null,
  )
  return info.lastInsertRowid
}

export function getTemplate(id) {
  const d = getDB()
  const t = d.prepare(`SELECT * FROM video_templates WHERE id = ?`).get(id)
  if (!t) return null
  for (const k of ['scene_schema', 'animation_config', 'font_config', 'color_config', 'transition_config', 'music_config']) {
    if (t[k] && typeof t[k] === 'string') t[k] = JSON.parse(t[k])
  }
  return t
}

export function getActiveTemplates(category = null) {
  const d = getDB()
  if (category) return d.prepare(`SELECT * FROM video_templates WHERE status = 'active' AND category = ? ORDER BY version DESC`).all(category)
  return d.prepare(`SELECT * FROM video_templates WHERE status = 'active' ORDER BY category, version DESC`).all()
}

export function updateTemplate(id, fields) {
  const d = getDB()
  const allowed = ['name', 'category', 'scene_schema', 'animation_config', 'font_config', 'color_config', 'transition_config', 'music_config', 'status']
  const sets = ['updated_at = datetime(\'now\')']
  const params = []
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = ?`)
      params.push(typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k])
    }
  }
  params.push(id)
  d.prepare(`UPDATE video_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function cloneTemplate(id, newName) {
  const d = getDB()
  const original = getTemplate(id)
  if (!original) throw new Error(`Template ${id} not found`)
  const versionParts = original.version.split('.').map(Number)
  versionParts[1] = (versionParts[1] || 0) + 1
  const newVersion = versionParts.join('.')
  return createTemplate({
    name: newName || `${original.name} v${newVersion}`,
    category: original.category,
    version: newVersion,
    scene_schema: original.scene_schema,
    animation_config: original.animation_config,
    font_config: original.font_config,
    color_config: original.color_config,
    transition_config: original.transition_config,
    music_config: original.music_config,
    parent_id: id,
  })
}

// ===================================================================
// RENDER JOBS
// ===================================================================

export function createRenderJob(projectId, templateVersion) {
  const d = getDB()
  const stmt = d.prepare(`
    INSERT INTO render_jobs (project_id, template_version, renderer_version, git_commit, status)
    VALUES (?, ?, ?, ?, 'queued')
  `)
  const info = stmt.run(projectId, templateVersion, 'v3.0', process.env.GIT_COMMIT || 'dev')
  return info.lastInsertRowid
}

export function updateRenderJob(id, fields) {
  const d = getDB()
  const sets = []
  const params = []
  for (const k of ['status', 'started_at', 'completed_at', 'duration_ms', 'output_path', 'error_log']) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); params.push(fields[k]) }
  }
  if (sets.length) { params.push(id); d.prepare(`UPDATE render_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params) }
}

// ===================================================================
// PUBLISH JOBS
// ===================================================================

export function createPublishJob(projectId, renderJobId, { platform = 'youtube', privacy = 'public', scheduledTime = null } = {}) {
  const d = getDB()
  const stmt = d.prepare(`
    INSERT INTO publish_jobs (project_id, render_job_id, platform, privacy, scheduled_time, status)
    VALUES (?, ?, ?, ?, ?, 'queued')
  `)
  return stmt.run(projectId, renderJobId, platform, privacy, scheduledTime).lastInsertRowid
}

export function updatePublishJob(id, fields) {
  const d = getDB()
  const sets = []
  const params = []
  for (const k of ['status', 'youtube_id', 'published_time', 'override_reason', 'approved_by']) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); params.push(fields[k]) }
  }
  if (sets.length) { params.push(id); d.prepare(`UPDATE publish_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params) }
}

// ===================================================================
// AUDIT LOG
// ===================================================================

export function logAudit(action, entityType, entityId, userId = null, metadata = null) {
  const d = getDB()
  d.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, user_id, metadata) VALUES (?, ?, ?, ?, ?)`).run(
    action, entityType, entityId, userId, metadata ? JSON.stringify(metadata) : null
  )
}

export function getAuditLog({ entityType = null, entityId = null, limit = 50 } = {}) {
  const d = getDB()
  const conditions = []
  const params = []
  if (entityType) { conditions.push('entity_type = ?'); params.push(entityType) }
  if (entityId) { conditions.push('entity_id = ?'); params.push(entityId) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return d.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit)
}

// ===================================================================
// PROJECT ASSETS
// ===================================================================

export function recordAsset(projectId, assetType, filePath) {
  const d = getDB()
  let fileSize = null
  try {
    const st = statSync(filePath)
    fileSize = st.size
  } catch {}
  d.prepare(`INSERT INTO project_assets (project_id, asset_type, file_path, file_size) VALUES (?, ?, ?, ?)`).run(
    projectId, assetType, filePath, fileSize
  )
}

export function getProjectAssets(projectId) {
  const d = getDB()
  return d.prepare(`SELECT * FROM project_assets WHERE project_id = ? ORDER BY created_at`).all(projectId)
}

// ===================================================================
// SNAPSHOTS
// ===================================================================

export function createSnapshot(projectId, snapshotPath, sizeBytes) {
  const d = getDB()
  return d.prepare(`INSERT INTO snapshots (project_id, snapshot_path, size_bytes, hash) VALUES (?, ?, ?, ?)`).run(
    projectId, snapshotPath, sizeBytes, articleHash(snapshotPath, String(Date.now()))
  ).lastInsertRowid
}

export function getSnapshots(projectId) {
  const d = getDB()
  return d.prepare(`SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC`).all(projectId)
}

// CLI
if (import.meta.url.endsWith('db.mjs')) {
  initDatabase()
  console.log('Database initialized.')
  console.log(`Tables: users, news_articles, editorial_projects, video_templates, render_jobs, publish_jobs, project_assets, audit_log, snapshots`)
  console.log(`Path: ${DB_PATH}`)
}
