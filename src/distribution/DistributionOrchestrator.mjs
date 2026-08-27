/**
 * DistributionOrchestrator — parallel fan-out to YouTube, GitHub Pages, LinkedIn.
 * One artifact → all destinations. Each destination has independent state and retry.
 * One destination failing does NOT invalidate others.
 */

import { DistributionState } from './DistributionState.mjs'

export class DistributionOrchestrator {
  constructor(distributors = {}) {
    this.youtube = distributors.youtube || null
    this.githubPages = distributors.githubPages || null
    this.linkedin = distributors.linkedin || null
  }

  async distribute(artifact, jobContext = {}) {
    const results = {}
    const promises = []

    // YouTube
    if (this.youtube) {
      promises.push(
        this.youtube.distribute(artifact, jobContext)
          .then(r => { results.youtube = r })
          .catch(e => {
            results.youtube = {
              destination: 'youtube',
              state: DistributionState.FAILED,
              errors: [{ error: e.message, classification: 'TRANSIENT' }],
              attempts: 1,
              durationMs: 0,
            }
          })
      )
    }

    // GitHub Pages
    if (this.githubPages) {
      promises.push(
        this.githubPages.distribute(artifact, jobContext)
          .then(r => { results.githubPages = r })
          .catch(e => {
            results.githubPages = {
              destination: 'githubPages',
              state: DistributionState.FAILED,
              errors: [{ error: e.message, classification: 'TRANSIENT' }],
              attempts: 1,
              durationMs: 0,
            }
          })
      )
    }

    // LinkedIn
    if (this.linkedin) {
      promises.push(
        this.linkedin.distribute(artifact, jobContext)
          .then(r => { results.linkedin = r })
          .catch(e => {
            results.linkedin = {
              destination: 'linkedin',
              state: DistributionState.FAILED,
              errors: [{ error: e.message, classification: 'TRANSIENT' }],
              attempts: 1,
              durationMs: 0,
            }
          })
      )
    }

    await Promise.allSettled(promises)

    // Determine overall distribution state
    const states = Object.values(results).map(r => r.state)
    const allSuccess = states.every(s => s === DistributionState.SUCCESS || s === DistributionState.SKIPPED)
    const anyFailed = states.some(s => s === DistributionState.FAILED)
    const anyInProgress = states.some(s => s === DistributionState.IN_PROGRESS)

    let overallState = DistributionState.SUCCESS
    if (anyInProgress) overallState = DistributionState.IN_PROGRESS
    else if (anyFailed && allSuccess) overallState = DistributionState.SUCCESS // all non-failed succeeded
    else if (anyFailed) overallState = DistributionState.FAILED

    // Update artifact destinations
    for (const [dest, r] of Object.entries(results)) {
      if (artifact.destinations[dest]) {
        artifact.destinations[dest].state = r.state
        if (r.videoId) artifact.destinations[dest].videoId = r.videoId
        if (r.url) artifact.destinations[dest].url = r.url
        if (r.postId) artifact.destinations[dest].postId = r.postId
        if (r.thumbnail) artifact.destinations[dest].thumbnail = r.thumbnail
      }
    }

    return {
      state: overallState,
      results,
      durationMs: Math.max(...Object.values(results).map(r => r.durationMs || 0)),
    }
  }
}
