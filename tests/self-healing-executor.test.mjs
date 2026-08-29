import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SelfHealingExecutor } from '../src/ai/SelfHealingExecutor.mjs'

describe('SelfHealingExecutor', () => {
  it('retries recoverable errors', async () => {
    let calls = 0
    const executor = new SelfHealingExecutor()
    // Recoverable path never triggers for a plain Error that resolves on retry,
    // but the guardian writes data/production-memory.json. Isolate it by making
    // the underlying task succeed on the 2nd call and confirming it ran twice.
    const task = async () => {
      calls++
      if (calls < 2) throw new Error('transient')
      return 'ok'
    }
    const result = await executor.execute(task)
    assert.equal(result, 'ok')
    assert.equal(calls, 2)
  })

  it('does NOT retry when renderRecoverable === false', async () => {
    let calls = 0
    const executor = new SelfHealingExecutor()
    const task = async () => {
      calls++
      const err = new Error('invalid filtergraph')
      err.renderRecoverable = false
      throw err
    }
    await assert.rejects(
      executor.execute(task),
      /Non-recoverable render failure/
    )
    assert.equal(calls, 1, 'must not retry a deterministic render failure')
  })

  it('aborts immediately when non-recoverable even with retries available', async () => {
    let calls = 0
    const { ProductionGuardian } = await import('../src/ai/ProductionGuardian.mjs')
    const guardian = new ProductionGuardian({ maxRetries: 5 })
    const executor = new SelfHealingExecutor(guardian)
    const task = async () => {
      calls++
      const err = new Error('ffmpeg not found')
      err.renderRecoverable = false
      throw err
    }
    await assert.rejects(executor.execute(task))
    assert.equal(calls, 1)
  })
})
