// DuplicateDetector — reject duplicate / near-duplicate images before
// rendering, using three signals:
//
//   1. sha256 equality        → byte-identical asset (exact duplicate)
//   2. dHash distance <= 6    → near-duplicate (same photo resized/re-encoded)
//   3. dHash distance <= 14   → derived content (crop / slight recolor)
//   4. pHash (DCT) distance   → independent confirmation of the above; a low
//                              dHash distance always wins, but pHash is the
//                              tie-breaker that catches recolors/compression
//                              dHash misses.
//
// The pipeline stores every candidate asset (url + sha256 + dHash + pHash) in
// the ImageDatabase; this detector is the gate both for a single candidate batch
// (duplicates *within* one story) and across videos (duplicates *against*
// the global asset history).

import { dHashDistance, pHashDistance } from './ImageMetadata.mjs'

export const DUP_THRESHOLD = {
  exact: 0,        // sha256 identical
  near: 6,         // same photo, any scale/quality
  derived: 14,     // crop or recolor of the same photo
  phash: 12,       // DCT pHash hamming distance — corroborates dHash
}

/**
 * @param {object} a {sha256, dHash, pHash, url}
 * @param {object} b {sha256, dHash, pHash, url}
 * @returns {{dup:boolean, kind:'exact'|'near'|'derived'|null, distance:number}}
 */
export function compareAssets(a, b) {
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) {
    return { dup: true, kind: 'exact', distance: 0 }
  }
  const distance = dHashDistance(a.dHash, b.dHash)
  if (distance <= DUP_THRESHOLD.near) return { dup: true, kind: 'near', distance }
  if (distance <= DUP_THRESHOLD.derived) return { dup: true, kind: 'derived', distance }
  // pHash corroboration: strong DCT agreement on content dHash couldn't see
  // (recolor / heavy re-encode). Not decisive alone, only with near-agreement.
  const pd = pHashDistance(a.pHash, b.pHash)
  if (pd !== Number.MAX_SAFE_INTEGER && pd <= DUP_THRESHOLD.phash && distance <= 20) {
    return { dup: true, kind: 'derived', distance }
  }
  return { dup: false, kind: null, distance }
}

/**
 * Filter a candidate list against a set of "known" assets, returning the
 * candidates that pass. Optional `keep` selector lets the caller prefer
 * higher-quality members of a duplicate cluster.
 * @param {Array<object>} candidates [{sha256, dHash, pHash, url, ...}]
 * @param {Array<object>} known      the reference asset set (e.g. DB history)
 * @returns {Array<object>} deduped candidates in original order
 */
export function rejectDuplicates(candidates, known) {
  const out = []
  for (const c of candidates) {
    const hit = known.find(k => {
      if (k.sha256 && c.sha256 && k.sha256 === c.sha256) return true
      if (dHashDistance(k.dHash, c.dHash) <= DUP_THRESHOLD.near) return true
      const pd = pHashDistance(k.pHash, c.pHash)
      const d = dHashDistance(k.dHash, c.dHash)
      if (pd !== Number.MAX_SAFE_INTEGER && pd <= DUP_THRESHOLD.phash && d <= 20) return true
      return false
    })
    if (!hit) out.push(c)
  }
  return out
}

/**
 * Cluster a list into duplicate groups (a cluster = same content family).
 * Returns [{representative, members[]}] ordered by first appearance.
 */
export function clusterDuplicates(assets) {
  const clusters = []
  for (const a of assets) {
    let home = clusters.find(cl => compareAssets(cl.representative, a).dup)
    if (home) {
      home.members.push(a)
    } else {
      clusters.push({ representative: a, members: [a] })
    }
  }
  return clusters
}
