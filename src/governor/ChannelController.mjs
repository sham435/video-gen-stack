/**
 * ChannelController — shared YouTube channel coordination.
 *
 * Implements the RESERVE → PUBLISH → COMMIT protocol.
 * Both news-monster and music-shorts call this before uploading.
 *
 * Uses GitHub atomicUpdate for optimistic concurrency — no distributed
 * locks, no external services. GitHub's SHA check IS the lock.
 */

import { randomUUID } from 'node:crypto';
import { GitHubClient } from './GitHubClient.mjs';

const LEASE_TTL_MS = 15 * 60 * 1000; // 15 minutes — safety net for crashed runners
const STATE_FILE = 'state/channel-state.json';

function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }
function ttl(expiryMs) {
  return new Date(Date.now() + expiryMs).toISOString();
}

export class ChannelController {
  constructor(options = {}) {
    this.github = options.github || new GitHubClient(options);
    this.leaseTtlMs = options.leaseTtlMs || LEASE_TTL_MS;
  }

  /**
   * Check if a pipeline can reserve a slot.
   * Returns { allowed, remaining, reason?, quota? }
   */
  async canReserve(pipeline) {
    const { content } = await this.github.read(STATE_FILE);
    this.maybeRollDay(content);

    const q = content.quota[pipeline];
    if (!q) return { allowed: false, remaining: 0, reason: `Unknown pipeline: ${pipeline}` };

    // Check if another pipeline holds an active lease
    if (content.lease && content.lease.status === 'ACTIVE') {
      if (this.isLeaseExpired(content.lease)) {
        // Expired lease — will be cleaned on next atomicUpdate
      } else if (content.lease.pipeline !== pipeline) {
        return {
          allowed: false,
          remaining: q.limit - q.used,
          reason: `Channel locked by ${content.lease.pipeline} (job ${content.lease.jobId})`,
        };
      }
    }

    const remaining = q.limit - q.used;
    return {
      allowed: remaining > 0,
      remaining,
      used: q.used,
      limit: q.limit,
      reason: remaining <= 0 ? `${pipeline} daily limit exhausted (${q.used}/${q.limit})` : undefined,
    };
  }

  /**
   * Reserve a channel slot for a pipeline.
   * Returns { reserved, jobId, publicationId } or { reserved: false, reason }.
   *
   * Uses atomicUpdate — retries on 409 (GitHub concurrency conflict).
   */
  async reserve(pipeline, jobId, metadata = {}) {
    const publicationId = `pub_${randomUUID().slice(0, 12)}`;

    const result = await this.github.atomicUpdate(
      STATE_FILE,
      (state) => {
        this.maybeRollDay(state);
        const q = state.quota[pipeline];
        if (!q) throw new Error(`Unknown pipeline: ${pipeline}`);

        // Check active lease (not expired)
        if (state.lease && state.lease.status === 'ACTIVE' && !this.isLeaseExpired(state.lease)) {
          if (state.lease.pipeline !== pipeline) {
            throw new LeaseConflictError(state.lease.pipeline, state.lease.jobId);
          }
          // Same pipeline re-reserving (shouldn't happen, but allow)
        }

        // Check quota
        if (q.used >= q.limit) {
          throw new QuotaExhaustedError(pipeline, q.used, q.limit);
        }

        // Reserve: increment used + create lease
        q.used += 1;
        state.quota.used = Object.values(state.quota)
          .filter(v => v && typeof v === 'object' && 'used' in v)
          .reduce((sum, v) => sum + v.used, 0);
        state.quota.remaining = state.quota.dailyLimit - state.quota.used;

        state.lease = {
          jobId,
          pipeline,
          publicationId,
          acquiredAt: now(),
          expiresAt: ttl(this.leaseTtlMs),
          status: 'ACTIVE',
          metadata,
        };

        return state;
      },
      `reserve: ${pipeline} slot for ${jobId} (${publicationId})`,
    );

    return {
      reserved: true,
      jobId,
      publicationId,
      attempts: result.attempts,
    };
  }

  /**
   * Commit a successful publication.
   * Moves lease to COMMITTED and appends to publication ledger.
   */
  async commit(pipeline, jobId, publicationId, publication) {
    return this.github.atomicUpdate(
      STATE_FILE,
      (state) => {
        // Validate lease
        if (!state.lease || state.lease.jobId !== jobId) {
          throw new Error(`No active lease for job ${jobId}`);
        }
        if (state.lease.status !== 'ACTIVE') {
          throw new Error(`Lease for ${jobId} is ${state.lease.status}, not ACTIVE`);
        }

        // Commit lease
        state.lease.status = 'COMMITTED';

        // Append publication record
        state.publications.push({
          publicationId,
          jobId,
          pipeline,
          channelId: state.channelId,
          youtubeVideoId: publication.youtubeVideoId,
          title: publication.title,
          artifactId: publication.artifactId,
          publishedAt: now(),
          quotaClass: pipeline,
        });

        return state;
      },
      `commit: ${pipeline} publication ${publicationId} (${publication.youtubeVideoId})`,
    );
  }

  /**
   * Release a reservation (upload failed, pipeline crashed, etc).
   * Decrements used count and marks lease as RELEASED.
   */
  async release(pipeline, jobId) {
    return this.github.atomicUpdate(
      STATE_FILE,
      (state) => {
        if (!state.lease || state.lease.jobId !== jobId) {
          return state; // Already released or expired — no-op
        }

        const q = state.quota[pipeline];
        if (q) q.used = Math.max(0, q.used - 1);

        state.quota.used = Object.values(state.quota)
          .filter(v => v && typeof v === 'object' && 'used' in v)
          .reduce((sum, v) => sum + v.used, 0);
        state.quota.remaining = state.quota.dailyLimit - state.quota.used;

        state.lease.status = 'RELEASED';
        return state;
      },
      `release: ${pipeline} slot for ${jobId}`,
    );
  }

  /**
   * Clean up expired leases (called automatically on reads).
   * Returns count of expired leases reclaimed.
   */
  async cleanExpiredLeases() {
    let reclaimed = 0;
    try {
      await this.github.atomicUpdate(
        STATE_FILE,
        (state) => {
          if (state.lease && state.lease.status === 'ACTIVE' && this.isLeaseExpired(state.lease)) {
            const q = state.quota[state.lease.pipeline];
            if (q) q.used = Math.max(0, q.used - 1);
            state.quota.used = Object.values(state.quota)
              .filter(v => v && typeof v === 'object' && 'used' in v)
              .reduce((sum, v) => sum + v.used, 0);
            state.quota.remaining = state.quota.dailyLimit - state.quota.used;
            state.lease.status = 'EXPIRED';
            reclaimed = 1;
          }
          return state;
        },
        'cleanup: expire stale leases',
      );
    } catch { /* best-effort */ }
    return reclaimed;
  }

  /**
   * Get full channel status for logging/display.
   */
  async getStatus() {
    const { content } = await this.github.read(STATE_FILE);
    this.maybeRollDay(content);
    return {
      day: content.day,
      allocations: content.allocations,
      quota: content.quota,
      lease: content.lease,
      recentPublications: content.publications.slice(-5),
    };
  }

  /**
   * Roll day if date has changed — resets all counters.
   */
  maybeRollDay(state) {
    const t = today();
    if (state.day !== t) {
      state.day = t;
      for (const [key, val] of Object.entries(state.allocations || {})) {
        if (state.quota[key]) {
          state.quota[key].used = 0;
          state.quota[key].limit = val;
        }
      }
      state.quota.used = 0;
      state.quota.remaining = state.quota.dailyLimit;
      state.lease = null;
      state.publications = [];
    }
  }

  isLeaseExpired(lease) {
    return new Date(lease.expiresAt) < new Date();
  }
}

export class LeaseConflictError extends Error {
  constructor(holderPipeline, holderJobId) {
    super(`Channel locked by ${holderPipeline} (job ${holderJobId})`);
    this.name = 'LeaseConflictError';
    this.holderPipeline = holderPipeline;
    this.holderJobId = holderJobId;
  }
}

export class QuotaExhaustedError extends Error {
  constructor(pipeline, used, limit) {
    super(`${pipeline} quota exhausted: ${used}/${limit}`);
    this.name = 'QuotaExhaustedError';
    this.pipeline = pipeline;
    this.used = used;
    this.limit = limit;
  }
}
