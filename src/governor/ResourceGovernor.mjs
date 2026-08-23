import fs from 'fs'
import path from 'path'
import { getBudgetWithOverrides, listProviders } from './ProviderBudgets.mjs'
import { OperationJournal } from './OperationJournal.mjs'

/**
 * ResourceGovernor enforces quota BEFORE any external call.
 *
 * Lifecycle per operation:
 *   1. canExecute(provider) → { allowed, reason, nextEligibleAt }
 *   2. reserve(provider)    → marks one slot consumed
 *   3. complete(provider)   → records remote_id + remote_state
 *   4. fail(provider)       → releases the slot (next job can retry)
 *
 * States this produces:
 *   - QUOTA_AVAILABLE:   safe to call
 *   - QUOTA_UNAVAILABLE: budget exhausted, WAITING_FOR_QUOTA
 *   - COOLDOWN:          too soon since last call
 *
 * This is NOT the same as RetryPolicy:
 *   RATE_LIMITED    = provider rejected after we attempted
 *   QUOTA_UNAVAILABLE = we knew beforehand not to attempt
 *
 * Usage counts persist to disk (JSON) so they survive restarts.
 */

const DEFAULT_STATE_DIR = '.newsmonster/governor'

export class ResourceGovernor {
  constructor(options = {}) {
    this.stateDir = options.stateDir || DEFAULT_STATE_DIR
    this.journal = new OperationJournal(options.journalDir)
    this.statePath = path.join(this.stateDir, 'quota-state.json')
    this.state = this._load()
  }

  /**
   * Check if a provider call is allowed right now.
   *
   * @param {string} provider - provider key (e.g. "rapidnews", "youtube")
   * @param {string} jobId - current job ID for journal correlation
   * @returns {{ allowed: boolean, reason: string, nextEligibleAt: string|null, budget: object }}
   */
  canExecute(provider, jobId) {
    const budget = getBudgetWithOverrides(provider)
    if (!budget) return { allowed: true, reason: 'no budget defined', nextEligibleAt: null, budget: null }

    const now = Date.now()
    const today = this._today()
    const thisMonth = this._thisMonth()
    const counts = this._getCounts(provider)
    const dailyUsed = counts.daily?.date === today ? counts.daily.used : 0
    const monthlyUsed = counts.monthly?.month === thisMonth ? counts.monthly.used : 0
    const lastCallAt = counts.lastCallAt || 0

    // Check daily limit
    if (dailyUsed >= budget.daily) {
      const nextDay = this._nextDayStart()
      return {
        allowed: false,
        reason: `daily quota exhausted (${dailyUsed}/${budget.daily})`,
        nextEligibleAt: new Date(nextDay).toISOString(),
        budget: { ...budget, dailyUsed, monthlyUsed },
      }
    }

    // Check monthly limit
    if (monthlyUsed >= budget.monthly) {
      const nextMonth = this._nextMonthStart()
      return {
        allowed: false,
        reason: `monthly quota exhausted (${monthlyUsed}/${budget.monthly})`,
        nextEligibleAt: new Date(nextMonth).toISOString(),
        budget: { ...budget, dailyUsed, monthlyUsed },
      }
    }

    // Check cooldown
    if (budget.cooldownMs > 0 && lastCallAt > 0) {
      const elapsed = now - lastCallAt
      if (elapsed < budget.cooldownMs) {
        const nextEligible = lastCallAt + budget.cooldownMs
        return {
          allowed: false,
          reason: `cooldown (${elapsed}ms < ${budget.cooldownMs}ms)`,
          nextEligibleAt: new Date(nextEligible).toISOString(),
          budget: { ...budget, dailyUsed, monthlyUsed },
        }
      }
    }

    // Also check journal for real-world call counts (survives state reset)
    const journalDaily = this.journal.countInWindow(provider, 24 * 60 * 60 * 1000)
    const journalMonthly = this.journal.countInWindow(provider, 30 * 24 * 60 * 60 * 1000)

    if (journalDaily >= budget.daily) {
      const nextDay = this._nextDayStart()
      return {
        allowed: false,
        reason: `daily quota exhausted via journal (${journalDaily}/${budget.daily})`,
        nextEligibleAt: new Date(nextDay).toISOString(),
        budget: { ...budget, dailyUsed: journalDaily, monthlyUsed: journalMonthly },
      }
    }

    if (journalMonthly >= budget.monthly) {
      const nextMonth = this._nextMonthStart()
      return {
        allowed: false,
        reason: `monthly quota exhausted via journal (${journalMonthly}/${budget.monthly})`,
        nextEligibleAt: new Date(nextMonth).toISOString(),
        budget: { ...budget, dailyUsed: journalDaily, monthlyUsed: journalMonthly },
      }
    }

    return {
      allowed: true,
      reason: 'quota available',
      nextEligibleAt: null,
      budget: { ...budget, dailyUsed: Math.max(dailyUsed, journalDaily), monthlyUsed: Math.max(monthlyUsed, journalMonthly) },
    }
  }

  /**
   * Reserve one slot for a provider. Call BEFORE making the external request.
   */
  reserve(provider) {
    const now = Date.now()
    const today = this._today()
    const thisMonth = this._thisMonth()
    const counts = this._getCounts(provider)

    if (counts.daily?.date !== today) {
      counts.daily = { date: today, used: 0 }
    }
    if (counts.monthly?.month !== thisMonth) {
      counts.monthly = { month: thisMonth, used: 0 }
    }

    counts.daily.used++
    counts.monthly.used++
    counts.lastCallAt = now
    this._setCounts(provider, counts)
  }

  /**
   * Release a reserved slot (e.g. if the call failed before hitting the provider).
   */
  release(provider) {
    const today = this._today()
    const thisMonth = this._thisMonth()
    const counts = this._getCounts(provider)

    if (counts.daily?.date === today && counts.daily.used > 0) {
      counts.daily.used--
    }
    if (counts.monthly?.month === thisMonth && counts.monthly.used > 0) {
      counts.monthly.used--
    }
    this._setCounts(provider, counts)
  }

  /**
   * Get current quota status for a provider.
   */
  status(provider) {
    const budget = getBudgetWithOverrides(provider)
    if (!budget) return { provider, budget: null, dailyUsed: 0, monthlyUsed: 0 }

    const today = this._today()
    const thisMonth = this._thisMonth()
    const counts = this._getCounts(provider)

    return {
      provider,
      budget,
      dailyUsed: counts.daily?.date === today ? counts.daily.used : 0,
      monthlyUsed: counts.monthly?.month === thisMonth ? counts.monthly.used : 0,
      lastCallAt: counts.lastCallAt ? new Date(counts.lastCallAt).toISOString() : null,
    }
  }

  /**
   * Get quota status for all configured providers.
   */
  statusAll() {
    return listProviders().map(p => this.status(p))
  }

  /**
   * Record a completed operation in the journal.
   */
  recordComplete(jobId, operationType, provider, remoteId, remoteState, durationMs) {
    this.journal.complete(jobId, operationType, remoteId, remoteState, durationMs)
  }

  /**
   * Record a failed operation in the journal.
   */
  recordFail(jobId, operationType, provider, error, durationMs) {
    this.journal.fail(jobId, operationType, error, durationMs)
  }

  /**
   * Start an operation in the journal.
   */
  recordStart(jobId, operationType, provider, input) {
    return this.journal.start(jobId, operationType, provider, input)
  }

  /**
   * Check if an operation was already completed (crash recovery).
   */
  wasCompleted(jobId, operationType) {
    return this.journal.alreadyCompleted(jobId, operationType)
  }

  // ── Internal helpers ──

  _today() {
    return new Date().toISOString().slice(0, 10)
  }

  _thisMonth() {
    return new Date().toISOString().slice(0, 7)
  }

  _nextDayStart() {
    const d = new Date()
    d.setUTCHours(24, 0, 0, 0)
    return d.getTime()
  }

  _nextMonthStart() {
    const d = new Date()
    d.setUTCMonth(d.getUTCMonth() + 1, 1)
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }

  _getCounts(provider) {
    return this.state.providers?.[provider] || { daily: null, monthly: null, lastCallAt: 0 }
  }

  _setCounts(provider, counts) {
    if (!this.state.providers) this.state.providers = {}
    this.state.providers[provider] = counts
    this._save()
  }

  _load() {
    try {
      if (fs.existsSync(this.statePath)) {
        return JSON.parse(fs.readFileSync(this.statePath, 'utf-8'))
      }
    } catch { /* corrupt state, start fresh */ }
    return { providers: {} }
  }

  _save() {
    fs.mkdirSync(this.stateDir, { recursive: true })
    const tmpPath = `${this.statePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2))
    fs.renameSync(tmpPath, this.statePath)
  }

  cleanup() {
    try {
      if (fs.existsSync(this.statePath)) fs.unlinkSync(this.statePath)
      this.journal.cleanup()
    } catch { /* best effort */ }
  }
}
