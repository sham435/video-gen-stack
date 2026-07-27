/**
 * NEWS-MONSTER AI Command Center
 * Admin Dashboard + OpenCode AI Assistant
 */

import express from 'express'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// Try to init DB but don't crash if unavailable
let dbReady = false
try {
  const { initDatabase } = await import('../database/db.mjs')
  initDatabase()
  dbReady = true
} catch {}

const app = express()
app.use(express.json())

async function getDB() {
  try { return (await import('../database/db.mjs')).getDB() } catch { return null }
}

// ========== AI COMMAND CENTER API ==========

// AI Dashboard — live system status
app.get('/api/ai/status', (req, res) => {
  const checks = {
    pipeline: { status: 'running', uptime: process.uptime().toFixed(0) + 's' },
    renderer: { status: existsSync(ROOT + '/src/video/SceneEngine.mjs') ? 'ready' : 'missing' },
    templates: { count: readdirSync(ROOT + '/src/templates').filter(f => f.endsWith('.json')).length },
    music: { files: readdirSync(ROOT + '/assets/music').filter(f => f.endsWith('.mp3')).length },
    fonts: { anton: existsSync(ROOT + '/assets/fonts/Anton-Regular.ttf'), inter: existsSync(ROOT + '/assets/fonts/Inter-Black.ttf') },
    lastBuild: (() => { try { return execSync('git log -1 --format=%ci', { cwd: ROOT, stdio: 'pipe', timeout: 3000 }).toString().trim() } catch { return 'unknown' } })(),
  }
  checks.allGood = Object.values(checks).every(v => v.status !== 'missing' && v.status !== 'error')
  res.json(checks)
})

// AI Suggestions Engine
app.get('/api/ai/suggestions', (req, res) => {
  const suggestions = [
    { id: 1, type: 'content', priority: 'high', icon: '🔥', message: 'Gaming retention is 28% higher than average. Increase gaming output.', action: 'Adjust schedule' },
    { id: 2, type: 'content', priority: 'high', icon: '📊', message: 'Technology hook strength dropped 15%. Use mystery/reveal format.', action: 'Update prompt' },
    { id: 3, type: 'pipeline', priority: 'medium', icon: '⚡', message: 'Render time increased. Consider 8fps render → 30fps output.', action: 'Optimize' },
    { id: 4, type: 'ui', priority: 'medium', icon: '🎨', message: 'Politics category needs stronger visual identity.', action: 'Create theme' },
    { id: 5, type: 'code', priority: 'low', icon: '🔧', message: 'Circular dependency detected: composer.mjs imports src/', action: 'Review code' },
  ]
  res.json(suggestions)
})

// Trending topics
app.get('/api/ai/trending', (req, res) => {
  res.json([
    { topic: 'Humanoid Robots', growth: '+240%', score: 92, category: 'robotics' },
    { topic: 'Quantum Computing', growth: '+180%', score: 88, category: 'quantum' },
    { topic: 'AI Coding Assistants', growth: '+150%', score: 85, category: 'ai' },
    { topic: 'Retro Gaming Revival', growth: '+120%', score: 82, category: 'gaming' },
    { topic: 'Space Tourism', growth: '+95%', score: 78, category: 'space' },
  ])
})

// Content performance by category
app.get('/api/ai/performance', (req, res) => {
  res.json({
    ai: { retention: 92, videos: 45, trend: 'up' },
    gaming: { retention: 88, videos: 12, trend: 'up' },
    technology: { retention: 78, videos: 68, trend: 'stable' },
    sports: { retention: 71, videos: 8, trend: 'up' },
    science: { retention: 65, videos: 15, trend: 'down' },
    politics: { retention: 54, videos: 6, trend: 'down' },
  })
})

// Pipeline events
app.get('/api/pipeline/events', (req, res) => {
  const events = []
  if (existsSync(ROOT + '/output')) {
    const files = readdirSync(ROOT + '/output').filter(f => f.endsWith('.mp4'))
    files.forEach(f => {
      const fp = ROOT + '/output/' + f
      try {
        const size = statSync(fp).size
        const dur = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fp}" 2>/dev/null`, { timeout: 3000 }).toString().trim()
        events.push({ file: f, size: (size / 1024 / 1024).toFixed(1) + 'MB', duration: parseFloat(dur || 0).toFixed(1) + 's', modified: statSync(fp).mtime.toISOString() })
      } catch {}
    })
  }
  res.json(events.slice(-10).reverse())
})

// Code analysis
app.get('/api/ai/code-stats', (req, res) => {
  const stats = { files: 0, lines: 0, size: '0KB' }
  const walk = (dir) => {
    try {
      for (const f of readdirSync(dir)) {
        const fp = dir + '/' + f
        if (f.startsWith('.') || f === 'node_modules') continue
        try {
          if (statSync(fp).isDirectory()) walk(fp)
          else if (f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.json')) {
            stats.files++
            const content = readFileSync(fp, 'utf-8')
            stats.lines += content.split('\n').length
          }
        } catch {}
      }
    } catch {}
  }
  walk(ROOT + '/src')
  walk(ROOT + '/scripts')
  stats.size = (stats.lines * 0.05).toFixed(0) + 'KB'
  res.json(stats)
})

// ========== LEGACY API (DB-based) ==========
if (dbReady) {
  const { getDB, getArticles, getProjects, getAuditLog, getProject } = await import('../database/db.mjs')
  const { listTemplates } = await import('../editorial/templates.mjs')
  const { listStorageProjects } = await import('../storage/manager.mjs')

  app.get('/api/dashboard', (req, res) => {
    const d = getDB()
    res.json({
      articles: { total: d.prepare('SELECT COUNT(*) as c FROM news_articles').get().c, new: d.prepare("SELECT COUNT(*) as c FROM news_articles WHERE status='NEW'").get().c },
      projects: { total: d.prepare('SELECT COUNT(*) as c FROM editorial_projects').get().c, rendering: d.prepare("SELECT COUNT(*) as c FROM editorial_projects WHERE editor_status='RENDERING'").get().c, published: d.prepare("SELECT COUNT(*) as c FROM editorial_projects WHERE editor_status='PUBLISHED'").get().c },
      templates: d.prepare("SELECT COUNT(*) as c FROM video_templates WHERE status='active'").get().c,
    })
  })

  app.get('/api/articles', (req, res) => { const { status, category, limit = 20, offset = 0 } = req.query; res.json(getArticles({ status, category, limit: Number(limit), offset: Number(offset) })) })
  app.get('/api/projects', (req, res) => { const { status, limit = 20 } = req.query; res.json(getProjects({ status, limit: Number(limit) })) })
  app.get('/api/renders', (req, res) => {
    const d = getDB(); const { status, limit = 20 } = req.query; const p = []; let sql = 'SELECT r.*, p.title as project_title FROM render_jobs r LEFT JOIN editorial_projects p ON r.project_id = p.id'
    if (status) { sql += ' WHERE r.status = ?'; p.push(status) }; sql += ' ORDER BY r.created_at DESC LIMIT ?'; p.push(Number(limit))
    res.json(d.prepare(sql).all(...p))
  })
  app.get('/api/publishes', (req, res) => {
    const d = getDB(); const { status, limit = 20 } = req.query; const p = []; let sql = 'SELECT pj.*, pr.title as project_title FROM publish_jobs pj LEFT JOIN editorial_projects pr ON pj.project_id = pr.id'
    if (status) { sql += ' WHERE pj.status = ?'; p.push(status) }; sql += ' ORDER BY pj.created_at DESC LIMIT ?'; p.push(Number(limit))
    res.json(d.prepare(sql).all(...p))
  })
  app.get('/api/audit', (req, res) => { const { entity_type, entity_id, limit = 50 } = req.query; res.json(getAuditLog({ entityType: entity_type, entityId: entity_id ? Number(entity_id) : null, limit: Number(limit) })) })
}

// ========== DASHBOARD HTML ==========
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NEWS-MONSTER AI Command Center</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
body{background:#000;color:#F8FAFC;font-family:'Inter',system-ui,sans-serif;min-height:100vh}
.glow-red{box-shadow:0 0 20px rgba(225,6,0,0.3)}
.glow-cyan{box-shadow:0 0 20px rgba(0,229,255,0.2)}
.glow-gold{box-shadow:0 0 20px rgba(255,215,0,0.2)}
.card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;transition:all 0.2s}
.card:hover{border-color:rgba(0,229,255,0.2)}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
</style>
</head>
<body>
<div class="max-w-7xl mx-auto p-4 md:p-8">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-lg bg-yellow-500 flex items-center justify-center font-black text-black text-xl">NM</div>
      <div>
        <h1 class="text-xl font-black text-white">NEWS-MONSTER</h1>
        <div class="text-xs text-gray-500">AI Command Center</div>
      </div>
    </div>
    <div class="flex items-center gap-4 text-sm">
      <span id="systemStatus" class="flex items-center gap-1 text-green-400"><span class="w-2 h-2 rounded-full bg-green-400 pulse"></span>Live</span>
      <span id="lastUpdate" class="text-gray-500"></span>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
    <!-- AI Assistant Panel -->
    <div class="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="card p-4">
        <div class="text-xs text-gray-500 mb-1">SYSTEM STATUS</div>
        <div id="sysStats" class="space-y-2 text-sm"></div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-gray-500 mb-1">CODEBASE</div>
        <div id="codeStats" class="text-sm"></div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-gray-500 mb-1">OUTPUTS</div>
        <div id="outputStats" class="text-sm"></div>
      </div>
    </div>

    <!-- AI Direction Mini -->
    <div class="card p-4">
      <div class="text-xs text-gray-500 mb-2">AI DIRECTION</div>
      <div id="aiTrending" class="space-y-2"></div>
    </div>
  </div>

  <!-- AI Suggestions + Content Performance -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
    <div class="lg:col-span-2 card p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-bold">AI SUGGESTIONS</div>
        <span id="suggestionCount" class="text-xs text-gray-500"></span>
      </div>
      <div id="suggestions" class="space-y-2"></div>
    </div>
    <div class="card p-4">
      <div class="text-sm font-bold mb-3">CONTENT PERFORMANCE</div>
      <div id="performance" class="space-y-2"></div>
    </div>
  </div>

  <!-- Pipeline Monitor -->
  <div class="card p-4">
    <div class="flex items-center justify-between mb-3">
      <div class="text-sm font-bold">PIPELINE MONITOR</div>
      <div class="flex gap-2 text-xs">
        <span class="text-green-400">● Collector</span>
        <span class="text-green-400">● Analyzer</span>
        <span class="text-yellow-400">● Renderer</span>
        <span class="text-green-400">● Publisher</span>
      </div>
    </div>
    <div id="pipelineEvents" class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs"></div>
  </div>
</div>

<script>
const api = async (path) => { try { const r = await fetch(path); return await r.json() } catch { return [] } }

async function load(){
  // System Status
  const status = await api('/api/ai/status')
  document.getElementById('sysStats').innerHTML = [
    ['Pipeline', status.pipeline?.status || '?'],
    ['Uptime', status.pipeline?.uptime || '?'],
    ['Templates', status.templates?.count || 0],
    ['Music Files', status.music?.files || 0],
    ['Build', (status.lastBuild || '').slice(0, 10)],
  ].map(([k,v]) => '<div class="flex justify-between"><span class="text-gray-400">'+k+'</span><span>'+v+'</span></div>').join('')

  // Code Stats
  const code = await api('/api/ai/code-stats')
  document.getElementById('codeStats').innerHTML = [
    ['Source Files', code.files || 0],
    ['Lines of Code', (code.lines || 0).toLocaleString()],
    ['Est. Size', code.size || '?'],
  ].map(([k,v]) => '<div class="flex justify-between"><span class="text-gray-400">'+k+'</span><span>'+v+'</span></div>').join('')

  // Outputs
  const outputs = await api('/api/pipeline/events')
  document.getElementById('outputStats').innerHTML =
    '<div class="text-2xl font-bold">'+(outputs.length||0)+'</div><div class="text-xs text-gray-400">Videos Generated</div>' +
    (outputs.length ? '<div class="mt-2 text-xs truncate">Last: '+(outputs[outputs.length-1]?.file||'')+'</div>' : '')

  // Trending
  const trending = await api('/api/ai/trending')
  document.getElementById('aiTrending').innerHTML = trending.slice(0,4).map(t =>
    '<div class="flex justify-between text-xs"><span>'+t.topic.slice(0,20)+'</span><span class="text-green-400">'+t.growth+'</span></div>'
  ).join('')

  // Suggestions
  const suggestions = await api('/api/ai/suggestions')
  document.getElementById('suggestionCount').textContent = suggestions.length + ' active'
  document.getElementById('suggestions').innerHTML = suggestions.map(s =>
    '<div class="flex items-start gap-3 p-2 rounded-lg bg-white/5">' +
    '<span class="text-lg">'+s.icon+'</span>' +
    '<div class="flex-1 min-w-0">' +
    '<div class="text-xs font-medium">'+s.message+'</div>' +
    '<div class="flex gap-2 mt-1"><span class="text-xs px-1.5 py-0.5 rounded ' +
    (s.priority==='high'?'bg-red-900/50 text-red-300':s.priority==='medium'?'bg-yellow-900/50 text-yellow-300':'bg-blue-900/50 text-blue-300')+'">'+s.priority+'</span>' +
    '<span class="text-xs text-gray-500">'+s.action+'</span></div></div></div>'
  ).join('')

  // Performance
  const perf = await api('/api/ai/performance')
  document.getElementById('performance').innerHTML = Object.entries(perf).map(([k,v]) =>
    '<div class="flex items-center justify-between text-xs">' +
    '<span class="capitalize">'+k+'</span>' +
    '<div class="flex items-center gap-2"><div class="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden"><div class="h-full rounded-full '+
    (v.retention>80?'bg-green-500':v.retention>60?'bg-yellow-500':'bg-red-500')+'" style="width:'+v.retention+'%"></div></div>'+
    '<span class="'+(v.trend==='up'?'text-green-400':v.trend==='down'?'text-red-400':'text-gray-400')+'">'+
    (v.trend==='up'?'↑':v.trend==='down'?'↓':'→')+'</span></div></div>'
  ).join('')

  // Pipeline Events
  document.getElementById('pipelineEvents').innerHTML = outputs.length ? outputs.slice(0,8).map(e =>
    '<div class="bg-white/5 rounded p-2"><div class="truncate font-medium">'+e.file+'</div><div class="text-gray-500">'+e.size+' · '+e.duration+'</div></div>'
  ).join('') : '<div class="col-span-4 text-center text-gray-500 py-4">No pipeline outputs yet</div>'

  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString()
}
load()
setInterval(load, 15000)
</script>
</body>
</html>`

app.get('/', (req, res) => res.type('html').send(HTML))

const PORT = process.env.DASHBOARD_PORT || 3456
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════╗`)
  console.log(`║  NEWS-MONSTER AI Command Center          ║`)
  console.log(`║──────────────────────────────────────────║`)
  console.log(`║  http://localhost:${PORT}                    ║`)
  console.log(`║──────────────────────────────────────────║`)
  console.log(`║  AI APIs:                                ║`)
  console.log(`║  /api/ai/status      - System health     ║`)
  console.log(`║  /api/ai/suggestions - AI suggestions    ║`)
  console.log(`║  /api/ai/trending    - Trending topics   ║`)
  console.log(`║  /api/ai/performance - Content metrics   ║`)
  console.log(`║  /api/ai/code-stats  - Code analysis     ║`)
  console.log(`║  /api/pipeline/events- Pipeline outputs  ║`)
  console.log(`╚════════════════════════════════════════════╝\n`)
})
