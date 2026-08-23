import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUDGET_PATH = path.join(__dirname, '..', '.newsmonster', 'rapidnews-budget-test.json')

describe('RapidNewsBudget', () => {
  before(() => {
    process.env.RAPIDNEWS_BUDGET_PATH = BUDGET_PATH
    try { fs.unlinkSync(BUDGET_PATH) } catch {}
  })

  after(() => {
    try { fs.unlinkSync(BUDGET_PATH) } catch {}
    delete process.env.RAPIDNEWS_BUDGET_PATH
  })

  it('returns fresh status when no budget file exists', async () => {
    const { getStatus } = await import('../src/news/RapidNewsBudget.mjs')
    const s = getStatus()
    assert.equal(s.dailyCount, 0)
    assert.equal(s.monthlyCount, 0)
    assert.equal(s.dailyRemaining, 3)
    assert.equal(s.monthlyRemaining, 100)
  })

  it('canFetch returns allowed=true when fresh', async () => {
    const { canFetch } = await import('../src/news/RapidNewsBudget.mjs')
    const r = canFetch()
    assert.equal(r.allowed, true)
  })

  it('reserve increments counters and persists', async () => {
    const { reserve, getStatus } = await import('../src/news/RapidNewsBudget.mjs')
    const r = reserve()
    assert.equal(r.reserved, true)
    assert.equal(r.dailyCount, 1)
    assert.equal(r.monthlyCount, 1)
    const s = getStatus()
    assert.equal(s.dailyCount, 1)
    assert.equal(s.monthlyCount, 1)
    assert.equal(s.dailyRemaining, 2)
  })

  it('reserve three more hits daily limit', async () => {
    const { reserve, canFetch } = await import('../src/news/RapidNewsBudget.mjs')
    reserve() // daily=2
    reserve() // daily=3 (at limit)
    const r = reserve() // daily=4 would exceed
    assert.equal(r.reserved, false)
    assert.equal(r.reason, 'DAILY_LIMIT')
    const c = canFetch()
    assert.equal(c.allowed, false)
    assert.equal(c.reason, 'DAILY_LIMIT')
  })

  it('monthly limit prevents fetch when daily is reset', async () => {
    // Reset budget file with daily=0 but monthly=100
    fs.mkdirSync(path.dirname(BUDGET_PATH), { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const month = new Date().toISOString().slice(0, 7)
    fs.writeFileSync(BUDGET_PATH, JSON.stringify({
      daily: { key: today, count: 0 },
      monthly: { key: month, count: 100 },
    }))
    const { canFetch, reserve } = await import('../src/news/RapidNewsBudget.mjs')
    const c = canFetch()
    assert.equal(c.allowed, false)
    assert.equal(c.reason, 'MONTHLY_LIMIT')
    const r = reserve()
    assert.equal(r.reserved, false)
    assert.equal(r.reason, 'MONTHLY_LIMIT')
  })

  it('daily counter resets on new day', async () => {
    const { reserve, canFetch } = await import('../src/news/RapidNewsBudget.mjs')
    // Simulate yesterday's data
    const yesterday = '2020-01-01'
    const month = new Date().toISOString().slice(0, 7)
    fs.writeFileSync(BUDGET_PATH, JSON.stringify({
      daily: { key: yesterday, count: 5 },
      monthly: { key: month, count: 10 },
    }))
    const c = canFetch()
    assert.equal(c.allowed, true)
    const r = reserve()
    assert.equal(r.reserved, true)
    assert.equal(r.dailyCount, 1)
    assert.equal(r.monthlyCount, 11)
  })

  it('monthly counter resets on new month', async () => {
    const { reserve, getStatus } = await import('../src/news/RapidNewsBudget.mjs')
    const today = new Date().toISOString().slice(0, 10)
    const lastMonth = '2020-01'
    fs.writeFileSync(BUDGET_PATH, JSON.stringify({
      daily: { key: today, count: 2 },
      monthly: { key: lastMonth, count: 99 },
    }))
    const r = reserve()
    assert.equal(r.reserved, true)
    assert.equal(r.monthlyCount, 1)
    assert.equal(r.dailyCount, 3)
  })

  it('corrupt budget file is handled gracefully', async () => {
    fs.writeFileSync(BUDGET_PATH, 'not-json')
    const { getStatus, canFetch } = await import('../src/news/RapidNewsBudget.mjs')
    const s = getStatus()
    assert.equal(s.dailyCount, 0)
    assert.equal(canFetch().allowed, true)
  })
})
