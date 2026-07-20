/**
 * V3 Newsroom Admin Dashboard
 *
 * Simple Express server that reads from the SQLite newsroom database.
 * Shows: news queue, render queue, publish queue, audit log.
 *
 * Run: node packages/dashboard/index.mjs
 * Visit: http://localhost:3456
 */

import express from 'express'
import { initDatabase, getDB, getArticles, getProjects, getAuditLog, getProject } from '../database/db.mjs'
import { listTemplates } from '../editorial/templates.mjs'
import { listStorageProjects } from '../storage/manager.mjs'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

initDatabase()

const app = express()
app.use(express.json())

// ========== API Routes ==========

// Dashboard summary
app.get('/api/dashboard', (req, res) => {
  const d = getDB()
  const stats = {
    articles: { total: d.prepare('SELECT COUNT(*) as c FROM news_articles').get().c, new: d.prepare("SELECT COUNT(*) as c FROM news_articles WHERE status='NEW'").get().c },
    projects: { total: d.prepare('SELECT COUNT(*) as c FROM editorial_projects').get().c, rendering: d.prepare("SELECT COUNT(*) as c FROM editorial_projects WHERE editor_status='RENDERING'").get().c, published: d.prepare("SELECT COUNT(*) as c FROM editorial_projects WHERE editor_status='PUBLISHED'").get().c },
    renders: { total: d.prepare('SELECT COUNT(*) as c FROM render_jobs').get().c, queued: d.prepare("SELECT COUNT(*) as c FROM render_jobs WHERE status='queued'").get().c, failed: d.prepare("SELECT COUNT(*) as c FROM render_jobs WHERE status='failed'").get().c },
    publishes: { total: d.prepare('SELECT COUNT(*) as c FROM publish_jobs').get().c, queued: d.prepare("SELECT COUNT(*) as c FROM publish_jobs WHERE status='queued'").get().c, published: d.prepare("SELECT COUNT(*) as c FROM publish_jobs WHERE status='published'").get().c },
    templates: d.prepare("SELECT COUNT(*) as c FROM video_templates WHERE status='active'").get().c,
    storage: listStorageProjects().length,
  }
  res.json(stats)
})

// Articles list
app.get('/api/articles', (req, res) => {
  const { status, category, limit = 20, offset = 0 } = req.query
  res.json(getArticles({ status: status || null, category: category || null, limit: Number(limit), offset: Number(offset) }))
})

// Projects list
app.get('/api/projects', (req, res) => {
  const { status, limit = 20, offset = 0 } = req.query
  res.json(getProjects({ status: status || null, limit: Number(limit), offset: Number(offset) }))
})

// Project detail
app.get('/api/projects/:id', (req, res) => {
  const project = getProject(Number(req.params.id))
  if (!project) return res.status(404).json({ error: 'Not found' })
  res.json(project)
})

// Templates list
app.get('/api/templates', (req, res) => {
  const { category } = req.query
  res.json(listTemplates(category || null))
})

// Render jobs
app.get('/api/renders', (req, res) => {
  const d = getDB()
  const { status, limit = 20 } = req.query
  const params = []
  let sql = 'SELECT r.*, p.title as project_title FROM render_jobs r LEFT JOIN editorial_projects p ON r.project_id = p.id'
  if (status) { sql += ' WHERE r.status = ?'; params.push(status) }
  sql += ' ORDER BY r.created_at DESC LIMIT ?'
  params.push(Number(limit))
  res.json(d.prepare(sql).all(...params))
})

// Publish jobs
app.get('/api/publishes', (req, res) => {
  const d = getDB()
  const { status, limit = 20 } = req.query
  const params = []
  let sql = 'SELECT p.*, pr.title as project_title FROM publish_jobs p LEFT JOIN editorial_projects pr ON p.project_id = pr.id'
  if (status) { sql += ' WHERE p.status = ?'; params.push(status) }
  sql += ' ORDER BY p.created_at DESC LIMIT ?'
  params.push(Number(limit))
  res.json(d.prepare(sql).all(...params))
})

// Audit log
app.get('/api/audit', (req, res) => {
  const { entity_type, entity_id, limit = 50 } = req.query
  res.json(getAuditLog({ entityType: entity_type || null, entityId: entity_id ? Number(entity_id) : null, limit: Number(limit) }))
})

// ========== Dashboard HTML ==========

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UNFILTERED Newsroom Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{background:#0F172A;color:#F8FAFC;font-family:Inter,system-ui,sans-serif}</style>
</head>
<body class="p-8">
<div class="max-w-7xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <h1 class="text-3xl font-bold">📰 UNFILTERED Newsroom</h1>
    <span class="text-sm opacity-60" id="lastUpdate"></span>
  </div>

  <!-- Stats Grid -->
  <div id="stats" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8"></div>

  <!-- Sections -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
    <div>
      <h2 class="text-xl font-bold mb-3">🕐 Recent Projects</h2>
      <div id="projects" class="space-y-2"></div>
    </div>
    <div>
      <h2 class="text-xl font-bold mb-3">🎬 Render Queue</h2>
      <div id="renders" class="space-y-2"></div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
    <div>
      <h2 class="text-xl font-bold mb-3">📤 Publish Queue</h2>
      <div id="publishes" class="space-y-2"></div>
    </div>
    <div>
      <h2 class="text-xl font-bold mb-3">📋 Audit Log</h2>
      <div id="audit" class="space-y-1 text-sm"></div>
    </div>
  </div>
</div>

<script>
const api = async (path) => { const r=await fetch(path); return r.json() }
const statusColor = (s) => ({NEW:'text-blue-400',DRAFT:'text-yellow-400',RENDERING:'text-purple-400',PUBLISHED:'text-green-400',FAILED:'text-red-400',completed:'text-green-400',queued:'text-yellow-400',failed:'text-red-400',published:'text-green-400',publishing:'text-purple-400',active:'text-green-400'})[s]||'text-gray-400'

async function load(){
  // Stats
  const stats = await api('/api/dashboard')
  document.getElementById('stats').innerHTML = Object.entries(stats).map(([k,v]) =>
    \`<div class="bg-slate-800/50 rounded-xl p-4">
      <div class="text-2xl font-bold">\${typeof v==='object'?v.total||0:v}</div>
      <div class="text-sm opacity-60">\${k.replace(/_/g,' ').toUpperCase()}</div>
      \${typeof v==='object'?Object.entries(v).filter(([k])=>k!=='total').map(([k2,v2])=>
        \`<div class="text-xs mt-1"><span class="\${statusColor(k2.toUpperCase())}">●</span> \${k2}: \${v2}</div>\`
      ).join(''):''}
    </div>\`
  ).join('')

  // Projects
  const projects = await api('/api/projects?limit=8')
  document.getElementById('projects').innerHTML = projects.length ? projects.map(p =>
    \`<div class="bg-slate-800/30 rounded-lg p-3 flex justify-between items-start">
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate">\${p.title||'Untitled'}</div>
        <div class="text-xs opacity-60 mt-1">#\${p.id} · \${p.category||'tech'} · \${(p.created_at||'').slice(0,10)}</div>
      </div>
      <span class="text-sm ml-2 \${statusColor(p.editor_status)}">\${p.editor_status}</span>
    </div>\`
  ).join('') : '<div class="text-sm opacity-50">No projects yet</div>'

  // Renders
  const renders = await api('/api/renders?limit=8')
  document.getElementById('renders').innerHTML = renders.length ? renders.map(r =>
    \`<div class="bg-slate-800/30 rounded-lg p-3 flex justify-between items-start">
      <div>
        <div class="text-sm font-medium truncate">\${r.project_title||'Project #'+r.project_id}</div>
        <div class="text-xs opacity-60 mt-1">Job #\${r.id} · \${r.template_version||'?'} · \${r.duration_ms?((r.duration_ms/1000).toFixed(1)+'s'):''}</div>
      </div>
      <span class="text-sm \${statusColor(r.status)}">\${r.status}</span>
    </div>\`
  ).join('') : '<div class="text-sm opacity-50">No render jobs</div>'

  // Publishes
  const publishes = await api('/api/publishes?limit=8')
  document.getElementById('publishes').innerHTML = publishes.length ? publishes.map(p =>
    \`<div class="bg-slate-800/30 rounded-lg p-3 flex justify-between items-start">
      <div>
        <div class="text-sm font-medium">\${p.project_title||'Project #'+p.project_id}</div>
        <div class="text-xs opacity-60 mt-1">\${p.youtube_id?'youtu.be/'+p.youtube_id:''} \${p.platform||'youtube'}</div>
      </div>
      <span class="text-sm \${statusColor(p.status)}">\${p.status}</span>
    </div>\`
  ).join('') : '<div class="text-sm opacity-50">No publish jobs</div>'

  // Audit
  const audit = await api('/api/audit?limit=12')
  document.getElementById('audit').innerHTML = audit.map(a =>
    \`<div class="flex justify-between text-xs">
      <span class="opacity-80">\${a.action}</span>
      <span class="opacity-40">\${(a.created_at||'').slice(11,19)}</span>
    </div>\`
  ).join('')

  document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString()
}
load()
setInterval(load, 10000)
</script>
</body>
</html>`

app.get('/', (req, res) => res.type('html').send(HTML))

const PORT = process.env.DASHBOARD_PORT || 3456
app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════╗`)
  console.log(`║  📰  UNFILTERED Newsroom Dashboard   ║`)
  console.log(`║───────────────────────────────────────║`)
  console.log(`║  http://localhost:${PORT}                 ║`)
  console.log(`║                                       ║`)
  console.log(`║  API:                                 ║`)
  console.log(`║  /api/dashboard    - Stats             ║`)
  console.log(`║  /api/articles     - News articles     ║`)
  console.log(`║  /api/projects     - Editorial projects║`)
  console.log(`║  /api/templates    - Templates         ║`)
  console.log(`║  /api/renders      - Render queue      ║`)
  console.log(`║  /api/publishes    - Publish queue     ║`)
  console.log(`║  /api/audit        - Audit log         ║`)
  console.log(`╚═══════════════════════════════════════╝\n`)
})
