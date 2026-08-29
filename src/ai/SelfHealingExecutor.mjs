import { ProductionGuardian } from './ProductionGuardian.mjs'

export class SelfHealingExecutor {
  constructor(guardian = null) {
    this.guardian = guardian || new ProductionGuardian()
  }

  async execute(task, context = {}) {
    const maxAttempts = this.guardian.maxRetries
    let attempt = 0
    let lastError = null

    while (attempt < maxAttempts) {
      attempt++
      if (this.guardian.circuitBreaker.open) {
        throw new Error('Production circuit breaker OPEN — pipeline paused. Resolve underlying failures first.')
      }
      try {
        const result = await task()
        this.guardian.recordSuccess()
        return result
      } catch (error) {
        lastError = error
        // A deterministic, non-recoverable infrastructure failure (e.g. ffmpeg
        // binary missing, invalid filtergraph, concat list corrupt) must NOT be
        // retried. Retrying renews the whole task and, for slow stages like the
        // 4K render, burns the entire run budget on a failure that will recur
        // identically. The producer tags such errors with renderRecoverable=false.
        if (error.renderRecoverable === false) {
          console.error(`[SelfHeal] non-recoverable error (renderRecoverable=false) — aborting without retry: ${error.message}`)
          throw new Error(`Non-recoverable render failure (not retried): ${error.message}`)
        }
        this.guardian.recordAttempt()
        const recovery = await this.guardian.recover(error, context)
        console.log(`[SelfHeal] attempt ${attempt}/${maxAttempts} — recovery: ${recovery.diagnosis.action}`)
        if (!recovery.retry) {
          // Circuit breaker open — stop
          throw new Error(`Pipeline failed after circuit breaker opened: ${error.message}`)
        }
        // Apply known fix if available (mark fixed so next run skips the error)
        if (recovery.known && recovery.knownSolution) {
          this.guardian.markFixed(error, recovery.knownSolution)
          console.log(`[SelfHeal] applied known fix: ${recovery.knownSolution}`)
        }
      }
    }
    throw new Error(`Pipeline failed after ${maxAttempts} recovery attempts: ${lastError?.message}`)
  }
}
