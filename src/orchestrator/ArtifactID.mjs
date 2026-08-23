import crypto from 'crypto'

/**
 * Deterministic artifact IDs ensure the same production run never generates
 * duplicate outputs. Built from stable inputs (article title, category, stage)
 * so resuming from a checkpoint produces the same ID.
 */

const ALGORITHM = 'sha256'
const HEX_LEN = 16

function stableHash(...parts) {
  const h = crypto.createHash(ALGORITHM)
  for (const p of parts) h.update(String(p ?? ''))
  return h.digest('hex').slice(0, HEX_LEN)
}

export function articleId(article) {
  const key = [
    (article.title || '').trim().toLowerCase(),
    (article.category || '').trim().toLowerCase(),
    (article.publishedAt || '').slice(0, 10),
  ].join('|')
  return `art-${stableHash(key)}`
}

export function stageArtifactId(articleId, stageId) {
  return `${stageId}-${articleId}`
}

export function thumbnailArtifactId(articleId, candidateIndex = 0) {
  return `thumb-${articleId}-${candidateIndex}`
}

export function videoArtifactId(articleId) {
  return `video-${articleId}`
}

export function c2paArtifactId(articleId) {
  return `c2pa-${articleId}`
}

export function buildJobId(article) {
  return `job-${articleId(article)}`
}
