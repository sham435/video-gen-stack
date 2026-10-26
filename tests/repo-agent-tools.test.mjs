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
//
// SECURITY BASELINE (2026-10-26 hardening): the six gaps this file used to
// document (tilde literal paths, credential-shaped basenames readable, `**`
// globs unsatisfiable, ungated `git reset --hard`/`npm publish`, registry
// omitting repo_stats, shell-string exec) are now FIXED and asserted here as
// positive security behavior instead of documented holes.
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

// FIXED (was documented as a gap): a leading '~' is no longer silently
// re-anchored under the root — it would have created a literal '~' directory
// on write and masked outside-workspace intent. It is refused outright.
// (The tools throw synchronously; capture via execute(), which wraps errors.)
test('repo-agent-tools: _resolve refuses tilde paths instead of re-anchoring them', t => {
  const { tools } = fixture(t)
  assert.throws(() => tools._resolve('~'), /escapes workspace root/)
  assert.throws(() => tools._resolve('~/secrets'), /escapes workspace root/)
  const viaTool = tools.execute('read_file', { path: '~/.ssh/id_rsa' })
  assert.equal(viaTool.ok, false)
  assert.match(viaTool.error, /escapes workspace root/)
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
  for (const p of ['src/index.mjs', 'README.md', 'package.json', 'tokenize.mjs', 'mockToken.js']) {
    // tokenize/mockToken prove the credential regex is boundary-guarded:
    // words CONTAINING "token" with no separator stay readable.
    assert.equal(tools._isSecret(path.join(root, p)), false, `expected ${p} to be readable`)
  }
})

// FIXED (was a documented gap): credential-shaped basenames are now blocked.
// The pre-hardening gate only recognized .env* — every name below read
// through unblocked and could exfiltrate live credentials.
test('repo-agent-tools: _isSecret blocks credential-shaped filenames', t => {
  const { root, tools } = fixture(t)
  for (const p of ['secrets.json', 'api-key.txt', 'credentials.json', 'id_rsa', 'token.yaml', '.ENV', 'server.pem', 'my.secret.env', 'service-account.json']) {
    assert.equal(tools._isSecret(path.join(root, p)), true, `${p} must be treated as secret`)
  }
  // and the public surface honors it too, not just _isSecret:
  const blocked = tools.read_file({ path: 'secrets.json' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.blocked, 'workspace.secret')
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
  assert.equal(tools._approvalFor('npm install left-pad'), 'dependency-add')
})

test('repo-agent-tools: _approvalFor lets ordinary commands through', t => {
  const { tools } = fixture(t)
  for (const cmd of ['npm test', 'node scripts/gc-artifacts.mjs', 'git status', 'ls src']) {
    assert.equal(tools._approvalFor(cmd), null, `${cmd} should not need approval`)
  }
})

// INTENDED fail-closed behavior: the action is named push-to-main but gating
// any remote-changing git op is the safe default; restricting to literal
// "main" would let agent code write to every other branch unapproved.
test('repo-agent-tools: push gate matches any branch (fail-closed)', t => {
  const { tools } = fixture(t)
  assert.equal(tools._approvalFor('git push origin feature/thumbnails'), 'push-to-main')
})

// FIXED (was a documented gap): destructive commands were ungated. They are
// now mapped into the approval matrix before anything executes.
test('repo-agent-tools: destructive commands are gated behind approval', t => {
  const { tools } = fixture(t)
  assert.equal(tools._approvalFor('git reset --hard HEAD~1'), 'delete-files')
  assert.equal(tools._approvalFor('git clean -fdx'), 'delete-files')
  assert.equal(tools._approvalFor('git restore --staged .'), 'delete-files')
  assert.equal(tools._approvalFor('git checkout -- .'), 'delete-files')
  assert.equal(tools._approvalFor('npm publish'), 'deploy-production')
  assert.equal(tools._approvalFor('pip install requests'), 'dependency-add')
  // and bash refuses to execute them without the approval on the deny path:
  const denied = tools.bash({ command: 'git reset --hard HEAD~1' })
  assert.equal(denied.ok, false)
  assert.deepEqual(denied.approvalRequired, ['delete-files'])
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

test('repo-agent-tools: write_file gates secrets behind approval and refuses escapes', t => {
  const { root, tools } = fixture(t)
  const denied = tools.write_file({ path: '.env.local', content: 'X=1' })
  assert.equal(denied.ok, false)
  assert.deepEqual(denied.approvalRequired, ['modify-secrets'])
  assert.equal(fs.existsSync(path.join(root, '.env.local')), false, 'denied write must not touch disk')

  assert.equal(tools.write_file({ path: 'src/new.mjs', content: 'export const a = 1' }).ok, true)
  assert.equal(tools.write_file({ path: '.env.local', content: 'X=1' }, { approvals: ['modify-secrets'] }).ok, true)

  // traversal can never write outside the workspace (write throws; execute wraps)
  const escaped = tools.execute('write_file', { path: '../../outside.txt', content: 'x' })
  assert.equal(escaped.ok, false)
  assert.match(escaped.error, /escapes workspace root/)
  assert.equal(fs.existsSync(path.join(root, '..', 'outside.txt')), false)
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

test('repo-agent-tools: zod schemas reject malformed arguments before dispatch', t => {
  const { tools } = fixture(t)
  // strict schemas refuse undeclared keys (no hidden mutating extras)
  assert.match(tools.execute('write_file', { path: 'x.md', content: 'c', extra: 1 }).error, /invalid arguments/)
  assert.match(tools.execute('bash', { command: 'echo hi', timeout: 'slow' }).error, /invalid arguments/)
  assert.match(tools.execute('bash', { command: '' }).error, /invalid arguments/)
  assert.match(tools.execute('apply_patch', { diff: 42 }).error, /invalid arguments/)
  // valid typed arguments dispatch fine
  assert.equal(tools.execute('bash', { command: 'echo ok' }).ok, true)
})

test('repo-agent-tools: bash tokenizer refuses shell metacharacters and expansions', t => {
  const { root, tools } = fixture(t)
  const refusals = [
    /^echo hi \| cat/, /unsupported shell syntax/, () => tools.execute('bash', { command: 'echo hi | cat' }), /^[^\n]*\.txt$/,
  ]
  // each dangerous form is refused WITHOUT executing anything
  const cases = [
    ['echo hi | cat', /shell feature/],
    ['echo a; echo b', /shell feature/],
    ['echo hi > out.txt', /shell feature/],
    ['echo `id`', /shell feature/],
    ['echo $(whoami)', /\$ expansion/],
    ['echo ${HOME}', /\$ expansion/],
    ['echo "unbalanced', /unbalanced quote/],
    ['echo a\necho b', /shell feature/],
  ]
  for (const [cmd, re] of cases) {
    const r = tools.execute('bash', { command: cmd })
    assert.equal(r.ok, false, `${cmd} must be refused`)
    assert.match(r.error, re, `${cmd} refusal should explain why`)
  }
  assert.equal(fs.existsSync(path.join(root, 'out.txt')), false, 'refused redirect must not create files')

  // gated-by-approval (before token inspection) — destructive words inside a
  // chained command hit the approval matrix FIRST, which is also a refusal:
  const chained = tools.execute('bash', { command: 'echo a && rm x' })
  assert.equal(chained.ok, false)
  assert.deepEqual(chained.approvalRequired, ['delete-files'])

  // single-quoted literals pass through verbatim ($ stays literal — no shell)
  assert.match(tools.execute('bash', { command: "echo 'a $b c'" }).stdout, /a \$b c/)
  assert.match(tools.execute('bash', { command: 'echo "x y"' }).stdout, /x y/)
  // comments are stripped, not executed
  assert.match(tools.execute('bash', { command: 'echo visible # hidden note' }).stdout, /visible/)
})

test('repo-agent-tools: bash runs array-exec with a hard timeout cap and kill', t => {
  const { tools } = fixture(t)
  const r = tools.execute('bash', { command: 'echo exec-cap', timeout: 999999999 })
  assert.equal(r.ok, true)
  assert.equal(r.timeout_ms, 60000, 'requested timeout is capped at 60s')

  // a real overrun is killed rather than hung (fast: 250ms window, 3s job)
  const killed = tools.execute('bash', { command: 'node -e "setTimeout(() => {}, 3000)"', timeout: 250 })
  assert.equal(killed.ok, false)
  assert.equal(killed.timeout_ms, 250)
})

test('repo-agent-tools: find, grep and search_symbols locate fixture files', t => {
  const { tools } = fixture(t)
  assert.ok(tools.find({ pattern: 'src/*.mjs' }).matches.includes(path.join('src', 'index.mjs')))
  assert.ok(tools.find({ pattern: '*.md' }).matches.includes('README.md'))

  const hits = tools.grep({ pattern: 'hello', include: '*.mjs' })
  assert.equal(hits.count, 1)
  assert.equal(hits.results[0].file, path.join('src', 'index.mjs'))

  const symbols = tools.search_symbols({ pattern: 'Thing' })
  assert.equal(symbols.results.some(r => r.symbol === 'class Thing'), true)
})

// FIXED (was a documented gap): `**` segment-wise globs now match at any depth
// INCLUDING zero segments, so bare find() no longer reports an empty repo.
test('repo-agent-tools: ** globs match files at any depth, including zero', t => {
  const { root, tools } = fixture(t)
  fs.mkdirSync(path.join(root, 'pkg', 'x'), { recursive: true })
  fs.writeFileSync(path.join(root, 'pkg', 'index.mjs'), 'export const p = 1\n')
  fs.writeFileSync(path.join(root, 'pkg', 'x', 'deep.mjs'), 'export const d = 1\n')

  // zero-depth under the ** segment: pkg/** / *.mjs finds pkg/index.mjs
  const mid = tools.find({ pattern: 'pkg/**/*.mjs' })
  assert.ok(mid.matches.includes(path.join('pkg', 'index.mjs')), 'a/**/b must match a/b')
  assert.ok(mid.matches.includes(path.join('pkg', 'x', 'deep.mjs')), 'a/**/b must match a/x/y/b')

  // double-star at the tail matches everything below the prefix
  const deep = tools.find({ pattern: 'src/**' })
  assert.ok(deep.matches.includes(path.join('src', 'index.mjs')))
  assert.ok(deep.matches.includes(path.join('src', 'Thing.mjs')))

  // the default pattern no longer lies about the repo being empty
  const all = tools.find({}).matches
  assert.ok(all.includes('README.md'), 'default **/* must find root files')
  assert.ok(all.includes(path.join('pkg', 'x', 'deep.mjs')), 'default **/* must find nested files')
  assert.equal(tools.find({ pattern: '**/*' }).matches.length > 0, true)
  assert.match(String(tools.find({ pattern: '**/*.mjs' }).pattern), /\*\*/)
})

test('repo-agent-tools: grep skips secret files', t => {
  const { tools } = fixture(t)
  const hits = tools.grep({ pattern: 'SECRET|token', include: '*' })
  assert.equal(hits.results.some(r => r.file === '.env'), false, '.env must never appear in grep output')
  assert.equal(hits.results.some(r => r.file === 'secrets.json'), false, 'credential files must never appear either')
})

test('repo-agent-tools: repo_stats counts the tree', t => {
  const { tools } = fixture(t)
  const stats = tools.repo_stats()
  assert.ok(stats.total_files >= 6)
  assert.ok(stats.lines.total > 0)
  assert.ok(Array.isArray(stats.top_extensions))
})

// FIXED (was a documented gap): repo_stats is in the registry, and every
// registry entry is a real dispatchable tool with a unique name.
test('repo-agent-tools: registry lists every tool exactly once and is dispatchable', t => {
  const { tools } = fixture(t)
  const names = tools.registry().map(r => r.name)
  assert.equal(new Set(names).size, names.length, 'registry names must be unique')
  for (const name of ['repo_stats', 'localize_status', 'translation_review', 'run_tests', 'bash', 'rg', 'git_status']) {
    assert.ok(names.includes(name), `registry must include ${name}`)
  }
  for (const name of names) {
    const r = tools.execute(name, {}) // empty args — we only care it DISPATCHES
    assert.doesNotMatch(r.error || '', /unknown tool/, `${name} must be dispatchable`)
  }
})

// ── localization-facing tools ──────────────────────────────────────────────

test('repo-agent-tools: localize_status is read-only and reports missing state safely', t => {
  const { tools } = fixture(t)
  const empty = tools.execute('localize_status', {})
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.jobs, {})

  const byId = tools.execute('localize_status', { job: 'no-such-job-xyz' })
  assert.equal(byId.ok, true)
  assert.deepEqual(byId.jobs, {})
})

test('repo-agent-tools: translation_review gates editorial decisions behind approval', t => {
  const { tools } = fixture(t)
  // approve/correct are HUMAN decisions — the agent must not advance a review
  const gated = tools.execute('translation_review', { lang: 'ta', op: 'approve', id: 'abcdef0123456789abcdef0123' })
  assert.equal(gated.ok, false)
  assert.deepEqual(gated.approvalRequired, ['modify-content'])

  const gatedCorrect = tools.execute('translation_review', { lang: 'si', op: 'correct', id: 'abc', text: 'x' })
  assert.deepEqual(gatedCorrect.approvalRequired, ['modify-content'])

  // even WITH approval, an unknown id fails cleanly (no ledger write)
  const missing = tools.execute('translation_review', { lang: 'ta', op: 'approve', id: 'ffffffffffffffffffffffff' }, { approvals: ['modify-content'] })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /no item/)

  // listing is the agent's read-only default and tolerates unknown langs
  const list = tools.execute('translation_review', { lang: 'zz-unknown-locale' })
  assert.equal(list.ok, true)
  assert.equal(list.pendingCount, 0)
  assert.equal(list.total, 0)
  assert.deepEqual(list.items, [])

  assert.match(tools.execute('translation_review', {}).error, /lang required/)
})

// ── run_tests allowlist + self-check (recursion-guarded) ───────────────────

test('repo-agent-tools: run_tests only executes tests/*.test.mjs within bounds', t => {
  const { tools } = fixture(t)
  const none = tools.execute('run_tests', {})
  assert.equal(none.ok, false)
  assert.match(none.error, /no tests\/ directory/)
})

const NESTED = process.env.REPO_AGENT_NESTED === '1'
test('repo-agent-tools: run_tests executes the real suite and reports counts', { skip: NESTED ? 'nested run of this same file — recursion guard' : false }, t => {
  const tools = new RepoAgentTools() // default root = this repo's real root
  // an allowlisted-name filter that matches nothing returns an empty run — no
  // shell ever sees the filter string (substrings of real filenames only)
  const safe = tools.execute('run_tests', { filter: 'this-file-does-not-exist' })
  assert.equal(safe.ok, true)
  assert.deepEqual(safe.files, [])

  process.env.REPO_AGENT_NESTED = '1' // the child inherits a set env → skips this test → no recursion
  try {
    const r = tools.execute('run_tests', { filter: 'repo-agent-tools', max: 1 })
    assert.equal(r.fail, 0, `run_tests must pass its own suite: ${r.output}`)
    assert.equal(r.ok, true)
    assert.equal(r.files.length, 1)
    assert.ok(r.pass >= 20, `expected a real pass count from node --test, got ${r.pass}`)
  } finally {
    delete process.env.REPO_AGENT_NESTED
  }
})
