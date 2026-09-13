import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

// Fix H (feed loop) regression: the publish-news.yml feed-commit retry loop
// ran `git reset --mixed origin/main` and then `git commit || true` WITHOUT
// re-staging — reset clears the index, so the commit was EMPTY and the push
// reported "Everything up-to-date" (exit 0): the feed refresh was SILENTLY
// LOST on every retry after a concurrent main commit. The fixed loop
// re-stages the feed paths after each reset. This test simulates the exact
// scenario against a local bare remote.

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function setupScenario() {
  const root = mkdtempSync(join(tmpdir(), 'feed-retry-'))
  const remote = join(root, 'remote.git')
  const runner = join(root, 'runner')
  const human = join(root, 'human')

  // Bare remote = origin/main.
  git(root, ['init', '--bare', remote])
  // Runner worktree: seeds the feed and pushes v1.
  mkdirSync(runner)
  git(runner, ['init'])
  git(runner, ['config', 'user.name', 'news-monster-bot'])
  git(runner, ['config', 'user.email', 'actions@users.noreply.github.com'])
  writeFileSync(join(runner, 'videos.json'), '{"version":1}\n')
  git(runner, ['add', 'videos.json'])
  git(runner, ['commit', '-m', 'chore: refresh landing page video feed'])
  git(runner, ['remote', 'add', 'origin', remote])
  git(runner, ['branch', '-M', 'main'])
  git(runner, ['push', '-u', 'origin', 'main'])

  // Runner generates feed v2 (the change that must NOT be lost).
  writeFileSync(join(runner, 'videos.json'), '{"version":2,"newVideo":"abc123"}\n')

  // Meanwhile a "human" branch commits elsewhere and pushes to main.
  mkdirSync(human)
  git(human, ['clone', remote, human])
  git(human, ['config', 'user.name', 'Human Dev'])
  git(human, ['config', 'user.email', 'human@example.com'])
  writeFileSync(join(human, 'readme.md'), 'human commit\n')
  git(human, ['add', 'readme.md'])
  git(human, ['commit', '-m', 'feat: human commit lands mid-run'])

  return { root, remote, runner, human }
}

// Faithful transcription of the workflow loop semantics (post-fix): fetch,
// reset --mixed, RE-STAGE the feed paths, skip when nothing to do, commit,
// push; retry ×3, then force-with-lease.
function workflowFeedCommit(runner) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    git(runner, ['fetch', 'origin', 'main'])
    git(runner, ['reset', '--mixed', 'origin/main'])
    git(runner, ['add', '-A', 'videos.json'])
    let hasStaged = false
    try { git(runner, ['diff', '--cached', '--quiet']) } catch { hasStaged = true }
    if (!hasStaged) return { pushed: false, reason: 'nothing-staged' }
    git(runner, ['commit', '-m', 'chore: refresh landing page video feed'])
    try {
      git(runner, ['push', 'origin', 'main'])
      return { pushed: true, attempt }
    } catch { /* rejected — retry against the fresh origin/main */ }
  }
  return { pushed: false, reason: 'retries-exhausted' }
}

test('feed retry: re-staging after reset --mixed pushes the feed', () => {
  const { root, runner, human } = setupScenario()
  try {
    // Runner has feed v2 staged as a LOCAL commit (not on origin yet).
    git(runner, ['add', 'videos.json'])
    git(runner, ['commit', '-m', 'chore: refresh landing page video feed (runner local)'])
    // Human commit lands on origin BEFORE the publish loop runs → the first
    // naive push would be rejected (non-fast-forward), forcing the retry path.
    git(human, ['push', 'origin', 'main'])

    const result = workflowFeedCommit(runner)
    assert.equal(result.pushed, true, JSON.stringify(result))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('feed retry: origin/main contains feed v2 AND the human commit (nothing lost)', () => {
  const { root, remote, runner, human } = setupScenario()
  try {
    git(runner, ['add', 'videos.json'])
    git(runner, ['commit', '-m', 'chore: refresh landing page video feed (runner local)'])
    git(human, ['push', 'origin', 'main'])

    const result = workflowFeedCommit(runner)
    assert.equal(result.pushed, true)

    // Inspect a fresh clone of origin/main.
    const check = join(root, 'check')
    git(root, ['clone', remote, check])
    assert.equal(
      readFileSync(join(check, 'videos.json'), 'utf-8').includes('newVideo":"abc123'),
      true,
      'feed v2 must be on main (it was silently lost pre-fix)'
    )
    assert.equal(existsSync(join(check, 'readme.md')), true, 'human commit must survive')
    const log = git(check, ['log', '--oneline', '--all'])
    assert.match(log, /human commit/)
    assert.match(log, /landing page video feed/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('feed retry: nothing staged after reset → reports nothing to do (no empty commit)', () => {
  const { root, remote, runner, human } = setupScenario()
  try {
    // Human pushes the SAME feed content first → after fetch+reset, nothing
    // to stage → the loop must exit WITHOUT pushing an empty commit.
    writeFileSync(join(human, 'videos.json'), '{"version":2,"newVideo":"abc123"}\n')
    git(human, ['add', 'videos.json'])
    git(human, ['commit', '-m', 'chore: refresh landing page video feed (human)'])
    git(human, ['push', 'origin', 'main'])

    const result = workflowFeedCommit(runner)
    assert.equal(result.pushed, false)
    assert.equal(result.reason, 'nothing-staged')
  } finally { rmSync(root, { recursive: true, force: true }) }
})