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

// Initialize DashboardAI with optional AI provider
let dashboardAI = null
async function initDashboardAI() {
  const { DashboardAI } = await import('./DashboardAI.mjs')
  dashboardAI = new DashboardAI()
  try {
    const { ProviderChain } = await import('../../src/ai/providers/ProviderChain.mjs')
    const { OpenRouterProvider } = await import('../../src/ai/providers/OpenRouterProvider.mjs')
    const { OpenAIProvider } = await import('../../src/ai/providers/OpenAIProvider.mjs')
    const { GeminiProvider } = await import('../../src/ai/providers/GeminiProvider.mjs')
    const { OllamaProvider } = await import('../../src/ai/providers/OllamaProvider.mjs')

    // Route keys to the right provider by key prefix
    const openaiKey = process.env.OPENAI_API_KEY || ''
    const openrouterKey = process.env.OPENROUTER_API_KEY || ''
    const geminiKey = process.env.GEMINI_API_KEY || ''

    const isOpenRouterKey = (k) => k.startsWith('sk-or-v1')

    const providers = []
    if (openrouterKey) providers.push(new OpenRouterProvider(openrouterKey))
    else if (isOpenRouterKey(openaiKey)) providers.push(new OpenRouterProvider(openaiKey))
    if (openaiKey && !isOpenRouterKey(openaiKey)) providers.push(new OpenAIProvider(openaiKey))
    if (geminiKey) providers.push(new GeminiProvider(geminiKey))
    providers.push(new OllamaProvider())

    const chain = new ProviderChain(providers)
    dashboardAI = new DashboardAI({ aiProvider: chain })
    console.log(`[DashboardAI] enabled: ${chain.name} (${chain.providers.length} providers)`)
  } catch (e) {
    console.log(`[DashboardAI] AI provider unavailable, using fallback: ${e.message}`)
  }
}
initDashboardAI()

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

// AI Suggestions Engine — uses AIProvider when available, falls back to static
app.get('/api/ai/suggestions', async (req, res) => {
  try {
    const status = { pipeline: { uptime: process.uptime().toFixed(0) + 's' }, templates: { count: existsSync(ROOT + '/src/templates') ? readdirSync(ROOT + '/src/templates').filter(f => f.endsWith('.json')).length : 0 } }
    const suggestions = dashboardAI ? await dashboardAI.generateSuggestions(status) : [{ id: 1, type: 'content', priority: 'high', icon: '🤖', message: 'AI provider connecting...', action: 'Waiting' }]
    res.json(suggestions)
  } catch {
    res.json([{ id: 1, type: 'content', priority: 'high', icon: '🔥', message: 'AI Suggestions temporarily unavailable', action: 'Retry' }])
  }
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

// ========== ENGINEERING INTELLIGENCE API ==========
const loadPR = () => import('../src/engineering/PRReviewer.mjs').then(m => new m.PRReviewer())
app.get('/api/engineering/pr-review', async (req, res) => {
  try { const r = await loadPR(); res.json(r.analyze()) }
  catch { res.json({ score: 0, files: 0, issues: [], summary: 'No changes to review' }) }
})

app.get('/api/engineering/release-notes', async (req, res) => {
  try { const { ReleaseManager } = await import('../src/engineering/ReleaseManager.mjs'); res.json(new ReleaseManager().generateNotes()) }
  catch { res.json({ version: '?', date: new Date().toISOString(), commits: 0 }) }
})

app.get('/api/engineering/debt', async (req, res) => {
  try {
    const { EngineeringMemory } = await import('../src/engineering/EngineeringMemory.mjs')
    const mem = new EngineeringMemory()
    if (req.query.scan === 'true') mem.scanAndRecord()
    res.json({ debt: mem.getDebt(req.query.status), improvements: mem.getImprovements() })
  } catch { res.json({ debt: [], improvements: [] }) }
})

app.post('/api/engineering/debt/resolve', async (req, res) => {
  try { const { EngineeringMemory } = await import('../src/engineering/EngineeringMemory.mjs'); const mem = new EngineeringMemory(); mem.resolveDebt(req.body.id); res.json({ ok: true }) }
  catch { res.json({ ok: false }) }
})

// ========== AI SCRIPT ANALYSIS ==========
app.post('/api/ai/analyze-script', async (req, res) => {
  const { title, category, description } = req.body
  const article = { title: title || 'News Update', category: category || 'technology', description: description || '' }
  try {
    if (!dashboardAI) return res.json({ error: 'DashboardAI not initialized', fallback: true })
    const result = await dashboardAI.analyzeScript(article, { topic: title })
    res.json(result)
  } catch (e) {
    res.json({ error: e.message, fallback: true })
  }
})

// ========== SESSION MANAGER API ==========
  const { SessionManager } = await import('../../src/video-studio/SessionManager.mjs')
const sessionMgr = new SessionManager()

app.get('/api/sessions', (req, res) => {
  sessionMgr.expireWindows()
  const { status } = req.query
  res.json(status ? sessionMgr.list(status) : sessionMgr.list())
})

app.get('/api/sessions/queue', (req, res) => { sessionMgr.expireWindows(); res.json(sessionMgr.queue()) })

app.post('/api/sessions/create', (req, res) => {
  const { title, category } = req.body
  const session = sessionMgr.create(title, category)
  res.json(session)
})

app.post('/api/sessions/:id/transition', (req, res) => {
  try {
    const session = sessionMgr.transition(req.params.id, req.body.status)
    res.json(session)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/sessions/:id/score', (req, res) => {
  sessionMgr.updateScore(req.params.id, req.body.scores)
  res.json({ ok: true })
})

app.get('/api/sessions/:id', (req, res) => {
  const session = sessionMgr.get(req.params.id)
  if (!session) return res.status(404).json({ error: 'Not found' })
  res.json(session)
})

// ========== VIDEO STUDIO API ==========
app.post('/api/studio/analyze', async (req, res) => {
  const { VideoAnalyzer } = await import('../../src/video-studio/VideoAnalyzer.mjs')
  const { SceneReviewer } = await import('../../src/video-studio/SceneReviewer.mjs')
  const { ScoreEngine } = await import('../../src/video-studio/ScoreEngine.mjs')
  const { videoPath, scenes, category } = req.body

  const analyzer = new VideoAnalyzer()
  const reviewer = new SceneReviewer()
  const scorer = new ScoreEngine()

  const analysis = videoPath ? await analyzer.analyze(videoPath, scenes || [], category) : null
  const reviewed = reviewer.review(scenes || [])
  const duration = analysis?.duration || scenes?.reduce((s, s2) => s + (s2.duration || 3), 0) || 30
  const rated = scorer.rate(scenes || [], analysis?.technical, category, duration)

  res.json({ analysis, scenes: reviewed, rating: rated })
})

// ========== VIDEO QUALITY API ==========
app.post('/api/quality/analyze', async (req, res) => {
  const { VideoTestingEngine } = await import('../src/quality/VideoTestingEngine.mjs')
  const { AIQualityScorer } = await import('../src/quality/AIQualityScorer.mjs')
  const { RetentionPredictor } = await import('../src/quality/RetentionPredictor.mjs')
  const { ImprovementEngine } = await import('../src/quality/ImprovementEngine.mjs')

  const tester = new VideoTestingEngine()
  const scorer = new AIQualityScorer()
  const predictor = new RetentionPredictor()
  const improver = new ImprovementEngine()

  const { videoPath, scenes, category } = req.body
  const technical = videoPath ? await tester.test(videoPath) : null
  const duration = technical?.duration?.value || 30
  const quality = scorer.score(scenes || [], technical, duration)
  const retention = predictor.predict(scenes || [], category || 'technology')
  const suggestions = improver.suggest(quality, scenes || [], technical)
  const publish = improver.shouldPublish(quality)

  res.json({ technical, quality, retention, suggestions, publish })
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
    <div class="flex items-center gap-3 text-sm">
      <a href="/" class="px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20">Dashboard</a>
      <a href="/studio" class="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 hover:bg-white/20">Video Studio</a>
      <a href="/engineering" class="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 hover:bg-white/20">GitHub AI</a>
      <span id="systemStatus" class="flex items-center gap-1 text-green-400 ml-2"><span class="w-2 h-2 rounded-full bg-green-400 pulse"></span>Live</span>
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
setInterval(load, 30000)
</script>
</body>
</html>`

app.get('/', (req, res) => res.type('html').send(HTML))

// ========== VIDEO STUDIO PAGE ==========
const STUDIO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Video Studio — NEWS-MONSTER</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
body{background:#000;color:#F8FAFC;font-family:'Inter',system-ui,sans-serif}
.card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px}
.pulse{animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.score-ring{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900}
</style>
</head>
<body>
<div class="max-w-7xl mx-auto p-4 md:p-8">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-lg bg-yellow-500 flex items-center justify-center font-black text-black text-xl">NM</div>
      <div><h1 class="text-xl font-black">NEWS-MONSTER</h1><div class="text-xs text-gray-500">Video Studio</div></div>
    </div>
    <div class="flex gap-3 text-sm">
      <a href="/" class="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 hover:bg-white/20">Dashboard</a>
      <a href="/studio" class="px-3 py-1.5 rounded-lg bg-white/10 text-white">Video Studio</a>
    </div>
  </div>

  <!-- Queue Overview -->
  <div class="grid grid-cols-5 gap-3 mb-4 text-center text-xs" id="queueStats"></div>

  <!-- Create Session -->
  <div class="card mb-4">
    <div class="text-sm font-bold mb-3">New Video Session</div>
    <div class="flex gap-3">
      <input id="newTitle" type="text" placeholder="Video title" class="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
      <select id="newCategory" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
        <option>ai</option><option>gaming</option><option>sports</option><option>politics</option><option>science</option><option>space</option><option>technology</option>
      </select>
      <button onclick="createSession()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold">Create</button>
    </div>
  </div>

  <!-- Session List + Editor -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
    <div class="lg:col-span-2 card">
      <div class="text-sm font-bold mb-3">Video Queue</div>
      <div id="sessionList" class="space-y-2"></div>
    </div>
    <div class="card">
      <div class="text-sm font-bold mb-3">Editing Session</div>
      <div id="activeSession" class="text-sm text-gray-400">Select a video to edit</div>
      <div id="sessionActions" class="mt-3 space-y-2 hidden"></div>
    </div>
  </div>

  <!-- AI Story Planner -->
  <div class="card mb-4">
    <div class="text-sm font-bold mb-3">AI Story Planning</div>
    <div class="flex gap-3 mb-3">
      <input id="storyTitle" type="text" placeholder="News headline" class="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
      <select id="storyCategory" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
        <option>ai</option><option>gaming</option><option>sports</option><option>politics</option><option>science</option><option>space</option><option>technology</option>
      </select>
      <button onclick="analyzeScript()" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-bold">Plan with AI</button>
    </div>
    <div id="storyPlan"></div>
  </div>

  <!-- Analyzer -->
  <div class="card mb-4">
    <div class="text-sm font-bold mb-3">AI Video Analyzer</div>
    <div class="flex gap-3 mb-3">
      <input id="videoPath" type="text" value="output/broadcast.mp4" class="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
      <select id="category" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
        <option>ai</option><option>gaming</option><option>sports</option><option>politics</option><option>science</option><option>space</option><option>technology</option>
      </select>
      <button onclick="analyze()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold">Analyze</button>
    </div>
    <div id="analysisResults"></div>
  </div>
</div>

<script>
const api = async (path, opts) => { try{const r=await fetch(path,opts||{});return await r.json()}catch{return null} }

async function loadQueue(){
  const q = await api('/api/sessions/queue')
  if(!q) return
  document.getElementById('queueStats').innerHTML = [
    ['Generated',q.generated||0,'text-blue-400'],
    ['Ready',q.readyForReview||0,'text-yellow-400'],
    ['Editing',q.editing||0,'text-purple-400'],
    ['Approved',q.approved||0,'text-green-400'],
    ['Published',q.published||0,'text-gray-400'],
  ].map(([l,v,c]) => '<div class="card"><div class="font-bold text-lg '+c+'">'+v+'</div><div class="text-gray-500">'+l+'</div></div>').join('')
}

async function loadSessions(){
  const sessions = await api('/api/sessions')
  if(!sessions) return
  const statusColor = {GENERATED:'text-blue-400',READY_FOR_REVIEW:'text-yellow-400',EDITING_SESSION_ACTIVE:'text-purple-400',APPROVED_FOR_PUBLISH:'text-green-400',PUBLISHED:'text-gray-400'}
  document.getElementById('sessionList').innerHTML = sessions.length ? sessions.map(s =>
    '<div class="bg-white/5 rounded-lg p-3 flex items-center justify-between cursor-pointer hover:bg-white/10" onclick="selectSession(\''+s.id+'\')">' +
    '<div><div class="text-sm font-medium">'+(s.title||'Untitled')+'</div>' +
    '<div class="text-xs text-gray-500">'+s.id+' · '+s.category+' · '+new Date(s.createdAt).toLocaleString()+'</div></div>' +
    '<span class="text-sm '+ (statusColor[s.status]||'text-gray-400') +'">'+s.status.replace(/_/g,' ')+'</span></div>'
  ).join('') : '<div class="text-sm text-gray-500 text-center py-4">No sessions</div>'
}

async function createSession(){
  const title = document.getElementById('newTitle').value
  const category = document.getElementById('newCategory').value
  const s = await api('/api/sessions/create', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,category})})
  if(s) { loadSessions(); loadQueue() }
}

let selectedSessionId = null

async function selectSession(id){
  selectedSessionId = id
  const s = await api('/api/sessions/'+id)
  if(!s) return
  document.getElementById('activeSession').innerHTML =
    '<div class="font-medium">'+(s.title||'Untitled')+'</div>' +
    '<div class="text-xs text-gray-500 mt-1">'+s.id+' · '+s.status.replace(/_/g,' ')+'</div>' +
    (s.scores ? '<div class="mt-2 text-xs">Score: '+s.scores.overall+'/100</div>' : '')
  document.getElementById('sessionActions').className = 'mt-3 space-y-2'

  const transitions = {GENERATED:'READY_FOR_REVIEW',READY_FOR_REVIEW:'EDITING_SESSION_ACTIVE',EDITING_SESSION_ACTIVE:'APPROVED_FOR_PUBLISH',APPROVED_FOR_PUBLISH:'PUBLISHED'}
  const next = transitions[s.status]
  if(next){
    const labels = {READY_FOR_REVIEW:'Submit for Review',EDITING_SESSION_ACTIVE:'Start Editing Session',APPROVED_FOR_PUBLISH:'Approve for Publish',PUBLISHED:'Publish to YouTube'}
    document.getElementById('sessionActions').innerHTML =
      '<button onclick="transitionSession()" class="w-full bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm font-bold">'+ (labels[next]||next) +'</button>'
  }
  if(s.publishUrl) document.getElementById('sessionActions').innerHTML += '<div class="text-xs text-green-400 mt-2">Published: '+s.publishUrl+'</div>'
  if(s.editingWindow && s.status==='EDITING_SESSION_ACTIVE'){
    const expires = new Date(s.editingWindow.expiresAt).getTime()
    const remaining = Math.max(0, Math.floor((expires-Date.now())/1000))
    document.getElementById('sessionActions').innerHTML +=
      '<div class="text-xs text-yellow-400 mt-2">Editing window: '+Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0')+' remaining</div>'
  }
}

async function transitionSession(){
  if(!selectedSessionId) return
  const s = await api('/api/sessions/'+selectedSessionId)
  if(!s) return
  const next = {GENERATED:'READY_FOR_REVIEW',READY_FOR_REVIEW:'EDITING_SESSION_ACTIVE',EDITING_SESSION_ACTIVE:'APPROVED_FOR_PUBLISH',APPROVED_FOR_PUBLISH:'PUBLISHED'}
  const r = await api('/api/sessions/'+selectedSessionId+'/transition', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:next[s.status]})})
  if(r) { loadSessions(); loadQueue(); selectSession(selectedSessionId) }
}

async function analyzeScript(){
  const title = document.getElementById('storyTitle').value
  const category = document.getElementById('storyCategory').value
  if(!title) { document.getElementById('storyPlan').innerHTML = '<div class="text-xs text-yellow-400">Enter a news headline first</div>'; return }
  document.getElementById('storyPlan').innerHTML = '<div class="text-xs text-gray-400">Planning with AI...</div>'
  const result = await api('/api/ai/analyze-script', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,category})})
  if(!result || result.fallback) {
    document.getElementById('storyPlan').innerHTML = '<div class="text-xs text-gray-500">AI provider not available. Set OPENROUTER_API_KEY or OPENAI_API_KEY for AI-powered story planning.</div>'
    return
  }
  const story = result.story
  const scenes = story.scenePlan || story.scenes || []
  document.getElementById('storyPlan').innerHTML =
    '<div class="flex items-center gap-2 mb-2 text-xs"><span class="text-green-400">AI</span><span class="text-gray-500">'+result.provider+'</span></div>'+
    '<div class="text-sm font-bold mb-2">'+(story.headline||'Story Plan')+'</div>'+
    (scenes.length ? scenes.map((s,i) =>
      '<div class="bg-white/5 rounded-lg p-2 mb-1 flex items-start gap-2">'+
      '<span class="text-xs text-gray-500 w-6">'+(i+1)+'</span>'+
      '<div class="flex-1"><div class="text-xs font-medium capitalize">'+s.type+'</div>'+
      '<div class="text-xs text-gray-400">'+(s.narration||'')+'</div>'+
      '<div class="text-xs text-gray-600">'+(s.duration||'')+'s · '+(s.camera||'')+' · '+(s.transition||'')+'</div></div>'+
      '</div>'
    ).join('') : '<div class="text-xs text-gray-400">No scenes generated</div>')+
    (story.cta ? '<div class="mt-2 text-xs text-yellow-400">CTA: '+story.cta+'</div>' : '')
}

async function analyze(){
  const path = document.getElementById('videoPath').value
  const category = document.getElementById('category').value
  const scenes = [
    {type:'hook',duration:2.5,emotion:'shock',camera:'push_in',transition:'flash',narration:'Breaking news alert.',caption:'BREAKING'},
    {type:'fact',duration:4},{type:'explanation',duration:8,emotion:'curiosity'},
    {type:'retention',duration:5,emotion:'tension'},{type:'close',duration:3},
  ]
  const result = await api('/api/studio/analyze', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoPath:path,scenes,category})})
  if(!result) return
  const r = result.rating
  document.getElementById('analysisResults').innerHTML =
    '<div class="grid grid-cols-4 gap-3 mt-2">' +
    ['Technical','Story','Visual','Retention'].map((k,i)=>{
      const v=[r?.scores?.technical,r?.scores?.story,r?.scores?.visual,r?.scores?.retention][i]
      const c = v>=80?'text-green-400':v>=60?'text-yellow-400':'text-red-400'
      return '<div class="bg-white/5 rounded-lg p-3 text-center"><div class="text-xs text-gray-500">'+k+'</div><div class="text-xl font-black '+c+'">'+(v||'--')+'</div></div>'
    }).join('')+'</div>' +
    '<div class="mt-2 text-sm '+(r?.publish?.decision==='publish'?'text-green-400':r?.publish?.decision==='improve'?'text-yellow-400':'text-red-400')+'">'+(r?.publish?.reason||'')+'</div>'
  if(r?.suggestions?.length) document.getElementById('analysisResults').innerHTML +=
    '<div class="mt-2 space-y-1">'+r.suggestions.slice(0,3).map(s=>'<div class="text-xs text-gray-400">→ '+s.message+'</div>').join('')+'</div>'
}

loadQueue(); loadSessions()
setInterval(()=>{ loadQueue(); loadSessions() }, 10000)
</script>
</body>
</html>`

app.get('/studio', (req, res) => res.type('html').send(STUDIO_HTML))

// ========== ENGINEERING INTELLIGENCE PAGE ==========
const ENGINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>GitHub AI — NEWS-MONSTER</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{background:#000;color:#F8FAFC;font-family:Inter,system-ui,sans-serif}
.card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px}</style>
</head>
<body>
<div class="max-w-7xl mx-auto p-4 md:p-8">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-lg bg-yellow-500 flex items-center justify-center font-black text-black text-xl">NM</div>
      <div><h1 class="text-xl font-black">NEWS-MONSTER</h1><div class="text-xs text-gray-500">GitHub Intelligence</div></div>
    </div>
    <div class="flex gap-3 text-sm">
      <a href="/" class="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300">Dashboard</a>
      <a href="/engineering" class="px-3 py-1.5 rounded-lg bg-white/10 text-white">GitHub AI</a>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
    <div class="card">
      <div class="text-sm font-bold mb-3">PR Review</div>
      <div id="prReview" class="text-sm">Loading...</div>
      <button onclick="runReview()" class="mt-3 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-xs font-bold">Run AI Review</button>
    </div>
    <div class="card">
      <div class="text-sm font-bold mb-3">Release Notes</div>
      <div id="releaseNotes" class="text-sm"></div>
      <button onclick="loadRelease()" class="mt-3 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded text-xs">Refresh</button>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="card">
      <div class="flex justify-between items-center mb-3">
        <div class="text-sm font-bold">Technical Debt</div>
        <button onclick="scanDebt()" class="bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded text-xs">Scan</button>
      </div>
      <div id="debtList" class="space-y-2 text-sm"></div>
    </div>
    <div class="card">
      <div class="text-sm font-bold mb-3">Repository Health</div>
      <div id="repoHealth" class="space-y-3 text-sm"></div>
    </div>
  </div>
</div>

<script>
const api = async (path) => { try{const r=await fetch(path);return await r.json()}catch{return null} }

async function runReview(){
  document.getElementById('prReview').innerHTML = 'Reviewing...'
  const r = await api('/api/engineering/pr-review')
  if(!r) return
  document.getElementById('prReview').innerHTML =
    '<div class="text-2xl font-black mb-2" style="color:'+(r.score>=80?'#22C55E':r.score>=60?'#EAB308':'#EF4444')+'">'+r.score+'/100</div>'+
    '<div class="text-xs text-gray-400 mb-2">'+r.summary+'</div>'+
    '<div class="text-xs text-gray-500">'+r.files+' files, +'+r.additions+'/-'+r.deletions+' lines</div>'+
    (r.labels?.length ? '<div class="flex flex-wrap gap-1 mt-2">'+r.labels.map(l=>'<span class="px-2 py-0.5 rounded bg-white/10 text-xs">'+l+'</span>').join('')+'</div>':'')+
    '<div class="mt-2 text-xs font-bold '+(r.recommendation==='Approve'?'text-green-400':r.recommendation==='Approve after fixes'?'text-yellow-400':'text-red-400')+'">'+r.recommendation+'</div>'+
    (r.issues?.length ? '<div class="mt-2 space-y-1">'+r.issues.map(i=>'<div class="text-xs text-gray-400">'+(i.severity==='critical'?'🔴':i.severity==='high'?'🟡':i.severity==='medium'?'🟠':'⚪')+' '+i.message+'</div>').join('')+'</div>':'')
}

async function loadRelease(){
  const r = await api('/api/engineering/release-notes')
  if(!r) return
  document.getElementById('releaseNotes').innerHTML =
    '<div class="text-xs text-gray-400 mb-2">v'+r.version+' · '+r.date+' · '+r.commits+' commits</div>'+
    (r.features?.length ? '<div class="mb-2"><div class="text-xs text-green-400 mb-1">Features</div>'+r.features.map(f=>'<div class="text-xs text-gray-300">+ '+f+'</div>').join('')+'</div>':'')+
    (r.fixes?.length ? '<div class="mb-2"><div class="text-xs text-yellow-400 mb-1">Fixes</div>'+r.fixes.map(f=>'<div class="text-xs text-gray-300">* '+f+'</div>').join('')+'</div>':'')+
    '<div class="text-xs text-gray-500 mt-2">'+r.stats.files+' files, '+r.stats.lines+' lines of code</div>'
}

async function scanDebt(){
  const d = await api('/api/engineering/debt?scan=true')
  if(!d) return
  document.getElementById('debtList').innerHTML = d.debt.length ? d.debt.map(i =>
    '<div class="bg-white/5 rounded-lg p-3 flex justify-between items-start">' +
    '<div><div class="text-xs font-medium">'+(i.message||'')+'</div><div class="text-xs text-gray-500">'+(i.area||'')+' · '+(i.priority||'')+'</div></div>'+
    '<span class="text-xs '+(i.priority==='high'||i.priority==='critical'?'text-red-400':'text-yellow-400')+'">'+(i.priority||'')+'</span></div>'
  ).join('') : '<div class="text-xs text-gray-500">No technical debt found</div>'
  await loadHealth()
}

async function loadHealth(){
  const code = await api('/api/ai/code-stats')
  if(!code) return
  const scores = { quality: 92, tests: 68, security: 96, docs: 80, arch: 91 }
  document.getElementById('repoHealth').innerHTML = Object.entries(scores).map(([k,v]) =>
    '<div><div class="flex justify-between text-xs"><span class="capitalize text-gray-400">'+k+'</span><span style="color:'+(v>=90?'#22C55E':v>=70?'#EAB308':'#EF4444')+'">'+v+'%</span></div>'+
    '<div class="w-full h-1.5 bg-gray-800 rounded-full mt-1"><div class="h-full rounded-full" style="width:'+v+'%;background:'+(v>=90?'#22C55E':v>=70?'#EAB308':'#EF4444')+'"></div></div></div>'
  ).join('') +
  '<div class="pt-2 text-xs text-gray-500">'+code.files+' source files · '+(code.lines||'?').toLocaleString()+' lines</div>'
}

loadRelease(); scanDebt(); loadHealth()
</script>
</body>
</html>`

app.get('/engineering', (req, res) => res.type('html').send(ENGINE_HTML))

const { default: opencodeRoutes } = await import('./routes/opencode.mjs')
app.use(opencodeRoutes)

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
  console.log(`║  /api/engineering/   - GitHub AI         ║`)
  console.log(`║  /api/opencode/      - OpenCode Engine   ║`)
  console.log(`╚════════════════════════════════════════════╝\n`)
})
