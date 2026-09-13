import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'
import { ScriptUniqueness } from '../src/uniqueness/ScriptUniqueness.mjs'

// Fix C regression: narration dedup previously read the ledger state DIRECTLY
// without checking the registry's fail-closed flag. A corrupt ledger fell back
// to a fresh empty state → validate() passed OPEN (duplicate script allowed)
// and record()'s _save() silently OVERWROTE the corrupt ledger, resetting all
// history. Now validate() and record() both fail closed until the ledger is
// repaired (mirroring isImageQuarantined's LEDGER_CORRUPT behavior).

function corruptLedger() {
  const dir = mkdtempSync(join(tmpdir(), 'narr-ledger-'))
  const file = join(dir, 'registry.json')
  writeFileSync(file, '{ this is not valid json !!!', 'utf-8')
  return { dir, file }
}

test('narration ledger: corrupt ledger sets the fail-closed flag', () => {
  const { file } = corruptLedger()
  const registry = new AssetRegistry({ filePath: file })
  assert.equal(registry._corrupt, true)
})

test('narration ledger: validate() fails CLOSED on corrupt ledger', () => {
  const { file } = corruptLedger()
  const registry = new AssetRegistry({ filePath: file })
  const checker = new ScriptUniqueness(registry)
  assert.throws(
    () => checker.validate('NVIDIA announces a 10x faster inference chip', { jobId: 'j1' }),
    /NARRATION_LEDGER_CORRUPT/
  )
})

test('narration ledger: record() fails CLOSED and never overwrites the corrupt file', () => {
  const { dir, file } = corruptLedger()
  const registry = new AssetRegistry({ filePath: file })
  const checker = new ScriptUniqueness(registry)
  assert.throws(() => checker.record('some narration text', { jobId: 'j1' }), /NARRATION_LEDGER_CORRUPT/)
  // record() must NOT have rewritten the ledger with an empty history.
  assert.equal(readFileSync(file, 'utf-8'), '{ this is not valid json !!!')
  rmSync(dir, { recursive: true, force: true })
})

test('narration ledger: healthy ledger still validates and records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'narr-ledger-healthy-'))
  const file = join(dir, 'registry.json')
  writeFileSync(file, JSON.stringify({ scripts: {}, images: {}, music: {}, thumbnails: {}, publishedVideos: [], reservations: {} }), 'utf-8')
  const registry = new AssetRegistry({ filePath: file })
  const checker = new ScriptUniqueness(registry)
  const verdict = checker.validate('Apple expands its silicon line with a new Pro chip', { jobId: 'j1' })
  assert.equal(verdict.pass, true)
  assert.doesNotThrow(() => checker.record('Apple expands its silicon line with a new Pro chip', { jobId: 'j1' }))
  rmSync(dir, { recursive: true, force: true })
})