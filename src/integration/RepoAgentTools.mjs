import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const MAX_OUTPUT = 50000
const MAX_LINES = 200

const SECRET_DIRS = ['data', 'storage', 'snapshots', 'secrets', '.git']
const SECRET_FILES = ['.env', '.env.local', '.env.production']

// Approval-gated command patterns — mapped to the engine's approval_required
// actions. A match returns approvalRequired instead of executing.
const APPROVAL_PATTERNS = [
  ['modify-secrets', /(\.env|api[_-]?key|secret|token|password)/i],
  ['delete-files', /(^|\s)(rm|rmdir|unlink|del|trash)\s+/i],
  ['push-to-main', /git\s+(push|merge|rebase)/i],
  ['deploy-production', /railway|vercel|flyctl|netlify|gh\s+workflow\s+run/i],
  ['schema-change', /psql.*\b(drop|alter|truncate)\b|\bDROP\s+TABLE/i],
  ['infrastructure-change', /sudo|docker\s+(compose\s+)?(up|rm)/i],
]

// Repo Agent Tools — repository-level capability layer for the embedded
// opencode agent (dashboard assistant). Mirrors the external agent's toolset:
// read_file, write_file, list_directory, find, grep, search_symbols,
// git_status, git_diff, bash, apply_patch. All paths are confined to the
// workspace root; secret files never leave the server; mutating calls that
// hit the approval matrix return approvalRequired instead of running.
export class RepoAgentTools {
  constructor(root = ROOT) {
    this.root = path.resolve(root)
    this._rg = null
  }

  _resolve(p = '') {
    const full = path.resolve(this.root, String(p || '.'))
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`path escapes workspace root: ${p}`)
    }
    return full
  }

  _isSecret(p) {
    const rel = path.relative(this.root, p).split(path.sep)
    if (SECRET_DIRS.includes(rel[0])) return true
    const base = path.basename(p)
    return SECRET_FILES.includes(base) || base.includes('.env')
  }

  _walk(dir, filter, skipDirs = true) {
    const out = []
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const e of entries) {
      if (skipDirs && (e.name === 'node_modules' || e.name === '.git')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...this._walk(full, filter, skipDirs))
      else if (filter(full)) out.push(full)
    }
    return out
  }

  _globToRegExp(pattern) {
    const p = String(pattern).split('/').map(seg => {
      if (seg === '**') return '(?:.*/)?'
      return seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    }).join('/')
    return new RegExp('^' + p + '$')
  }

  _cap(text) {
    const s = String(text ?? '')
    return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n... [truncated ${s.length - MAX_OUTPUT} chars]` : s
  }

  _rgAvailable() {
    if (this._rg != null) return this._rg
    try { this._rg = !!execSync('which rg', { stdio: 'pipe' }).toString().trim() } catch { this._rg = false }
    return this._rg
  }

  // ---------- tools ----------

  read_file({ path: p }) {
    const full = this._resolve(p)
    if (this._isSecret(full)) return { ok: false, blocked: 'workspace.secret', error: 'reading secret files is not allowed' }
    const content = fs.readFileSync(full, 'utf-8')
    return { ok: true, path: p, content: this._cap(content) }
  }

  write_file({ path: p, content }) {
    const full = this._resolve(p)
    if (this._isSecret(full)) return { ok: false, approvalRequired: ['modify-secrets'], error: 'modifying secret files requires approval' }
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, String(content ?? ''))
    return { ok: true, written: path.relative(this.root, full) }
  }

  list_directory({ path: p = '' }) {
    const full = this._resolve(p)
    const entries = fs.readdirSync(full, { withFileTypes: true })
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
    return { ok: true, path: p || '.', entries }
  }

  find({ pattern = '**/*', path: p = '' }) {
    const base = this._resolve(p)
    const re = this._globToRegExp(pattern)
    const rel = f => path.relative(base, f)
    const matches = this._walk(base, f => re.test(rel(f))).map(rel).slice(0, MAX_LINES)
    return { ok: true, pattern, matches }
  }

  grep({ pattern, path: p = '', include = '*' }) {
    if (!pattern) return { ok: false, error: 'pattern required' }
    const base = this._resolve(p)
    const incRe = this._globToRegExp(include)
    const re = new RegExp(pattern)
    const results = []
    const files = this._walk(base, f => !this._isSecret(f) && incRe.test(path.basename(f)))
    for (const f of files) {
      if (results.length >= MAX_LINES) break
      let data
      try { data = fs.readFileSync(f, 'utf-8') } catch { continue }
      if (data.length > 2 * 1024 * 1024) continue
      const lines = data.split('\n')
      for (let i = 0; i < lines.length && results.length < MAX_LINES; i++) {
        if (re.test(lines[i])) results.push({ file: path.relative(this.root, f), line: i + 1, content: lines[i].slice(0, 300) })
      }
    }
    return { ok: true, pattern, count: results.length, results }
  }

  search_symbols({ pattern } = {}) {
    const re = /^(export\s+(default\s+)?)?(class\s+\w+|(async\s+)?function\s+\w+|const\s+[A-Z]\w*\s*=\s*(class|\(|async))/ 
    const filter = p => /\.(mjs|js|ts|tsx)$/.test(p)
    const results = []
    for (const f of this._walk(this.root, filter)) {
      let data
      try { data = fs.readFileSync(f, 'utf-8') } catch { continue }
      const lines = data.split('\n')
      for (let i = 0; i < lines.length && results.length < MAX_LINES; i++) {
        if (re.test(lines[i])) {
          const symbol = (lines[i].match(/\b(class|function|const)\s+([A-Za-z0-9_]+)/) || [])[0]
          if (!pattern || symbol.includes(pattern)) results.push({ file: path.relative(this.root, f), line: i + 1, symbol })
        }
      }
    }
    return { ok: true, count: results.length, results }
  }

  git_status() {
    return { ok: true, ...this._git(['status', '--short', '--branch']) }
  }

  git_diff({ path: p } = {}) {
    const args = p ? ['diff', '--', p] : ['diff']
    return { ok: true, ...this._git(args) }
  }

  bash({ command, timeout = 30000 }) {
    if (!command) return { ok: false, error: 'command required' }
    const action = this._approvalFor(command)
    if (action) return { ok: false, approvalRequired: [action], error: `${action} requires approval` }
    try {
      const out = execSync(command, { cwd: this.root, timeout, encoding: 'utf-8', maxBuffer: MAX_OUTPUT * 4 })
      return { ok: true, exitCode: 0, stdout: this._cap(out) }
    } catch (e) {
      return { ok: false, exitCode: e.status ?? 1, error: this._cap(e.stderr || e.message) }
    }
  }

  apply_patch({ diff }) {
    if (!diff) return { ok: false, error: 'diff required' }
    if (/\.env/.test(diff)) return { ok: false, approvalRequired: ['modify-secrets'], error: 'patch touches .env — requires approval' }
    const files = [...diff.matchAll(/^\+\+\+\s+b\/(.+)$/gm)].map(m => m[1])
    try {
      execSync('git apply --check -', { cwd: this.root, input: diff, encoding: 'utf-8' })
      execSync('git apply -', { cwd: this.root, input: diff, encoding: 'utf-8' })
      return { ok: true, applied: true, files }
    } catch (e) {
      return { ok: false, error: this._cap(e.stderr || e.message) }
    }
  }

  // ---------- internals ----------

  _git(args) {
    try {
      const out = execSync('git ' + args.join(' '), { cwd: this.root, encoding: 'utf-8', maxBuffer: MAX_OUTPUT * 4 })
      return { output: this._cap(out) }
    } catch (e) {
      return { error: this._cap(e.stderr || e.message) }
    }
  }

  _approvalFor(command) {
    for (const [action, re] of APPROVAL_PATTERNS) {
      if (re.test(command)) return action
    }
    return null
  }

  execute(name, args = {}) {
    if (typeof this[name] !== 'function' || name.startsWith('_')) {
      return { ok: false, error: `unknown tool: ${name}` }
    }
    try {
      return this[name](args)
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  registry() {
    return [
      { name: 'read_file', args: { path: 'string' }, description: 'Read a file inside the workspace (secret files blocked)' },
      { name: 'write_file', args: { path: 'string', content: 'string' }, description: 'Write a file inside the workspace (secrets need approval)' },
      { name: 'list_directory', args: { path: 'string' }, description: 'List directory entries' },
      { name: 'find', args: { pattern: 'glob', path: 'string' }, description: 'Find files by glob pattern (skips node_modules/.git)' },
      { name: 'grep', args: { pattern: 'regex', path: 'string', include: 'glob' }, description: 'Search file contents with line numbers' },
      { name: 'search_symbols', args: { pattern: 'string' }, description: 'Symbol map of classes/functions/consts in .mjs/.js/.ts/.tsx' },
      { name: 'git_status', args: {}, description: 'git status --short --branch' },
      { name: 'git_diff', args: { path: 'string' }, description: 'git diff (optionally for one path)' },
      { name: 'bash', args: { command: 'string', timeout: 'number' }, description: 'Run a shell command in the workspace (approval matrix applies)' },
      { name: 'apply_patch', args: { diff: 'unified diff' }, description: 'Apply a unified diff via git apply' },
      { name: 'rg', available: this._rgAvailable(), description: this._rgAvailable() ? 'Available — grep tool is the wired-in search path' : 'NOT installed (brew install ripgrep); grep tool is the fallback' },
    ]
  }
}
