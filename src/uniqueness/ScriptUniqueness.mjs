/**
 * ScriptUniqueness — ensures narration scripts are not reused.
 *
 * At 48/day, deterministic script generation will produce identical
 * scripts for similar articles. This checker uses three levels:
 *
 *   1. Exact hash — sha256 of normalized text → always reject
 *   2. Token fingerprint — Jaccard similarity on word tokens
 *   3. Phrase n-gram overlap — detects near-duplicates with rewording
 *
 * Policy (consistent with CandidateDiversityGate MAX_SIMILARITY=0.82):
 *   - exactDuplicate: exact hash match → always REJECT
 *   - semanticSimilarityMax: 0.82 (Jaccard on token sets)
 *   - phraseOverlapMax: 0.80 (bigram overlap)
 *   - rollingWindow: 50 (matches AssetRegistry default)
 *
 * Integration: wired into GlobalAssetUniquenessGate as scopes:
 *   - script-within-video  ENFORCED (same script text in one video)
 *   - script-across-video  ENFORCED (script reused across videos)
 */

import crypto from 'node:crypto'

// The 16-char sha256 prefix of the empty string. A script identity that
// resolves to this is NOT a legitimate content artifact — it means the script
// was missing/empty at generation time. It must never be reserved or compared
// as though it were a real script identity (prevents false "duplicate" when
// two jobs both failed to produce a script).
export const EMPTY_SCRIPT_HASH = crypto.createHash('sha256').update('').digest('hex').slice(0, 16)

export const SCRIPT_UNIQUENESS_POLICY = Object.freeze({
  exactDuplicate: 0.0,       // exact hash match → reject
  semanticSimilarityMax: 0.55, // weighted overlap threshold (lower than visual 0.82)
  phraseOverlapMax: 0.45,     // bigram overlap threshold
  rollingWindow: 50,
})

// Scene-level similarity bar for within-video narration checks. The 0.55
// policy above is calibrated for FULL script comparison (long text, many
// tokens); at 1-2 sentence scene granularity it false-positives on
// legitimately similar beats ("Apple unveils new chip" vs "Apple faces chip
// shortage" ≈ 0.66). Reject only exact matches and near-repeats ≥ 0.85.
export const NARRATION_SCENE_SIMILARITY_MAX = 0.85

export class ScriptUniqueness {
  constructor(registry, opts = {}) {
    this.registry = registry
    this.policy = { ...SCRIPT_UNIQUENESS_POLICY, ...opts.policy }
  }

  /**
   * Validate a script for uniqueness against all recent scripts.
   *
   * @param {string} narrationText — full narration script text
   * @param {object} context — { jobId, title, excludeJobId }
   * @returns {{ pass: boolean, hash: string, reason: string|null, duplicateOf: object|null, similarity: number|null }}
   */
  validate(narrationText, context = {}) {
    const hash = this._hash(narrationText)

    if (!hash || hash === EMPTY_SCRIPT_HASH) {
      return { pass: false, hash, reason: 'EMPTY_SCRIPT', duplicateOf: null, similarity: null }
    }

    // Level 1: Exact hash match
    const exactDup = this._checkExactDuplicate(hash, context.excludeJobId || context.jobId)
    if (exactDup) {
      return {
        pass: false,
        hash,
        reason: `SCRIPT_DUPLICATE: exact hash=${hash} previously used (${exactDup.usageCount || 0}x)`,
        duplicateOf: exactDup,
        similarity: 1.0,
      }
    }

    // Level 2 + 3: Semantic similarity + phrase overlap against recent scripts
    const recentScripts = this._getRecentScripts(context.excludeJobId || context.jobId)
    const normalized = this._normalize(narrationText)
    const tokens = this._tokenize(normalized)
    const bigrams = this._bigrams(tokens)

    let maxSimilarity = 0
    let closestMatch = null

    for (const entry of recentScripts) {
      if (!entry.text) continue

      const entryNormalized = this._normalize(entry.text)
      const entryTokens = this._tokenize(entryNormalized)
      const entryBigrams = this._bigrams(entryTokens)

      // Weighted overlap on significant tokens (stop words removed)
      const weightedSim = this._weightedOverlap(tokens, entryTokens)
      // Bigram overlap
      const bigramSim = this._bigramOverlap(bigrams, entryBigrams)
      // Combined similarity (max of the two)
      const similarity = Math.max(weightedSim, bigramSim)

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity
        closestMatch = entry
      }
    }

    // Check against policy
    if (maxSimilarity >= this.policy.semanticSimilarityMax) {
      return {
        pass: false,
        hash,
        reason: `SCRIPT_SIMILAR: similarity=${maxSimilarity.toFixed(3)} (threshold=${this.policy.semanticSimilarityMax}) matches "${(closestMatch?.title || closestMatch?.hash || 'unknown').slice(0, 60)}"`,
        duplicateOf: closestMatch,
        similarity: maxSimilarity,
      }
    }

    if (maxSimilarity >= this.policy.phraseOverlapMax) {
      return {
        pass: false,
        hash,
        reason: `SCRIPT_PHRASE_OVERLAP: overlap=${maxSimilarity.toFixed(3)} (threshold=${this.policy.phraseOverlapMax})`,
        duplicateOf: closestMatch,
        similarity: maxSimilarity,
      }
    }

    return { pass: true, hash, reason: null, duplicateOf: null, similarity: maxSimilarity }
  }

  /**
   * Record a validated script as used (call after PUBLISH succeeds).
   * Stores both hash and full text for future similarity checks.
   * Also adds to publishedVideos for rolling window tracking.
   */
  record(narrationText, context = {}) {
    const hash = this._hash(narrationText)
    this.registry.recordScript(hash, {
      ...context,
      text: narrationText,
      normalizedText: this._normalize(narrationText),
    })
    // Also add to publishedVideos for rolling window similarity checks
    if (!this.registry.state.publishedVideos.some(v => v.scriptHash === hash)) {
      this.registry.state.publishedVideos.push({
        videoId: context.videoId || `script-${hash}`,
        jobId: (context.jobId || context.videoId || null),
        scriptHash: hash,
        scriptText: narrationText,
        title: context.title || null,
      })
      this.registry._save()
    }
    return hash
  }

  // ── Statics: scene-level narration checks (no registry required) ──
  //
  // Used by the engine BEFORE TTS (index.mjs pre-voice hard gate) and by
  // StoryDirector's duplicate-detection/regeneration pass. Stateless — the
  // within-video question is "does this scene repeat another scene in the
  // SAME script", which needs no history registry.

  static _norm(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')     // remove punctuation
      .replace(/\s+/g, ' ')         // collapse whitespace
      .trim()
  }

  static _tok(normalizedText) {
    return normalizedText.split(' ').filter(w => w.length > 1 && !STOP_WORDS.has(w))
  }

  static _weighted(tokensA, tokensB) {
    const a = new Map()
    for (const t of tokensA) a.set(t, (a.get(t) || 0) + 1)
    const b = new Map()
    for (const t of tokensB) b.set(t, (b.get(t) || 0) + 1)
    let intersection = 0
    for (const [t, countA] of a) {
      const countB = b.get(t) || 0
      intersection += Math.min(countA, countB)
    }
    const minTotal = Math.min(tokensA.length, tokensB.length)
    return minTotal === 0 ? 0 : intersection / minTotal
  }

  /**
   * Similarity between two narration segments (1-2 sentences each).
   * Exact-normalized == 1.0; otherwise weighted overlap on significant
   * tokens. Uses the scene-level bar (0.85) — NOT the full-script policy
   * (0.55) which false-positives at this granularity.
   */
  static _segmentSimilarity(a, b) {
    const na = ScriptUniqueness._norm(a)
    const nb = ScriptUniqueness._norm(b)
    if (na === nb) return 1.0
    if (!na || !nb) return 0
    const ta = ScriptUniqueness._tok(na)
    const tb = ScriptUniqueness._tok(nb)
    if (!ta.length || !tb.length) return 0
    return ScriptUniqueness._weighted(ta, tb)
  }

  /**
   * Find duplicate narration segments within a list of scene narrations.
   * Pairs with similarity >= threshold (default NARRATION_SCENE_SIMILARITY_MAX).
   *
   * @returns {{ pass: boolean, duplicates: Array<{a:number, b:number, similarity:number}> }}
   */
  static findDuplicateSegments(texts, opts = {}) {
    const threshold = opts.threshold ?? NARRATION_SCENE_SIMILARITY_MAX
    const clean = (texts || []).map(t => (t || '').trim())
    const duplicates = []
    for (let i = 0; i < clean.length; i++) {
      if (!clean[i]) continue
      for (let j = i + 1; j < clean.length; j++) {
        if (!clean[j]) continue
        const similarity = ScriptUniqueness._segmentSimilarity(clean[i], clean[j])
        if (similarity >= threshold) duplicates.push({ a: i, b: j, similarity })
      }
    }
    return { pass: duplicates.length === 0, duplicates }
  }

  /**
   * Hard-gate form of the within-video check (used pre-TTS in the engine).
   * @returns {{ pass: boolean, duplicates: Array<{a,b,similarity}>, reason?: string }}
   */
  static validateWithinVideo(texts, opts = {}) {
    const res = ScriptUniqueness.findDuplicateSegments(texts, opts)
    if (res.pass) return { pass: true, duplicates: [] }
    return {
      pass: false,
      duplicates: res.duplicates,
      reason: `NARRATION_DUPLICATE_WITHIN_VIDEO: scenes ${res.duplicates
        .map(d => `${d.a + 1}~${d.b + 1} (${d.similarity.toFixed(2)})`)
        .join(', ')} repeat narration`,
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────

  _hash(text) {
    return crypto.createHash('sha256').update(text || '').digest('hex').slice(0, 16)
  }

  _normalize(text) {
    return ScriptUniqueness._norm(text)
  }

  _tokenize(normalizedText) {
    return ScriptUniqueness._tok(normalizedText)
  }

  _bigrams(tokens) {
    const bags = new Map()
    for (let i = 0; i < tokens.length - 1; i++) {
      const bg = `${tokens[i]} ${tokens[i + 1]}`
      bags.set(bg, (bags.get(bg) || 0) + 1)
    }
    return bags
  }

  /**
   * Weighted overlap: shared / min(total) — more sensitive than Jaccard
   * for detecting near-duplicates where sentences share key terms.
   */
  _weightedOverlap(tokensA, tokensB) {
    return ScriptUniqueness._weighted(tokensA, tokensB)
  }

  _bigramOverlap(bigramsA, bigramsB) {
    let intersection = 0
    for (const [bg, countA] of bigramsA) {
      const countB = bigramsB.get(bg) || 0
      intersection += Math.min(countA, countB)
    }
    let totalA = 0
    for (const v of bigramsA.values()) totalA += v
    let totalB = 0
    for (const v of bigramsB.values()) totalB += v
    const union = totalA + totalB - intersection
    return union === 0 ? 0 : intersection / union
  }

  _checkExactDuplicate(hash, excludeJobId) {
    // Check committed scripts that are within the rolling window
    const windowHashes = new Set(
      (this.registry.state.publishedVideos || [])
        .slice(-this.policy.rollingWindow)
        .map(v => v.scriptHash)
        .filter(Boolean)
    )

    // Only consider scripts that are in the rolling window
    if (windowHashes.has(hash)) {
      const entry = this.registry.state.scripts[hash]
      // SAME-JOB self-exclusion: idempotent re-render of the SAME video id
      // (composer retry / same-day re-produce) must not trip the hard gate —
      // every OTHER job's history stays hard-blocked. Null-jobId (legacy)
      // entries remain counted: exclusion never relaxes them.
      if (entry && excludeJobId && entry.jobId && entry.jobId === excludeJobId) return null
      if (entry) return entry
    }

    // Check reservations from other jobs (always, regardless of window)
    for (const [jid, res] of Object.entries(this.registry.state.reservations || {})) {
      if (jid === excludeJobId) continue
      if (res.scriptHash === hash) {
        return { hash, jobId: jid, usageCount: 1, reserved: true }
      }
    }

    return null
  }

  _getRecentScripts(excludeJobId) {
    const scripts = []
    const window = this.registry.state.publishedVideos?.slice(-this.policy.rollingWindow) || []

    for (const v of window) {
      // SAME-JOB self-exclusion (mirror of the exact-dup gate): the video's
      // own past entry must not count against its idempotent re-render.
      const vJobId = v.jobId || this.registry.state.scripts[v.scriptHash]?.jobId || null
      if (excludeJobId && vJobId && vJobId === excludeJobId) continue
      // Prefer stored text, fall back to hash-only
      const text = v.scriptText || this.registry.state.scripts[v.scriptHash]?.text || null
      if (v.scriptHash && text) {
        scripts.push({
          hash: v.scriptHash,
          text,
          title: v.title || null,
          videoId: v.videoId || null,
        })
      }
    }

    // Also check reservations that have text stored
    for (const [jid, res] of Object.entries(this.registry.state.reservations || {})) {
      if (jid === excludeJobId) continue
      if (res.scriptHash && res.scriptText) {
        scripts.push({
          hash: res.scriptHash,
          text: res.scriptText,
          title: res.title || null,
          jobId: jid,
          reserved: true,
        })
      }
    }

    return scripts
  }
}

// Common English stop words to exclude from similarity comparison
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'don', 'now', 'that', 'this', 'these', 'those', 'it', 'its', 'i',
  'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
  'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
])
