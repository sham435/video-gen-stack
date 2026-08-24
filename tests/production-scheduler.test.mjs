import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProductionScheduler } from '../src/orchestrator/ProductionScheduler.mjs'

describe('ProductionScheduler', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('initializes with defaults', () => {
      const scheduler = new ProductionScheduler({
        outDir: tmpDir,
        stateDir: path.join(tmpDir, 'state'),
        checkpointDir: path.join(tmpDir, 'checkpoints'),
        dailyTarget: 10,
      })
      assert.equal(scheduler.dailyTarget, 10)
      assert.equal(scheduler.state, 'idle')
      assert.equal(scheduler.publishedToday.size, 0)
    })

    it('reads DAILY_TARGET from env', () => {
      process.env.DAILY_TARGET = '24'
      const scheduler = new ProductionScheduler({
        outDir: tmpDir,
        stateDir: path.join(tmpDir, 'state'),
        checkpointDir: path.join(tmpDir, 'checkpoints'),
      })
      assert.equal(scheduler.dailyTarget, 24)
      delete process.env.DAILY_TARGET
    })
  })

  describe('status', () => {
    it('returns current status', () => {
      const scheduler = new ProductionScheduler({
        outDir: tmpDir,
        stateDir: path.join(tmpDir, 'state'),
        checkpointDir: path.join(tmpDir, 'checkpoints'),
        dailyTarget: 10,
      })
      const status = scheduler.status()
      assert.equal(status.state, 'idle')
      assert.equal(status.dailyTarget, 10)
      assert.equal(status.activeJobs, 0)
      assert.equal(status.publishedToday, 0)
    })
  })

  describe('enqueue', () => {
    it('rejects duplicates', async () => {
      const scheduler = new ProductionScheduler({
        outDir: tmpDir,
        stateDir: path.join(tmpDir, 'state'),
        checkpointDir: path.join(tmpDir, 'checkpoints'),
      })
      // Simulate a published title
      scheduler.publishedToday.add('test article title')

      const result = await scheduler.enqueue({
        title: 'Test Article Title',
        description: 'desc',
        category: 'AI',
      })
      assert.equal(result.queued, false)
      assert.equal(result.reason, 'duplicate')
      assert.equal(scheduler._stats.duplicatesSkipped, 1)
    })

    it('respects concurrency limit', async () => {
      const scheduler = new ProductionScheduler({
        outDir: tmpDir,
        stateDir: path.join(tmpDir, 'state'),
        checkpointDir: path.join(tmpDir, 'checkpoints'),
        maxConcurrency: 1,
      })

      // Fill the concurrency slot
      scheduler.activeJobs.set('fake-job', Promise.resolve())

      const result = await scheduler.enqueue({
        title: 'New Article',
        description: 'desc',
        category: 'AI',
      })
      assert.equal(result.queued, false)
      assert.equal(result.reason, 'concurrency_limit')
    })
  })

  describe('graceful shutdown', () => {
    it('can be shut down gracefully', async () => {
      const scheduler = new ProductionScheduler({
        outDir: tmpDir,
        stateDir: path.join(tmpDir, 'state'),
        checkpointDir: path.join(tmpDir, 'checkpoints'),
      })
      await scheduler.shutdown()
      assert.equal(scheduler.state, 'stopped')
    })
  })
})
