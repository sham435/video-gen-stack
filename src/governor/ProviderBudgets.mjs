/**
 * ProviderBudgets — static definitions of per-provider rate limits.
 *
 * Each budget has:
 *   daily:   max requests per calendar day (UTC)
 *   monthly: max requests per calendar month (UTC)
 *   cooldownMs: minimum gap between requests (0 = no limit)
 *
 * The ResourceGovernor enforces these before any external call.
 * When a budget is exhausted, the stage transitions to WAITING_FOR_QUOTA
 * with a calculated nextEligibleAt — not a retry with backoff.
 */

const BUDGETS = Object.freeze({
  rapidnews: Object.freeze({
    daily: 3,
    monthly: 100,
    cooldownMs: 0,
    description: 'RapidAPI Real-Time News Data',
  }),
  elevenlabs: Object.freeze({
    daily: 10,
    monthly: 200,
    cooldownMs: 1000,
    description: 'ElevenLabs TTS',
  }),
  youtube: Object.freeze({
    daily: 6,
    monthly: 100,
    cooldownMs: 30_000,
    description: 'YouTube Data API v3',
  }),
  newsdata: Object.freeze({
    daily: 50,
    monthly: 1000,
    cooldownMs: 0,
    description: 'NewsData.io',
  }),
  newsapi: Object.freeze({
    daily: 100,
    monthly: 1000,
    cooldownMs: 0,
    description: 'NewsAPI.org',
  }),
  pexels: Object.freeze({
    daily: 200,
    monthly: 5000,
    cooldownMs: 0,
    description: 'Pexels stock images',
  }),
  gemini: Object.freeze({
    daily: 50,
    monthly: 1000,
    cooldownMs: 0,
    description: 'Google Gemini AI',
  }),
})

export function getBudget(provider) {
  return BUDGETS[provider] || null
}

export function getBudgets() {
  return { ...BUDGETS }
}

export function listProviders() {
  return Object.keys(BUDGETS)
}

/**
 * Build budget from env overrides. Env values can only REDUCE limits,
 * never increase them above the hard provider cap.
 *
 * E.g. RAPIDNEWS_DAILY_BUDGET=2 reduces from 3→2 (valid).
 *      RAPIDNEWS_DAILY_BUDGET=500 stays at 3 (hard cap).
 */
export function getBudgetWithOverrides(provider) {
  const base = BUDGETS[provider]
  if (!base) return null
  const envKey = provider.toUpperCase()
  const envDaily = parseInt(process.env[`${envKey}_DAILY_BUDGET`], 10)
  const envMonthly = parseInt(process.env[`${envKey}_MONTHLY_BUDGET`], 10)
  const envCooldown = parseInt(process.env[`${envKey}_COOLDOWN_MS`], 10)
  return {
    ...base,
    daily: Number.isFinite(envDaily) ? Math.min(envDaily, base.daily) : base.daily,
    monthly: Number.isFinite(envMonthly) ? Math.min(envMonthly, base.monthly) : base.monthly,
    cooldownMs: Number.isFinite(envCooldown) ? Math.max(envCooldown, base.cooldownMs) : base.cooldownMs,
  }
}
