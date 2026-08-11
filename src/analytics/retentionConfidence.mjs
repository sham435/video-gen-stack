// Retention confidence model — LEARN-001.
//
// Data-backed learning needs a confidence signal that grows with observations
// but never reaches certainty: each pattern starts at 0.50 (seed) and rises
// toward 0.97 as n/(n+25) saturates. At 1 observation ≈ 0.52, at 10 ≈ 0.63,
// at 100 ≈ 0.88, asymptote 0.97. This is the single source of truth for the
// model; the learner and any diagnostics import it here instead of
// re-implementing the curve.
export function retentionConfidence(n) {
  const count = Number.isFinite(n) && n > 0 ? n : 0
  return Math.min(0.97, Math.round((0.5 + (0.47 * count / (count + 25))) * 100) / 100)
}

export const RETENTION_CONFIDENCE_MAX = 0.97
export const RETENTION_CONFIDENCE_SEED = 0.5