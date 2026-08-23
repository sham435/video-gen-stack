import fs from 'node:fs'
import path from 'node:path'

const BUDGET_PATH = path.resolve(process.env.RAPIDNEWS_BUDGET_PATH || '.newsmonster/rapidnews-budget.json')

const DAILY_LIMIT = 3
const MONTHLY_LIMIT = 100

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function monthKey() {
  return new Date().toISOString().slice(0, 7)
}

function load() {
  try {
    const raw = fs.readFileSync(BUDGET_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { daily: { key: todayKey(), count: 0 }, monthly: { key: monthKey(), count: 0 } }
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(BUDGET_PATH), { recursive: true })
  fs.writeFileSync(BUDGET_PATH, JSON.stringify(state, null, 2))
}

function check(state) {
  if (state.daily.key !== todayKey()) {
    state.daily = { key: todayKey(), count: 0 }
  }
  if (state.monthly.key !== monthKey()) {
    state.monthly = { key: monthKey(), count: 0 }
  }
  return state
}

export function getStatus() {
  const state = check(load())
  return {
    dailyCount: state.daily.count,
    dailyLimit: DAILY_LIMIT,
    monthlyCount: state.monthly.count,
    monthlyLimit: MONTHLY_LIMIT,
    dailyRemaining: DAILY_LIMIT - state.daily.count,
    monthlyRemaining: MONTHLY_LIMIT - state.monthly.count,
  }
}

export function canFetch() {
  const s = check(load())
  if (s.daily.count >= DAILY_LIMIT) return { allowed: false, reason: 'DAILY_LIMIT' }
  if (s.monthly.count >= MONTHLY_LIMIT) return { allowed: false, reason: 'MONTHLY_LIMIT' }
  return { allowed: true }
}

export function reserve() {
  const s = check(load())
  if (s.daily.count >= DAILY_LIMIT) return { reserved: false, reason: 'DAILY_LIMIT' }
  if (s.monthly.count >= MONTHLY_LIMIT) return { reserved: false, reason: 'MONTHLY_LIMIT' }
  s.daily.count++
  s.monthly.count++
  save(s)
  return { reserved: true, dailyCount: s.daily.count, monthlyCount: s.monthly.count }
}

export function consume() {
  return reserve()
}
