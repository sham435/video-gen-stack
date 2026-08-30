import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RepoAgentTools } from '../src/integration/RepoAgentTools.mjs'

// RepoAgentTools derives its default root from import.meta.url, so every test
// passes an explicit root instead of relying on cwd. realpathSync matters on
// macOS: os.tmpdir() is /var/... which is a symlink to /private/var/..., and
// _resolve's startsWith check compares already-resolved paths.
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-agent-tools-')))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/index.mjs'), 'export const hello = 1\n')
  fs.writeFileSync(path.join(root, 'src/Thing.mjs'), 'export class Thing {}\n')
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=value\n')
  fs.writeFileSync(path.join(root, 'data/private.json'), '{"k":1}\n')
  fs.writeFileSync(path.join(root, 'secrets.json'), '{"token":"abc"}\n')
  fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, tools: new RepoAgentTools(root) }
}

// ── _resolve: workspace confinement ────────────────────────────────────────

test('repo-agent-tools: _resolve keeps relative paths under the root', t => {
  const { root, tools } = fixture(t)
  assert.equal(tools._resolve('src/index.mjs'), path.join(root, 'src/index.mjs'))
  assert.equal(tools._resolve('src//index.mjs'), path.join(root, 'src/index.mjs'))
  assert.equal(tools._resolve(''), root) // String(p || '.') defaults to the root itself
  assert.equal(tools._resolve('.'), root)
})

test('repo-agent-tools: _resolve rejects traversal and absolute escapes', t => {
  const { tools } = fixture(t)
  for (const p of ['../etc/passwd', '../../../../etc/shadow', '/etc/passwd', 'src/../../outside']) {
    assert.throws(() => tools._resolve(p), /escapes workspace root/, `expected ${p} to be rejected`)
  }
})

test('repo-agent-tools: _resolve does not treat a sibling-prefix dir as inside the root', t => {
  const { root, tools } = fixture(t)
  // The guard is `full === root || full.startsWith(root + sep)`, so a sibling
  // directory sharing the root's name as a prefix must still be rejected.
  assert.throws(() => tools._resolve(path.join(root + '-evil', 'x')), /escapes workspace root/)
})

// GAP: no tilde expansion. Harmless today because the result is re-anchored
// under the root, but it silently creates a literal '~' directory on write.
test('repo-agent-tools: _resolve treats ~ as a literal path segment (gap)', t => {
  const { root, tools } = fixture(t)
  assert.equal(tools._resolve('~/.ssh/id_rsa'), path.join(root, '~/.ssh/id_rsa'))
})

// ── _isSecret: read-side redaction ─────────────────────────────────────────

test('repo-agent-tools: _isSecret blocks .env files and the secret directories', t => {
  const { root, tools } = fixture(t)
  for (const p of ['.env', '.env.local', '.env.production', 'src/.env', 'data/private.json', '.git/config', 'storage/x', 'snapshots/y', 'secrets/z']) {
    assert.equal(tools._isSecret(path.join(root, p)), true, `expected ${p} to be secret`)
  }
})

test('repo-agent-tools: _isSecret allows ordinary source files', t => {
  const { root, tools } = fixture(t)
  for (const p of ['src/index.mjs', 'README.md', 'package.json']) {
    assert.equal(tools._isSecret(path.join(root, p)), false, `expected ${p} to be readable`)
  }
})

// GAP: only `.env*` basenames and the five SECRET_DIRS are recognised. Every
// name below is a plausible credential file that reads through unblocked.
test('repo-agent-tools: _isSecret misses credential-shaped filenames (gap)', t => {
  const { root, tools } = fixture(t)
  for (const p of ['secrets.json', 'api-key.txt', 'credentials.json', 'id_rsa', 'token.yaml', '.ENV']) {
    assert.equal(tools._isSecret(path.join(root, p)), false, `${p} is currently NOT treated as secret`)
  }
})

// ── _approvalFor: mutation gating ──────────────────────────────────────────

test('repo-agent-tools: _approvalFor returns the matching action name', t => {
  const { tools } = fixture(t)
  assert.equal(tools._approvalFor('git push origin main'), 'push-to-main')
  assert.equal(tools._approvalFor('rm -rf build'), 'delete-files')
  assert.equal(tools._approvalFor('railway up'), 'deploy-production')
  assert.equal(tools._approvalFor('cat .env'), 'modify-secrets')
  assert.equal(tools._approvalFor('sudo launchctl load x'), 'infrastructure-change')
  assert.equal(tools._approvalFor('psql -c "DROP TABLE runs"'), 'schema-change')
})

test('repo-agent-tools: _approvalFor lets ordinary commands through', t => {
  const { tools } = fixture(t)
  for (const cmd of ['npm test', 'node scripts/gc-artifacts.mjs', 'git status', 'ls src']) {
    assert.equal(tools._approvalFor(cmd), null, `${cmd} should not need approval`)
  }
})

// GAP: the action is named push-to-main but the pattern is branch-agnostic.
// Fails closed, so it is safe — just broader than the name implies.
test('repo-agent-tools: push gate matches any branch, not just main (gap)', t => {
  const { tools } = fixture(t)
  assert.equal(tools._approvalFor('git push origin feature/thumbnails'), 'push-to-main')
})

// GAP: destructive commands with no matching pattern run unprompted.
test('repo-agent-tools: reset --hard and npm publish are ungated (gap)', t => {
  const { tools } = fixture(t)
  assert.equal(tools._approvalFor('git reset --hard HEAD~1'), null)
  assert.equal(tools._approvalFor('git clean -fdx'), null)
  assert.equal(tools._approvalFor('npm publish'), null)
})

// ── public tool surface ────────────────────────────────────────────────────

test('repo-agent-tools: read_file blocks secrets and reads source', t => {
  const { tools } = fixture(t)
  const blocked = tools.read_file({ path: '.env' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.blocked, 'workspace.secret')
  assert.ok(!JSON.stringify(blocked).includes('SECRET=value'), 'secret content must not leak')

  assert.match(tools.read_file({ path: 'src/index.mjs' }).content, /hello/)
  assert.match(tools.read_file({ file: 'README.md' }).content, /fixture/) // `file` alias
  assert.equal(tools.read_file({}).ok, false)
})

test('repo-agent-tools: write_file gates secrets behind approval', t => {
  const { root, tools } = fixture(t)
  const denied = tools.write_file({ path: '.env.local', content: 'X=1' })
  assert.equal(denied.ok, false)
  assert.deepEqual(denied.approvalRequired, ['modify-secrets'])
  assert.equal(fs.existsSync(path.join(root, '.env.local')), false, 'denied write must not touch disk')

  assert.equal(tools.write_file({ path: 'src/new.mjs', content: 'export const a = 1' }).ok, true)
  assert.equal(tools.write_file({ path: '.env.local', content: 'X=1' }, { approvals: ['modify-secrets'] }).ok, true)
})

test('repo-agent-tools: bash refuses gated commands before executing', t => {
  const { root, tools } = fixture(t)
  const denied = tools.bash({ command: 'git push origin main && touch pushed.txt' })
  assert.equal(denied.ok, false)
  assert.deepEqual(denied.approvalRequired, ['push-to-main'])
  assert.equal(fs.existsSync(path.join(root, 'pushed.txt')), false, 'nothing may run when approval is withheld')

  assert.match(tools.bash({ command: 'echo hi' }).stdout, /hi/)
})

test('repo-agent-tools: execute dispatches, aliases terminal, refuses private methods', t => {
  const { tools } = fixture(t)
  assert.equal(tools.execute('read_file', { path: 'README.md' }).ok, true)
  assert.match(tools.execute('terminal', { command: 'echo t' }).stdout, /t/)
  assert.match(tools.execute('nope', {}).error, /unknown tool/)
  assert.match(tools.execute('_resolve', { path: '.' }).error, /unknown tool/)
})

test('repo-agent-tools: find, grep and search_symbols locate fixture files', t => {
  const { tools } = fixture(t)
  // Single-segment and literal-prefix globs work; see the `**` gap test below.
  assert.ok(tools.find({ pattern: 'src/*.mjs' }).matches.includes(path.join('src', 'index.mjs')))
  assert.ok(tools.find({ pattern: '*.md' }).matches.includes('README.md'))

  const hits = tools.grep({ pattern: 'hello', include: '*.mjs' })
  assert.equal(hits.count, 1)
  assert.equal(hits.results[0].file, path.join('src', 'index.mjs'))

  const symbols = tools.search_symbols({ pattern: 'Thing' })
  assert.equal(symbols.results.some(r => r.symbol === 'class Thing'), true)
})

// GAP: _globToRegExp maps '**' to '(?:.*/)?' (trailing slash included) and then
// .join('/') appends a second slash, yielding ^(?:.*/)?/[^/]*$ — unsatisfiable.
// Every '**' glob matches nothing, including find()'s own default pattern, so a
// bare find() reports an empty repo instead of listing it.
test('repo-agent-tools: ** globs match nothing, including the default (gap)', t => {
  const { tools } = fixture(t)
  assert.match(String(tools._globToRegExp('**/*.mjs')), /\(\?:\.\*\\?\/\)\?\\?\//)
  assert.equal(tools.find({ pattern: '**/*.mjs' }).matches.length, 0)
  assert.equal(tools.find({ pattern: '**/*' }).matches.length, 0)
  assert.equal(tools.find({}).matches.length, 0, 'default pattern **/* finds nothing')
})

test('repo-agent-tools: grep skips secret files', t => {
  const { tools } = fixture(t)
  const hits = tools.grep({ pattern: 'SECRET', include: '*' })
  assert.equal(hits.results.some(r => r.file === '.env'), false, '.env must never appear in grep output')
})

test('repo-agent-tools: repo_stats counts the tree', t => {
  const { tools } = fixture(t)
  const stats = tools.repo_stats()
  assert.ok(stats.total_files >= 6)
  assert.ok(stats.lines.total > 0)
  assert.ok(Array.isArray(stats.top_extensions))
})

// GAP: repo_stats is dispatchable but absent from registry(), so a model that
// enumerates tools from the registry never learns it exists — the exact
// bash-and-guess fallback its own comment says it was added to prevent.
test('repo-agent-tools: registry omits repo_stats (gap)', t => {
  const { tools } = fixture(t)
  const names = tools.registry().map(r => r.name)
  assert.equal(new Set(names).size, names.length, 'registry names must be unique')
  assert.equal(names.includes('repo_stats'), false)
  assert.equal(tools.execute('repo_stats', {}).ok, true, 'yet it dispatches fine')
})
