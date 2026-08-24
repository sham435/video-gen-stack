import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CapacityPlanner } from '../src/orchestrator/CapacityPlanner.mjs'

describe('CapacityPlanner', () => {
  describe('calculate', () => {
    it('returns capacity for all stages', () => {
      const planner = new CapacityPlanner({ target: 48 })
      const result = planner.calculate()
      assert.equal(result.target, 48)
      assert.ok(result.stages.youtube)
      assert.ok(result.stages.gemini)
      assert.ok(result.stages.tts)
      assert.ok(result.stages.render)
      assert.ok(result.stages.pexels)
      assert.ok(result.stages.c2pa)
    })

    it('identifies YouTube as bottleneck with default quotas', () => {
      const planner = new CapacityPlanner({ target: 48 })
      const result = planner.calculate()
      assert.equal(result.bottleneck, 'youtube')
      assert.ok(result.achievable <= 48)
      assert.ok(result.deficit > 0)
    })

    it('no bottleneck when target is low', () => {
      const planner = new CapacityPlanner({ target: 3 })
      const result = planner.calculate()
      assert.equal(result.bottleneck, null)
      assert.ok(result.achievable >= 3)
      assert.equal(result.deficit, 0)
    })

    it('respects env var overrides', () => {
      // Save and restore env vars to avoid test contamination
      const savedUploads = process.env.YOUTUBE_DAILY_UPLOADS
      const savedChars = process.env.ELEVENLABS_DAILY_CHARS
      process.env.YOUTUBE_DAILY_UPLOADS = '100'
      process.env.ELEVENLABS_DAILY_CHARS = '500000'
      try {
        const planner = new CapacityPlanner({ target: 48 })
        const result = planner.calculate()
        assert.equal(result.stages.youtube.dailyCapacity, 100)
        assert.ok(result.bottleneck !== 'youtube')
      } finally {
        if (savedUploads !== undefined) process.env.YOUTUBE_DAILY_UPLOADS = savedUploads
        else delete process.env.YOUTUBE_DAILY_UPLOADS
        if (savedChars !== undefined) process.env.ELEVENLABS_DAILY_CHARS = savedChars
        else delete process.env.ELEVENLABS_DAILY_CHARS
      }
    })

    it('generates recommendations when bottleneck exists', () => {
      // Use a planner with a known bottleneck (low YouTube quota)
      const planner = new CapacityPlanner({
        target: 48,
        quotas: {
          youtube: { dailyUploads: 5, dailyQuotaUnits: 10000, uploadCostUnits: 1600 },
          gemini: { dailyRequests: 5000, requestsPerVideo: 2 },
          elevenlabs: { dailyChars: 50000, charsPerVideo: 1500 },
          render: { concurrentWorkers: 4, avgRenderTimeSec: 30 },
          pexels: { dailyRequests: 500, requestsPerVideo: 8 },
          c2pa: { dailySignings: 500, signingTimeSec: 2 },
        },
      })
      const result = planner.calculate()
      assert.ok(result.recommendations.length > 0)
      assert.ok(result.bottleneck === 'youtube')
      assert.ok(result.recommendations.some(r => r.includes('YouTube')))
    })

    it('has no bottleneck when all stages exceed target', () => {
      const planner = new CapacityPlanner({
        target: 10,
        quotas: {
          youtube: { dailyUploads: 50, dailyQuotaUnits: 100000, uploadCostUnits: 1600 },
          gemini: { dailyRequests: 5000, requestsPerVideo: 2 },
          elevenlabs: { dailyChars: 50000, charsPerVideo: 1500 },
          render: { concurrentWorkers: 4, avgRenderTimeSec: 30 },
          pexels: { dailyRequests: 500, requestsPerVideo: 8 },
          c2pa: { dailySignings: 500, signingTimeSec: 2 },
        },
      })
      const result = planner.calculate()
      assert.equal(result.bottleneck, null)
      assert.ok(result.achievable >= 10)
    })
  })

  describe('simulate', () => {
    it('produces a schedule', () => {
      const planner = new CapacityPlanner({ target: 48 })
      const sim = planner.simulate()
      assert.ok(sim.schedule.length > 0)
      assert.ok(sim.totalScheduled > 0)
      assert.ok(sim.utilizationRate)
    })

    it('schedule respects achievable capacity', () => {
      const planner = new CapacityPlanner({ target: 48 })
      const sim = planner.simulate()
      assert.ok(sim.totalScheduled <= sim.achievable)
    })
  })
})
