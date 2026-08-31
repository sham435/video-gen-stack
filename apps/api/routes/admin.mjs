/**
 * Admin RBAC routes mounted at /admin on the Express API server.
 *
 *   GET  /admin/login          → login page (public)
 *   POST /admin/login          → verify ADMIN_USER + ADMIN_PASS_HASH → sets JWT httpOnly cookie
 *   POST /admin/logout         → clears the admin cookie (protected)
 *   GET  /admin/dashboard      → protected admin dashboard (HTML)
 *   GET  /admin/api/videos     → protected JSON list: recent videos + publish status + YouTube stats
 *   POST /admin/publish        → protected: manually trigger the publish workflow
 *
 * Auth is handled by packages/auth/adminAuth.mjs (JWT + scrypt, no npm deps).
 * Passwords live in env: ADMIN_USER + ADMIN_PASS_HASH (see scripts/admin-hash.mjs).
 */
import { Router } from 'express'
import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import {
  verifyPassword, signToken, requireAdmin, setAdminCookie, clearAdminCookie,
} from '../../../packages/auth/adminAuth.mjs'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..', '..')
const VIDEOS_JSON = resolve(ROOT, 'public', 'videos.json')

const router = Router()

// ── Data helpers ───────────────────────────────────────────────────────────
function readVideosJson() {
  if (!existsSync(VIDEOS_JSON)) return []
  try {
    const m = JSON.parse(readFileSync(VIDEOS_JSON, 'utf-8'))
    return Array.isArray(m.videos) ? m.videos : []
  } catch {
    return []
  }
}

/** Joins videos.json with the analytics table (views/likes/comments/ctr/retention). */
function videosWithStats() {
  let statsByVideo = new Map()
  try {
    const better = require('better-sqlite3')
    const db = better(resolve(ROOT, 'data', 'newsroom.db'))
    const rows = db.prepare('SELECT * FROM analytics WHERE youtube_video_id IS NOT NULL').all()
    db.close()
    for (const r of rows) statsByVideo.set(r.youtube_video_id, r)
  } catch { /* analytics DB unavailable — dashboard degrades gracefully */ }

  return readVideosJson().map(v => {
    const id = v.id || v.videoId
    const a = statsByVideo.get(id) || {}
    return {
      videoId: id,
      title: v.title || `Video ${id}`,
      category: (v.category || 'general').toLowerCase(),
      publishedAt: v.publishedAt || null,
      publishedLabel: v.publishedLabel || '',
      status: v.verificationState || (v.verified ? 'VERIFIED' : 'PENDING'),
      hasDownload: existsSync(resolve(ROOT, 'public', 'videos', `${id}.mp4`)),
      stats: {
        views: Number(a.views || 0),
        likes: Number(a.likes || 0),
        comments: Number(a.comments || 0),
        ctr: a.ctr ?? null,
        retention: a.retention ?? null,
        subscribersGained: Number(a.subscribers_gained || 0),
        updatedAt: a.updated_at || null,
      },
    }
  })
}

async function runWorkflowTrigger(category, title) {
  return await new Promise((resolvePromise) => {
    const args = ['workflow', 'run', 'publish-news.yml']
    if (category && category !== 'all') args.push('-f', `category=${category}`)
    if (title) args.push('-f', `title=${title}`)
    // Inject a job id so the triggered run is git-safe against racing commits.
    args.push('-f', `jobId=${Date.now()}`)
    const child = spawn('gh', args, { cwd: ROOT, env: process.env })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', e => resolvePromise({ ok: false, error: e.message, out, err }))
    child.on('close', code => {
      resolvePromise(code === 0 ? { ok: true, out: out.trim(), err: err.trim() } : { ok: false, code, out: out.trim(), err: err.trim() })
    })
  })
}

// ── Login (public) ─────────────────────────────────────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Login — NEWS-MONSTER</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050505;color:#f0ece4;font-family:'Inter',-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;-webkit-font-smoothing:antialiased}
.card{width:min(380px,90vw);background:#0a0a0c;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:40px 36px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.mark{width:46px;height:46px;border-radius:10px;background:#e03030;display:grid;place-items:center;font-weight:800;margin-bottom:22px;box-shadow:0 0 24px rgba(224,48,48,.4)}
h1{font-size:20px;font-weight:700;letter-spacing:-.3px;margin-bottom:6px}
.sub{color:#8a8a9a;font-size:13px;margin-bottom:26px}
label{display:block;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#8a8a9a;margin:14px 0 6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#101014;color:#f0ece4;font-size:14px;font-family:inherit}
input:focus{outline:none;border-color:#c9a84c}
button{width:100%;margin-top:22px;padding:13px;border:none;border-radius:10px;background:#c9a84c;color:#0a0a0c;font-weight:700;font-size:14px;cursor:pointer;letter-spacing:.5px}
button:hover{background:#d4b354}
button:disabled{opacity:.5;cursor:default}
.err{color:#ff6b6b;font-size:13px;margin-top:14px;min-height:18px;text-align:center}
.back{display:block;text-align:center;margin-top:18px;color:#8a8a9a;font-size:12px;text-decoration:none}
.back:hover{color:#f0ece4}
</style></head><body>
<div class="card">
  <div class="mark">NM</div>
  <h1>Admin Console</h1>
  <div class="sub">Restricted — authorized staff only</div>
  <form id="f">
    <label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button id="btn" type="submit">Sign in</button>
    <div class="err" id="err"></div>
  </form>
  <a class="back" href="/">← Back to hub</a>
</div>
<script>
const f=document.getElementById('f'),btn=document.getElementById('btn'),err=document.getElementById('err');
f.addEventListener('submit',async(e)=>{e.preventDefault();btn.disabled=true;err.textContent='';
  try{
    const r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:f.username.value,password:f.password.value})});
    const data=await r.json().catch(()=>({}));
    if(r.ok&&data.ok){window.location.href='/admin/dashboard';return;}
    err.textContent=data.error||'Invalid credentials ('+r.status+')';
  }catch(x){err.textContent='Network error';}
  btn.disabled=false;
});
</script>
</body></html>`

router.get('/login', (req, res) => res.type('html').send(LOGIN_HTML))

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '')
  const password = String(req.body?.password || '')
  const ADMIN_USER = process.env.ADMIN_USER || 'admin'
  const hash = process.env.ADMIN_PASS_HASH
  if (!hash) return res.status(503).json({ ok: false, error: 'ADMIN_PASS_HASH not configured on server' })
  if (!process.env.JWT_SECRET) return res.status(503).json({ ok: false, error: 'JWT_SECRET not configured on server' })

  const userOk = (() => {
    try { return require('crypto').timingSafeEqual(Buffer.from(username), Buffer.from(ADMIN_USER)) } catch { return username === ADMIN_USER }
  })()
  if (!userOk || !verifyPassword(password, hash)) {
    return res.status(401).json({ ok: false, error: 'Invalid username or password' })
  }
  const token = signToken({ role: 'admin', sub: ADMIN_USER })
  setAdminCookie(res, token)
  res.json({ ok: true, redirect: '/admin/dashboard' })
})

router.post('/logout', requireAdmin, (req, res) => {
  clearAdminCookie(res)
  res.json({ ok: true })
})

// ── Protected dashboard ────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Dashboard — NEWS-MONSTER</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050505;color:#f0ece4;font-family:'Inter',-apple-system,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
.wrap{max-width:1200px;margin:0 auto;padding:36px 24px 80px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;flex-wrap:wrap;gap:12px}
.logo{display:flex;align-items:center;gap:12px}
.mark{width:40px;height:40px;border-radius:9px;background:#e03030;display:grid;place-items:center;font-weight:800;box-shadow:0 0 20px rgba(224,48,48,.35)}
.logo b{letter-spacing:1px;text-transform:uppercase}
.head-r{display:flex;gap:10px;align-items:center}
a{color:#8a8a9a;text-decoration:none;font-size:13px}
a:hover{color:#f0ece4}
button{font-family:inherit;cursor:pointer}
.btn{padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#101014;color:#f0ece4;font-size:13px;font-weight:600}
.btn.primary{background:#c9a84c;color:#0a0a0c;border-color:#c9a84c}
.btn.danger{background:transparent;border-color:rgba(255,107,107,.4);color:#ff6b6b}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:28px}
.stat{background:#0a0a0c;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px}
.stat .n{font-size:26px;font-weight:800}
.stat .l{color:#8a8a9a;font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.publish{background:#0a0a0c;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:22px;margin-bottom:28px}
.publish h2{font-size:15px;margin-bottom:14px}
.pub-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pub-row select{padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#101014;color:#f0ece4;font-family:inherit}
.pub-msg{font-size:13px;margin-top:12px;min-height:18px}
.pub-msg.ok{color:#6bde8a}.pub-msg.err{color:#ff6b6b}
table{width:100%;border-collapse:collapse;background:#0a0a0c;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden}
th,td{padding:12px 14px;text-align:left;font-size:13px;border-bottom:1px solid rgba(255,255,255,.06)}
th{color:#8a8a9a;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.status{padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.5px}
.status.VERIFIED,.status.SUCCESS{background:rgba(107,222,138,.15);color:#6bde8a}
.status.PENDING{background:rgba(201,168,76,.15);color:#c9a84c}
.status.REJECTED,.status.FAILED{background:rgba(255,107,107,.15);color:#ff6b6b}
.dl{color:#c9a84c}
.empty{color:#8a8a9a;text-align:center;padding:40px;font-size:14px}
</style></head><body>
<div class="wrap">
  <header>
    <div class="logo"><div class="mark">NM</div><b>NEWS-MONSTER · Admin</b></div>
    <div class="head-r">
      <a href="/">Hub</a>
      <button class="btn danger" id="logout">Logout</button>
    </div>
  </header>

  <div class="stats" id="stats"></div>

  <div class="publish">
    <h2>Manual Publish</h2>
    <div class="pub-row">
      <select id="cat">
        <option value="all">Rotate (auto)</option>
        <option>technology</option><option>tesla</option><option>apple</option><option>ai</option>
        <option>gaming</option><option>crypto</option><option>science</option><option>business</option>
      </select>
      <input id="title" placeholder="Optional: override title" style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#101014;color:#f0ece4;font-family:inherit;min-width:240px">
      <button class="btn primary" id="publish">▶ Trigger publish</button>
    </div>
    <div class="pub-msg" id="pubMsg"></div>
  </div>

  <table>
    <thead><tr><th>Title</th><th>Category</th><th>Published</th><th>Status</th><th>Views</th><th>Likes</th><th>Comments</th><th>CTR</th><th>Download</th></tr></thead>
    <tbody id="rows"><tr><td colspan="9" class="empty">Loading…</td></tr></tbody>
  </table>
</div>
<script>
const rows=document.getElementById('rows'),stats=document.getElementById('stats');
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
async function load(){
  const r=await fetch('/admin/api/videos'); if(r.status===401){window.location='/admin/login';return;}
  const data=await r.json(); const v=data.videos||[];
  // aggregate stats
  const tot=v.length, cats=new Set(v.map(x=>x.category));
  const sum=k=>v.reduce((a,x)=>(a+(x.stats&&x.stats[k]||0)),0);
  const dl=v.filter(x=>x.hasDownload).length;
  stats.innerHTML=[
    ['Total Videos',tot],['Categories',cats.size],['Views',sum('views').toLocaleString()],
    ['Likes',sum('likes').toLocaleString()],['Comments',sum('comments').toLocaleString()],['Downloadable',dl]
  ].map(([l,n])=>'<div class="stat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');
  if(!v.length){rows.innerHTML='<tr><td colspan="9" class="empty">No videos yet.</td></tr>';return;}
  rows.innerHTML=v.map(x=>{
    const st=(x.stats&&x.stats.views>0)?'(YT)' : '';
    const yt=(x.stats&&x.stats.views>0)? String(x.stats.views).toLocaleString() : '—';
    const like=(x.stats&&x.stats.views>0)? String(x.stats.likes).toLocaleString() : '—';
    const com=(x.stats&&x.stats.views>0)? String(x.stats.comments).toLocaleString() : '—';
    const ctr=(x.stats&&x.stats.ctr!=null)? (x.stats.ctr*100).toFixed(1)+'%' : '—';
    return '<tr><td>'+esc(x.title)+'</td><td>'+esc(x.category)+'</td><td>'+esc(x.publishedLabel||'')+'</td>'+
      '<td><span class="status">'+esc(x.status)+'</span></td><td>'+yt+'</td><td>'+like+'</td><td>'+com+'</td><td>'+ctr+'</td>'+
      '<td>'+(x.hasDownload?'<a class="dl" href="/videos/'+esc(x.videoId)+'.mp4" download>⬇ mp4</a>':'—')+'</td></tr>';
  }).join('');
}
document.getElementById('publish').addEventListener('click',async function(){
  const msg=document.getElementById('pubMsg');msg.className='pub-msg';msg.textContent='Triggering…';
  this.disabled=true;
  const r=await fetch('/admin/publish',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({category:document.getElementById('cat').value,title:document.getElementById('title').value})});
  const data=await r.json().catch(()=>({}));
  msg.textContent=data.error||'✓ Publish workflow dispatched. Check GitHub Actions.';
  msg.className='pub-msg '+(r.ok?'ok':'err');this.disabled=false;
});
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/admin/logout',{method:'POST'});window.location='/admin/login';});
load();
</script>
</body></html>`

router.get('/dashboard', requireAdmin, (req, res) => res.type('html').send(DASHBOARD_HTML))

router.get('/api/videos', requireAdmin, (req, res) => {
  res.json({ ok: true, videos: videosWithStats() })
})

router.post('/publish', requireAdmin, async (req, res) => {
  const { category, title } = req.body || {}
  const result = await runWorkflowTrigger(category, title)
  if (result.ok) return res.json({ ok: true, detail: result.out || 'dispatched' })
  res.status(500).json({ ok: false, error: result.err || result.error || 'Failed to trigger workflow' })
})

export default router
