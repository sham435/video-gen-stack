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
 * Build budget from env overrides. E.g. RAPIDNEWS_DAILY_BUDGET=5 overrides
 * the default daily=3.
 */
export function getBudgetWithOverrides(provider) {
  const base = BUDGETS[provider]
  if (!base) return null
  const envKey = provider.toUpperCase()
  return {
    ...base,
    daily: parseInt(process.env[`${envKey}_DAILY_BUDGET`], 10) || base.daily,
    monthly: parseInt(process.env[`${envKey}_MONTHLY_BUDGET`], 10) || base.monthly,
    cooldownMs: parseInt(process.env[`${envKey}_COOLDOWN_MS`], 10) || base.cooldownMs,
  }
}
