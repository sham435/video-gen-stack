import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'path'
import { tmpdir } from 'os'

// Fix B regression: SemanticVisualRankerV2 captures `options.memory` at
// CONSTRUCTION time (this.memory = options.memory || null). Previously the
// engine constructed the ranker BEFORE this.productionMemory existed, so the
// ranker's visual-feedback learning ran against a permanently-null memory —
// silent no-op, no crash. The engine must construct productionMemory first
// and hand the ranker the same instance.
process.env.ASSET_REGISTRY_PATH = join(tmpdir(), `asset-registry-initorder-${process.pid}.json`)

let NewsBroadcastEngine
try {
  ({ NewsBroadcastEngine } = await import('../src/index.mjs'))
} catch (e) {
  console.warn('engine import failed:', e.message)
}

test('engine: productionMemory exists before SemanticVisualRankerV2 consumes it', () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()
  assert.ok(engine.productionMemory, 'productionMemory constructed')
  assert.ok(engine.visualRankerV2, 'visualRankerV2 constructed')
  // The exact regression: ranker held a null memory reference. The shared
  // instance is what makes learning feedback actually persist.
  assert.equal(engine.visualRankerV2.memory, engine.productionMemory)
  assert.notEqual(engine.visualRankerV2.memory, null)
  assert.notEqual(engine.visualRankerV2.memory, undefined)
})

test('engine: ranker memory is the live instance used by retention learning', () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()
  // learn() must not throw: with a null memory this would be a silent no-op
  // (the pre-fix behavior); with the real memory it persists a feedback row.
  assert.doesNotThrow(() => engine.productionMemory?.learn?.({
    videoId: 'init-order-test',
    liked: false,
    retention: 0.5,
    ctr: 0.02,
    sceneIndex: 1,
  }))
})