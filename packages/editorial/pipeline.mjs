/**
 * Editorial Pipeline Orchestrator (V3 Newsroom)
 *
 * End-to-end pipeline:
 *   Ingest → Dedup → AI Editorial → Template Select → Storyboard → Render → Publish → Audit
 *
 * Supports: auto, manual, and override publishing modes.
 */

import {
  initDatabase,
  insertArticle, findArticleByHash, findArticleByUrl, updateArticleStatus,
  createProject, getProject, updateProject, updateProjectStatus,
  createRenderJob, updateRenderJob,
  createPublishJob, updatePublishJob,
  logAudit, getDB,
} from '../database/db.mjs'
import { resolveTemplate, generateStoryboard, DEFAULT_TEMPLATES } from './templates.mjs'
import { initProjectStorage, writeJSON, storeFile } from '../storage/manager.mjs'

// Ensure database on import
initDatabase()

// ===================================================================
// STEP 1: INGEST + DEDUP
// ===================================================================

/**
 * Ingest a raw article from any source.
 * Returns the article record or null if duplicate rejected.
 */
export async function ingestArticle(article) {
  const hash = article.title + '|' + (article.source || 'newsapi')

  // Dedup check: same hash (title + source)
  const existing = findArticleByHash(hash)
  if (existing) {
    console.log(`⏭️  Duplicate rejected: "${article.title?.slice(0, 50)}..."`)
    logAudit('duplicate.rejected', 'news_articles', existing.id, null, { hash, reason: 'title+source match' })
    return null
  }

  // Dedup check: same URL
  if (article.url) {
    const byUrl = findArticleByUrl(article.url)
    if (byUrl) {
      console.log(`⏭️  URL duplicate rejected: ${article.url}`)
      logAudit('duplicate.rejected', 'news_articles', byUrl.id, null, { url: article.url })
      return null
    }
  }

  // Insert new article
  const id = insertArticle(article)
  console.log(`📰 Ingested: #${id} "${article.title?.slice(0, 60)}..."`)
  logAudit('article.created', 'news_articles', id, null, { source: article.source, category: article.category })
  return { id, ...article }
}

// ===================================================================
// STEP 2: CREATE EDITORIAL PROJECT
// ===================================================================

/**
 * Create an editorial project from an article.
 * Selects template, generates storyboard, prepares script.
 */
export async function createEditorialProject(article) {
  updateArticleStatus(article.id, 'PROCESSING')

  // Select best template
  const template = resolveTemplate(article)
  const templateId = template.id || null

  // Generate storyboard
  const storyboard = generateStoryboard(article, template)

  // Generate SEO metadata
  const seo = {
    title: article.title?.slice(0, 100) || '',
    description: article.description?.slice(0, 160) || '',
    tags: [article.category, 'news', 'technology', 'breaking'].filter(Boolean),
  }

  // Build narration script
  const ttsScript = `${article.title}. ${article.description ? article.description.split('.')[0] + '. ' : ''}According to ${article.source || 'NewsAPI'}.`

  // Create project
  const projectId = createProject(article.id, article.title, {
    script: article.description || article.title,
    ttsScript,
    storyboard: storyboard,
    seo,
    category: article.category || 'technology',
    sourceName: article.source || 'NewsAPI',
    imageUrl: article.imageUrl || article.image_url || null,
    templateId,
  })

  console.log(`📝 Project #${projectId} created for: "${article.title?.slice(0, 60)}..."`)
  logAudit('project.created', 'editorial_projects', projectId, null, { article_id: article.id, template: template.name })

  updateArticleStatus(article.id, 'APPROVED')

  return { projectId, template, storyboard, ttsScript }
}

// ===================================================================
// STEP 3: SET UP STORAGE
// ===================================================================

/**
 * Initialize project storage directories and save metadata.
 */
export function setupProjectStorage(projectId, article, storyboard, ttsScript) {
  const dirs = initProjectStorage(article)

  // Save article data
  writeJSON(dirs.base, 'article.json', {
    id: article.id,
    title: article.title,
    description: article.description,
    source: article.source,
    url: article.url,
    image_url: article.imageUrl || article.image_url,
    published_at: article.publishedAt || article.published_at,
    category: article.category,
  })

  // Save script data
  writeJSON(dirs.base, 'script.json', {
    tts_script: ttsScript,
    raw_script: article.description || article.title,
  })

  // Save storyboard
  writeJSON(dirs.base, 'storyboard.json', storyboard)

  logAudit('storage.initialized', 'editorial_projects', projectId, null, { storage_path: dirs.base })

  return dirs
}

// ===================================================================
// STEP 4: QUEUE RENDER JOB
// ===================================================================

/**
 * Create a render job record and return it.
 */
export function queueRenderJob(projectId, templateVersion) {
  const jobId = createRenderJob(projectId, templateVersion)
  console.log(`🎬 Render job #${jobId} queued for project #${projectId}`)
  logAudit('render.queued', 'render_jobs', jobId, null, { project_id: projectId })
  return jobId
}

// ===================================================================
// STEP 5: PUBLISH
// ===================================================================

/**
 * Queue a publish job (auto mode) or require approval (manual mode).
 */
export function queuePublishJob(projectId, renderJobId, { mode = 'auto', privacy = 'public' } = {}) {
  if (mode === 'auto') {
    const jobId = createPublishJob(projectId, renderJobId, { privacy })
    console.log(`📤 Publish job #${jobId} queued (auto mode)`)
    logAudit('publish.queued', 'publish_jobs', jobId, null, { mode: 'auto' })
    return jobId
  }

  if (mode === 'manual') {
    const jobId = createPublishJob(projectId, renderJobId, { privacy, scheduledTime: null })
    console.log(`⏳ Publish job #${jobId} requires approval`)
    logAudit('publish.pending_approval', 'publish_jobs', jobId, null, { mode: 'manual' })
    return { jobId, requiresApproval: true }
  }

  throw new Error(`Unknown publish mode: ${mode}`)
}

/**
 * Approve a pending publish job (manual mode).
 */
export function approvePublishJob(jobId, userId = null, overrideReason = null) {
  updatePublishJob(jobId, {
    status: 'queued',
    approved_by: userId,
    override_reason: overrideReason || null,
  })
  logAudit('publish.approved', 'publish_jobs', jobId, userId, { override_reason: overrideReason })
}

/**
 * Override publish (admin force publish, records reason).
 */
export function overridePublish(projectId, renderJobId, userId, reason) {
  const jobId = createPublishJob(projectId, renderJobId, { privacy: 'public' })
  updatePublishJob(jobId, { status: 'queued', override_reason: reason, approved_by: userId })
  logAudit('publish.override', 'publish_jobs', jobId, userId, { reason })
  return jobId
}

// ===================================================================
// FULL PIPELINE (ONE-SHOT)
// ===================================================================

/**
 * Run the full pipeline for one article: ingest → project → storage → render → publish.
 * Used by the GitHub Actions composer flow.
 */
export async function runFullPipeline(article, { mode = 'auto', publish = true } = {}) {
  console.log('\n═══════════════════════════════════════')
  console.log('🎬  V3 Pipeline Start')
  console.log('═══════════════════════════════════════\n')

  // 1. Ingest + dedup
  const ingested = await ingestArticle(article)
  if (!ingested) {
    console.log('⏭️  Skipped (duplicate)')
    return { skipped: true, reason: 'duplicate' }
  }

  // 2. Editorial project
  const { projectId, template, storyboard, ttsScript } = await createEditorialProject(ingested)

  // 3. Storage
  const dirs = setupProjectStorage(projectId, ingested, storyboard, ttsScript)

  // 4. Render (delegates to external renderer)
  const renderJobId = queueRenderJob(projectId, template.version)
  updateProjectStatus(projectId, 'RENDERING')

  // Return the context so the renderer can use it
  const result = {
    projectId,
    renderJobId,
    article: ingested,
    template,
    storyboard,
    ttsScript,
    dirs,
    mode,
  }

  console.log('\n═══════════════════════════════════════')
  console.log(`📋  Pipeline Context Ready`)
  console.log(`    Project:  #${projectId}`)
  console.log(`    Render:   #${renderJobId}`)
  console.log(`    Template: ${template.name} v${template.version}`)
  console.log(`    Storage:  ${dirs.base}`)
  console.log(`    Scenes:   ${storyboard.scenes.length} (${storyboard.total_duration}s)`)
  console.log('═══════════════════════════════════════\n')

  return result
}

/**
 * Mark a render as completed and optionally trigger publish.
 */
export async function completeRender(projectId, renderJobId, outputPath, durationMs) {
  updateRenderJob(renderJobId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
    output_path: outputPath,
  })
  updateProjectStatus(projectId, 'PUBLISHED')

  logAudit('render.completed', 'render_jobs', renderJobId, null, { output_path: outputPath, duration_ms: durationMs })
  console.log(`✅ Render #${renderJobId} completed in ${(durationMs / 1000).toFixed(1)}s`)
}

/**
 * Mark a render as failed.
 */
export async function failRender(renderJobId, errorLog) {
  updateRenderJob(renderJobId, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    error_log: errorLog?.slice(0, 2000),
  })
  logAudit('render.failed', 'render_jobs', renderJobId, null, { error: errorLog?.slice(0, 200) })
  console.log(`❌ Render #${renderJobId} failed`)
}

// CLI test
if (import.meta.url.endsWith('pipeline.mjs')) {
  const testArticle = {
    title: process.argv[2] || 'Actually See How Apple Is Completely Replacing Siri With iOS 27',
    description: 'Apple is rolling out a next-generation AI assistant that completely replaces Siri across all devices.',
    source: 'Geeky Gadgets',
    url: 'https://www.geeky-gadgets.com/ios-27-siri-replacement/',
    imageUrl: null,
    category: 'technology',
    publishedAt: new Date().toISOString(),
  }
  runFullPipeline(testArticle, { mode: 'auto', publish: false })
}
