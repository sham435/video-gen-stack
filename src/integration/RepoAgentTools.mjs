import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import { pipelineStatus as localizePipelineStatus } from '../localize/LocalizationPipeline.mjs'
import { status as reviewStatus, approve as reviewApprove, correct as reviewCorrect, _internals as reviewInternals } from '../localize/ReviewStore.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// The dashboard Node process may start without Homebrew on PATH — rg lives
// in /opt/homebrew/bin on Apple Silicon.
const TOOL_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(':')
const RG_ARGS = ['--line-number', '--no-heading', '-g', '!**/node_modules/**', '-g', '!.git/**']

const MAX_OUTPUT = 50000
const MAX_LINES = 200

const SECRET_DIRS = ['data', 'storage', 'snapshots', 'secrets', '.git']
const SECRET_FILES = ['.env', '.env.local', '.env.production']
// Credential-shaped BASENAMES (root-relative): secrets/credentials/api keys/
// tokens/private keys/service accounts. Boundary-guarded so ordinary code
// words (e.g. "tokenize.mjs") stay readable. History: the pre-hardening gate
// only recognized .env* — credential-shaped filenames read through unblocked
// (documented as a gap in tests/repo-agent-tools.test.mjs).
const CREDENTIAL_BASENAME_RE = /(?:^|[^a-z0-9])(?:secrets?|credentials?|api[-_]?key|apikey|passwd|password|token|service[-_]?account|id_rsa|id_dsa|id_ecdsa|id_ed25519|keystore|jks)(?:$|[^a-z0-9])/i
const CREDENTIAL_EXT_RE = /\.(?:pem|pfx|p12|key|keystore|jks|kdbx)$/i

// Approval-gated command patterns — mapped to the engine's approval_required
// actions. A match returns approvalRequired instead of executing.
// Order matters: earlier entries win.
const APPROVAL_PATTERNS = [
  ['modify-secrets', /(\.env|api[_-]?key|secret|token|password)/i],
  ['delete-files', /(^|\s)(rm|rmdir|unlink|del|trash)\s+|git\s+(reset\s+--hard|clean(\s|$)|restore\b|checkout\s+(--|\.|-f|-B))/i],
  ['push-to-main', /git\s+(push|merge|rebase)/i],
  ['deploy-production', /railway|vercel|flyctl|netlify|gh\s+workflow\s+run|npm\s+publish/i],
  ['dependency-add', /\b(npm|pnpm|yarn)\s+(install|remove|uninstall)\b|\bpip\d?\s+(install|uninstall)\b/i],
  ['schema-change', /psql.*\b(drop|alter|truncate)\b|\bDROP\s+TABLE/i],
  ['infrastructure-change', /sudo|docker\s+(compose\s+)?(up|rm)/i],
]

const BASH_TIMEOUT_CAP_MS = 60000

// Repo Agent Tools — repository-level capability layer for the embedded
// opencode agent (dashboard assistant). Mirrors the external agent's toolset:
// read_file, write_file, list_directory, find, grep, search_symbols,
// git_status, git_diff, bash, apply_patch + localization evidence tools.
// All paths are confined to the workspace root; secret files never leave the
// server; mutating calls that hit the approval matrix return approvalRequired
// instead of running; arguments are zod-validated before dispatch.
export class RepoAgentTools {
  constructor(root = ROOT) {
    this.root = path.resolve(root)
    this._rg = null
  }

  _resolve(p = '') {
    const raw = String(p || '.')
    // Tilde is NOT expanded: a leading '~' would silently create a literal
    // '~' directory inside the workspace on write (documented gap). Refuse —
    // the agent must use workspace-relative paths.
    if (raw === '~' || raw.startsWith('~/')) {
      throw new Error(`path escapes workspace root: ${p}`)
    }
    const full = path.resolve(this.root, raw)
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`path escapes workspace root: ${p}`)
    }
    return full
  }

  _isSecret(p) {
    const rel = path.relative(this.root, p).split(path.sep)
    if (SECRET_DIRS.includes(rel[0])) return true
    const base = path.basename(p)
    return (
      SECRET_FILES.map(s => s.toLowerCase()).includes(base.toLowerCase()) ||
      base.toLowerCase().includes('.env') ||
      CREDENTIAL_BASENAME_RE.test(base) ||
      CREDENTIAL_EXT_RE.test(base)
    )
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

  // Glob → matcher. Segment-wise so '**' means ANY depth including ZERO
  // segments: 'a/**/b' matches 'a/b' and 'a/x/y/b'; a trailing '**' matches
  // everything below (and beyond) its prefix. History: the earlier mapping
  // ('*' segments joined around an '(?:.*/)?') built an unsatisfiable regex —
  // every '**' glob matched nothing, including find()'s own default.
  _globToRegExp(pattern) {
    const segs = String(pattern ?? '**/*').split('/')
    let re = '^'
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      const isLast = i === segs.length - 1
      if (seg === '**') {
        re += isLast ? '.*' : '(?:[^/]+/)*'
        continue // the '**/'-joining slash lives inside the group above
      }
      re += seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
      if (!isLast) re += '/'
    }
    return new RegExp(re + '$')
  }

  _cap(text) {
    const s = String(text ?? '')
    return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n... [truncated ${s.length - MAX_OUTPUT} chars]` : s
  }

  _rgAvailable() {
    if (this._rg != null) return this._rg
    try {
      execFileSync('rg', ['--version'], { env: { ...process.env, PATH: TOOL_PATHS }, stdio: 'pipe' })
      this._rg = true
    } catch { this._rg = false }
    return this._rg
  }

  // Real ripgrep tool (exit 1 = no matches, not an error)
  rg({ pattern, path: p = '', include }) {
    if (!pattern) return { ok: false, error: 'pattern required' }
    if (!this._rgAvailable()) return { ok: false, error: 'ripgrep not installed — use grep tool instead (brew install ripgrep)' }
    const base = this._resolve(p)
    const args = [...RG_ARGS]
    if (include) args.push('-g', include)
    args.push(pattern, base)
    try {
      const out = execFileSync('rg', args, { env: { ...process.env, PATH: TOOL_PATHS }, encoding: 'utf-8', maxBuffer: MAX_OUTPUT * 4, timeout: 15000 })
      const lines = out.trim().split('\n').filter(Boolean).slice(0, MAX_LINES)
      const results = lines.map(l => {
        const m = l.match(/^([^:]+):(\d+):(.*)$/)
        return m ? { file: path.relative(this.root, m[1]), line: Number(m[2]), content: m[3].slice(0, 300) } : { raw: l.slice(0, 300) }
      })
      return { ok: true, pattern, count: results.length, results }
    } catch (e) {
      if (e.status === 1) return { ok: true, pattern, count: 0, results: [] }
      return { ok: false, error: this._cap(e.stderr || e.message) }
    }
  }

  // ---------- tools ----------

  read_file({ path: p, file }) {
    p = p || file || '' // model habit uses `file`, protocol uses `path`
    if (!p) return { ok: false, error: 'path required' }
    const full = this._resolve(p)
    if (this._isSecret(full)) return { ok: false, blocked: 'workspace.secret', error: 'reading secret files is not allowed' }
    const content = fs.readFileSync(full, 'utf-8')
    return { ok: true, path: p, content: this._cap(content) }
  }

  write_file({ path: p, content }, opts = {}) {
    const full = this._resolve(p)
    if (this._isSecret(full) && !opts.approvals?.includes('modify-secrets')) return { ok: false, approvalRequired: ['modify-secrets'], error: 'modifying secret files requires approval' }
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
    return { ok: true, pattern: String(pattern ?? '**/*'), matches }
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

  // One-shot repo statistics — total files, LOC, top dirs/extensions. The
  // cheap, truthful answer to "how big is this repo / file count?" without
  // the model shelling out to bash and guessing.
  repo_stats({ path: p = '' } = {}) {
    const base = this._resolve(p)
    const files = this._walk(base, () => true)
    const byDir = {}
    const byExt = {}
    let total = 0
    let code = 0
    for (const f of files) {
      const rel = path.relative(this.root, f)
      const dir = rel.includes(path.sep) ? rel.split(path.sep)[0] : '.'
      byDir[dir] = (byDir[dir] || 0) + 1
      const ext = (path.extname(f) || '(none)').slice(1)
      byExt[ext] = (byExt[ext] || 0) + 1
      try {
        if (fs.statSync(f).size > 2 * 1024 * 1024) continue
        const lines = fs.readFileSync(f, 'utf-8').split('\n').length
        total += lines
        if (/\.(mjs|js|ts|py|mts|cts|jsx|tsx|html|css|json|md)$/.test(rel)) code += lines
      } catch { /* binary/unreadable — skip */ }
    }
    return {
      ok: true,
      total_files: files.length,
      lines: { total, code },
      top_directories: Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 15),
      top_extensions: Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 10),
    }
  }

  git_status() {
    return { ok: true, ...this._git(['status', '--short', '--branch']) }
  }

  git_diff({ path: p } = {}) {
    const args = p ? ['diff', '--', p] : ['diff']
    return { ok: true, ...this._git(args) }
  }

  // Shell execution — policy-compliant: .opencode/policies/security.md
  // mandates execFileSync with ARRAYS (no shell strings). The command string
  // is tokenized with quoting support; unquoted shell metacharacters are
  // REFUSED (no pipes/redirects/backticks — those were unguarded execution
  // paths). Hard timeout cap regardless of requested value.
  bash({ command, timeout }, opts = {}) {
    if (!command) return { ok: false, error: 'command required' }
    const action = this._approvalFor(command)
    if (action && !opts.approvals?.includes(action)) return { ok: false, approvalRequired: [action], error: `${action} requires approval` }
    let tokens
    try {
      tokens = this._tokenize(String(command))
    } catch (e) {
      return { ok: false, error: `unsupported shell syntax: ${e.message}` }
    }
    if (!tokens.length) return { ok: false, error: 'empty command' }
    const capped = Math.min(Number(timeout) || 30000, BASH_TIMEOUT_CAP_MS)
    try {
      const out = execFileSync(tokens[0], tokens.slice(1), {
        cwd: this.root,
        timeout: capped,
        encoding: 'utf-8',
        maxBuffer: MAX_OUTPUT * 4,
        env: { ...process.env, PATH: TOOL_PATHS },
      })
      return { ok: true, exitCode: 0, stdout: this._cap(out), timeout_ms: capped }
    } catch (e) {
      return {
        ok: false,
        exitCode: e.status ?? 1,
        error: this._cap(e.stderr || e.message),
        timeout_ms: capped,
      }
    }
  }

  // Quote-aware tokenizer for a SINGLE command (no pipes/redirects). Throws
  // on unquoted shell metacharacters instead of passing them to a shell.
  _tokenize(cmd) {
    const meta = /[\|;&<>()`\n]/ // | & ; < > ( ) ` newline
    const tokens = []
    let cur = ''
    let quote = null
    let has = false
    const push = () => { if (has) tokens.push(cur); cur = ''; has = false }
    for (let i = 0; i < cmd.length; i++) {
      const c = cmd[i]
      if (quote) {
        if (c === '\\') { // backslash escapes inside double quotes (literal otherwise)
          if (quote === '"') {
            const n = cmd[i + 1]
            if (n === '"' || n === '\\' || n === '$') { cur += n; i++; continue }
            cur += '\\'
          } else {
            const n = cmd[i + 1]
            cur += n ?? ''
            i++
            continue
          }
        } else if (c === quote) {
          quote = null
        } else {
          cur += c
        }
        continue
      }
      if (c === '"' || c === "'") { quote = c; has = true; continue }
      if (c === '\\') { const n = cmd[i + 1]; cur += n ?? '\\'; i++; has = true; continue }
      if (c === ' ' || c === '\t' || c === '\r') { push(); continue }
      if (c === '$') {
        // Parameter expansion is shell-only — never executed raw.
        throw new Error('$ expansion is not allowed outside approval: pass literal values')
      }
      if (meta.test(c)) throw new Error(`'${c}' is not a supported shell feature — use single-command form`)
      if (c === '#') { push(); break } // comments: rest ignored
      cur += c
      has = true
    }
    if (quote) throw new Error('unbalanced quote')
    push()
    return tokens
  }

  apply_patch({ diff }, opts = {}) {
    if (!diff) return { ok: false, error: 'diff required' }
    if (/\.env/.test(diff) && !opts.approvals?.includes('modify-secrets')) return { ok: false, approvalRequired: ['modify-secrets'], error: 'patch touches .env — requires approval' }
    const files = [...String(diff).matchAll(/^\+\+\+\s+b\/(.+)$/gm)].map(m => m[1])
    try {
      execFileSync('git', ['apply', '--check', '-'], { cwd: this.root, input: diff, encoding: 'utf-8' })
      execFileSync('git', ['apply', '-'], { cwd: this.root, input: diff, encoding: 'utf-8' })
      return { ok: true, applied: true, files }
    } catch (e) {
      return { ok: false, error: this._cap(e.stderr || e.message) }
    }
  }

  // ---------- NEWS-MONSTER localization evidence tools (stage 5/6 surfaced) ----------

  /** Status of the per-locale localization pipeline state
   *  (src/localize/LocalizationPipeline.statePath files). */
  localize_status({ job } = {}) {
    const dir = path.join(this.root, 'production', 'localization')
    if (!fs.existsSync(dir)) return { ok: true, jobs: {}, note: 'no localization state yet' }
    const out = {}
    if (job) {
      const safe = String(job).replace(/[^a-zA-Z0-9._-]/g, '')
      const st = localizePipelineStatus(safe)
      if (st && Object.keys(st).length) out[safe] = st
    } else {
      for (const j of fs.readdirSync(dir).filter(f =>
        fs.existsSync(path.join(dir, f)) && fs.statSync(path.join(dir, f)).isDirectory()
      )) {
        const st = localizePipelineStatus(j)
        if (st && Object.keys(st).length) out[j] = st
      }
    }
    return { ok: true, jobs: out }
  }

  /** Editorial review surface — list only by default; approve/correct are
   *  HUMAN decisions and gate behind the 'modify-content' approval action. */
  translation_review({ lang, op = 'list', id, text } = {}, opts = {}) {
    const langSafe = String(lang || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!langSafe) return { ok: false, error: 'lang required' }
    if (op !== 'list' && !opts.approvals?.includes('modify-content')) {
      return { ok: false, approvalRequired: ['modify-content'], error: 'editorial decisions require human approval' }
    }
    try {
      if (op === 'status') {
        return { ok: true, lang: langSafe, ...reviewStatus(langSafe) }
      }
      if (op === 'approve') {
        if (!id) return { ok: false, error: 'id required' }
        const it = reviewApprove(langSafe, String(id).replace(/[^a-f0-9]/gi, ''))
        return { ok: true, lang: langSafe, id: it.id, status: it.status }
      }
      if (op === 'correct') {
        if (!id || !text || !String(text).trim()) return { ok: false, error: 'id and text required' }
        const it = reviewCorrect(langSafe, String(id).replace(/[^a-f0-9]/gi, ''), String(text))
        return { ok: true, lang: langSafe, id: it.id, status: it.status }
      }
      // list (default): review ledger preview without secrets
      const st = reviewStatus(langSafe)
      const store = reviewInternals.load(langSafe)
      const items = (store.items || []).slice(0, 40).map(it => ({
        id: it.id,
        status: it.status,
        issues: it.issues || [],
        names: it.segment?.names || [],
        source: String(it.sourceText || '').slice(0, 120),
        translation: (it.correction ?? it.translation ?? '').slice(0, 120),
      }))
      return { ok: true, lang: langSafe, pendingCount: st.pendingCount, total: st.total, items }
    } catch (e) {
      return { ok: false, error: this._cap(e.message) }
    }
  }

  /** Run the repo's own test suite WITH BOUNDS: only tests/*.test.mjs,
   *  ≤5 files per call, 120s wall clock, TAP parse → pass/fail counts. */
  run_tests({ filter = '', max = 5 } = {}) {
    const testsDir = path.join(this.root, 'tests')
    if (!fs.existsSync(testsDir)) return { ok: false, error: 'no tests/ directory' }
    const safe = String(filter || '').toLowerCase().replace(/[^a-z0-9._-]/g, '')
    const all = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.mjs')).sort()
    const picked = (safe ? all.filter(f => f.includes(safe)) : all).slice(0, Math.max(1, Math.min(5, Number(max) || 5)))
    if (!picked.length) return { ok: true, files: [], pass: 0, fail: 0, note: 'no matching test files (tests/*.test.mjs only)' }
    const args = ['--test', '--test-reporter', 'tap', ...picked.map(f => path.join('tests', f))]
    const counts = (out) => {
      const pass = /#\s*pass\s+(\d+)/.exec(out)
      const fail = /#\s*fail\s+(\d+)/.exec(out)
      return { pass: pass ? Number(pass[1]) : 0, fail: fail ? Number(fail[1]) : 0 }
    }
    // Node's test runner detects `node --test` spawned from WITHIN a test
    // file (runner-context env) and force-skips it ("skipping running files").
    // Scrubbing the marker makes the child a genuine clean test process.
    const childEnv = { ...process.env }
    for (const k of Object.keys(childEnv)) if (/^NODE_TEST/i.test(k)) delete childEnv[k]
    try {
      const out = execFileSync(process.execPath, args, {
        cwd: this.root, timeout: 120000, maxBuffer: MAX_OUTPUT * 4, encoding: 'utf-8',
        env: childEnv,
      })
      const c = counts(out)
      return { ok: c.fail === 0, files: picked, pass: c.pass, fail: c.fail, output: this._capTail(out, 2400) }
    } catch (e) {
      const out = String(e.stdout || '')
      const c = counts(out)
      return { ok: false, files: picked, pass: c.pass, fail: c.fail || 1, error: this._cap(e.stderr || e.message), output: this._capTail(out, 2400) }
    }
  }

  _capTail(text, cap) {
    const s = String(text ?? '')
    return s.length > cap ? `...[truncated ${s.length - cap} chars]\n` + s.slice(-cap) : s
  }

  // ---------- internals ----------

  _git(args) {
    try {
      const out = execFileSync('git', args, { cwd: this.root, encoding: 'utf-8', maxBuffer: MAX_OUTPUT * 4 })
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

  // Per-tool zod schemas — strict for mutating tools (no hidden extra args),
  // permissive-but-typed for read tools. execute() rejects invalid input
  // BEFORE dispatch, so bad model output never reaches fs/process calls.
  _schemas() {
    return {
      read_file: z.object({ path: z.string().optional(), file: z.string().optional() }).passthrough(),
      write_file: z.object({ path: z.string().min(1), content: z.string().max(200000) }).strict(),
      list_directory: z.object({ path: z.string().optional() }).passthrough(),
      find: z.object({ pattern: z.string().max(300).optional(), path: z.string().optional() }).passthrough(),
      grep: z.object({ pattern: z.string().min(1).max(300), path: z.string().optional(), include: z.string().max(120).optional() }).passthrough(),
      rg: z.object({ pattern: z.string().min(1).max(300), path: z.string().optional(), include: z.string().max(120).optional() }).passthrough(),
      search_symbols: z.object({ pattern: z.string().max(120).optional() }).passthrough(),
      repo_stats: z.object({ path: z.string().optional() }).passthrough(),
      git_status: z.object({}).passthrough(),
      git_diff: z.object({ path: z.string().optional() }).passthrough(),
      bash: z.object({ command: z.string().min(1).max(2000), timeout: z.number().optional() }).strict(),
      terminal: z.object({ command: z.string().min(1).max(2000) }).strict(),
      apply_patch: z.object({ diff: z.string().min(1).max(200000) }).strict(),
      localize_status: z.object({ job: z.string().max(120).optional() }).passthrough(),
      translation_review: z.object({
        lang: z.string().max(20).optional(),
        op: z.enum(['list', 'status', 'approve', 'correct']).optional(),
        id: z.string().max(64).optional(),
        text: z.string().max(20000).optional(),
      }).passthrough(),
      run_tests: z.object({ filter: z.string().max(120).optional(), max: z.number().optional() }).passthrough(),
    }
  }

  execute(name, args = {}, opts = {}) {
    if (name === 'terminal') name = 'bash' // audit-style alias
    const schema = this._schemas()[name]
    if (!schema || name.startsWith('_')) {
      return { ok: false, error: `unknown tool: ${name}` }
    }
    const parsed = schema.safeParse(args ?? {})
    if (!parsed.success) {
      return { ok: false, error: `invalid arguments for ${name}: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}` }
    }
    try {
      return this[name](parsed.data, opts)
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  registry() {
    return [
      { name: 'read_file', args: { path: 'string' }, description: 'Read a file inside the workspace (secret files blocked)' },
      { name: 'write_file', args: { path: 'string', content: 'string' }, description: 'Write a file inside the workspace (secrets need approval)' },
      { name: 'list_directory', args: { path: 'string' }, description: 'List directory entries' },
      { name: 'find', args: { pattern: 'glob', path: 'string' }, description: 'Find files by glob pattern (** = any depth incl. none; skips node_modules/.git)' },
      { name: 'grep', args: { pattern: 'regex', path: 'string', include: 'glob' }, description: 'Search file contents with line numbers (built-in)' },
      { name: 'rg', args: { pattern: 'regex', path: 'string', include: 'glob' }, description: this._rgAvailable() ? 'Ripgrep search (installed, /opt/homebrew/bin on PATH)' : 'NOT installed — use grep (brew install ripgrep)' },
      { name: 'search_symbols', args: { pattern: 'string' }, description: 'Symbol map of classes/functions/consts in .mjs/.js/.ts/.tsx' },
      { name: 'repo_stats', args: { path: 'string' }, description: 'Repo size evidence: file count, LOC, top dirs/extensions — use for size questions instead of guessing' },
      { name: 'git_status', args: {}, description: 'git status --short --branch' },
      { name: 'git_diff', args: { path: 'string' }, description: 'git diff (optionally for one path)' },
      { name: 'bash', args: { command: 'string', timeout: 'number' }, description: 'Run ONE shell command (array-exec, no pipes/redirects/expansions; 60s cap; approval matrix applies)' },
      { name: 'terminal', args: { command: 'string' }, description: 'Alias of bash — shell execution (approval matrix applies)' },
      { name: 'apply_patch', args: { diff: 'unified diff' }, description: 'Apply a unified diff via git apply' },
      { name: 'localize_status', args: { job: 'string?' }, description: 'Localization pipeline state per job+locale (src/localize stages) — translation/narration/subtitle job evidence' },
      { name: 'translation_review', args: { lang: 'string', op: 'list|status|approve|correct', id: 'string?', text: 'string?' }, description: 'Editorial review ledger (Tamil/Sinhala translations) — approve/correct require human approval' },
      { name: 'run_tests', args: { filter: 'string?', max: 'number?' }, description: 'Run tests/*.test.mjs (≤5 files, node --test) and report pass/fail counts' },
    ]
  }
}
