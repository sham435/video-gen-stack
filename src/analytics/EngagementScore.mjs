// Engagement Score — the interaction quality signal.
//
// Real analytics: the S27 Ultra leak solved click (20% CTR) and watch
// (100% stayed, 47.5% completion) but not interaction — zero likes,
// comments, and shares. This score quantifies that gap so the content
// loop can react:
//
//   engagement = comments/views * 40 + likes/views * 30 + shares/views * 30
//
// Low (< 2.0) → packaging switches from subscribe CTAs to question CTAs,
// because questions create comments.
export function engagementScore({ comments = 0, likes = 0, shares = 0, views = 0 } = {}) {
  if (!views || views <= 0) return null
  return Math.round(
    (comments / views) * 40 +
    (likes / views) * 30 +
    (shares / views) * 30,
    2
  )
}

export function engagementLevel(score) {
  if (score == null) return 'unknown'
  if (score < 2.0) return 'low'
  if (score <= 5.0) return 'medium'
  return 'high'
}
