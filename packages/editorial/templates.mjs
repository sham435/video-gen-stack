/**
 * Template Management System (V3 Newsroom)
 *
 * CRUD + versioning + rollback for video templates.
 * Templates control ALL visual parameters: scenes, animations, fonts, colors.
 */

import { getDB, getTemplate, getActiveTemplates, createTemplate, updateTemplate, cloneTemplate, logAudit } from '../database/db.mjs'

// ===================================================================
// DEFAULT TEMPLATES (built-in)
// ===================================================================

export const DEFAULT_TEMPLATES = {
  'technology-v1': {
    name: 'Technology News v1',
    category: 'technology',
    version: '1.0',
    scene_schema: {
      scenes: [
        { type: 'headline', duration: 5 },
        { type: 'keypoint', duration: 4 },
        { type: 'summary', duration: 3 },
      ],
    },
    animation_config: {
      ken_burns: true,
      zoom_range: [1.0, 1.12],
      parallax: true,
      particles: true,
      transition_duration: 0.6,
    },
    font_config: {
      headline: { family: 'Inter', weight: 800, size: 72 },
      subheadline: { family: 'Inter', weight: 500, size: 38 },
      body: { family: 'Inter', weight: 400, size: 28 },
      caption: { family: 'Inter', weight: 500, size: 18 },
    },
    color_config: {
      bg: ['#07111F', '#0F172A', '#111827'],
      primary: '#3B82F6',
      accent: '#22D3EE',
      success: '#10B981',
      warning: '#F59E0B',
      breaking: '#EF4444',
      text: '#F8FAFC',
      glass: 'rgba(255,255,255,0.08)',
    },
    transition_config: {
      type: 'fade',
      duration: 0.6,
      variants: ['fade', 'blur', 'light_sweep', 'directional'],
    },
    music_config: {
      style: 'lofi',
      volume: 0.12,
      duck_under_voice: true,
      fade_in: 1.2,
      fade_out: 1.2,
    },
  },
  'breaking-v1': {
    name: 'Breaking News v1',
    category: 'technology',
    version: '1.0',
    scene_schema: {
      scenes: [
        { type: 'headline', duration: 6 },
        { type: 'quote', duration: 5 },
        { type: 'summary', duration: 4 },
      ],
    },
    animation_config: {
      ken_burns: true,
      zoom_range: [1.0, 1.15],
      particles: true,
      transition_duration: 0.4,
      glitch: true,
    },
    font_config: {
      headline: { family: 'Anton', weight: 900, size: 96 },
      body: { family: 'Inter', weight: 400, size: 32 },
      caption: { family: 'Inter', weight: 500, size: 18 },
    },
    color_config: {
      bg: ['#1A0000', '#2A0000', '#0A0000'],
      primary: '#EF4444',
      accent: '#DC2626',
      text: '#FFFFFF',
      glass: 'rgba(255,255,255,0.06)',
    },
    transition_config: {
      type: 'glitch',
      duration: 0.3,
      variants: ['glitch', 'light_sweep'],
    },
    music_config: {
      style: 'cinematic',
      volume: 0.15,
      duck_under_voice: true,
    },
  },
}

// ===================================================================
// TEMPLATE CRUD
// ===================================================================

/**
 * List all active templates, optionally filtered by category.
 */
export function listTemplates(category = null) {
  return getActiveTemplates(category)
}

/**
 * Get a template by ID with parsed JSON fields.
 */
export function getTemplateById(id) {
  return getTemplate(id)
}

/**
 * Create a new template from config.
 */
export function createNewTemplate(config) {
  const id = createTemplate(config)
  logAudit('template.created', 'video_templates', id, null, { name: config.name, version: config.version })
  return id
}

/**
 * Update template fields.
 */
export function editTemplate(id, fields) {
  updateTemplate(id, fields)
  logAudit('template.updated', 'video_templates', id, null, { fields: Object.keys(fields) })
  return getTemplate(id)
}

/**
 * Clone an existing template as a new version.
 */
export function forkTemplate(id, newName) {
  const newId = cloneTemplate(id, newName)
  const original = getTemplate(id)
  logAudit('template.cloned', 'video_templates', newId, null, { parent_id: id, parent_version: original?.version })
  return getTemplate(newId)
}

/**
 * Archive a template (soft delete).
 */
export function archiveTemplate(id) {
  updateTemplate(id, { status: 'archived' })
  logAudit('template.archived', 'video_templates', id)
}

/**
 * Rollback to a previous template version by creating a new version from an older one.
 */
export function rollbackTemplate(currentId, targetVersion) {
  // Find the template with matching version in the version chain
  const d = getDB()
  const target = d.prepare(`SELECT * FROM video_templates WHERE id != ? AND status = 'active' AND version = ? ORDER BY created_at DESC LIMIT 1`).get(currentId, targetVersion)
  if (!target) throw new Error(`Template version ${targetVersion} not found`)
  const newId = cloneTemplate(target.id, `${target.name} rollback-${target.version}`)
  logAudit('template.rollback', 'video_templates', newId, null, { from: currentId, to_version: targetVersion })
  return getTemplate(newId)
}

// ===================================================================
// RESOLVE: BEST TEMPLATE FOR ARTICLE
// ===================================================================

/**
 * Pick the best template for a given article based on category + content.
 */
export function resolveTemplate(article) {
  const cat = (article.category || 'technology').toLowerCase()
  const title = (article.title || '').toLowerCase()

  // Check for breaking news content
  const isBreaking = title.includes('breaking') || title.includes('urgent') || title.includes('just in')
  const preferred = isBreaking ? 'breaking-v1' : 'technology-v1'

  // Look for an active template in DB first
  const active = getActiveTemplates(cat)
  if (active.length > 0) return active[0]

  // Fall back to built-in defaults
  return DEFAULT_TEMPLATES[preferred] || DEFAULT_TEMPLATES['technology-v1']
}

// ===================================================================
// STORYBOARD GENERATOR
// ===================================================================

/**
 * Convert an article + template into a storyboard.
 */
export function generateStoryboard(article, template) {
  const schema = template.scene_schema || { scenes: [{ type: 'headline', duration: 5 }, { type: 'summary', duration: 3 }] }
  const title = article.title || ''
  const desc = article.description || ''
  const source = article.source || 'NewsAPI'

  const scenes = schema.scenes.map((sceneDef, i) => {
    const scene = {
      type: sceneDef.type,
      duration: sceneDef.duration || 4,
      headline: i === 0 ? title : (desc ? desc.split('.')[0] : title.slice(0, 60)),
    }

    if (sceneDef.type === 'keypoint' && desc) {
      scene.body = desc.slice(0, 120)
    }
    if (sceneDef.type === 'summary') {
      scene.subheadline = `According to ${source}`
    }
    if (sceneDef.type === 'stat') {
      scene.stat = '99%'
      scene.statLabel = 'Relevance Score'
    }

    return scene
  })

  return {
    template_version: template.version,
    template_name: template.name,
    scenes,
    total_duration: scenes.reduce((sum, s) => sum + s.duration, 0),
    config: {
      animation: template.animation_config,
      fonts: template.font_config,
      colors: template.color_config,
      transitions: template.transition_config,
      music: template.music_config,
    },
  }
}

if (import.meta.url.endsWith('templates.mjs')) {
  console.log('📋 Available templates:')
  for (const [key, t] of Object.entries(DEFAULT_TEMPLATES)) {
    console.log(`  ${key}: ${t.name} (v${t.version})`)
  }
}
