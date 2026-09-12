// Live model catalog — queries a provider's model list, filters free models,
// excludes dead models, and ranks candidates using the project's selection
// policy. Supports both live (network) and static (registry) pools with
// short-lived TTL caching and an optional persisted dead-model health file
// (TTL-based — NOT a permanent blacklist).

import fs from 'node:fs'
import path from 'node:path'
import { filterFossModels, isFossModelId } from './fossModels.mjs'

const DEFAULT_CATALOG_TTL_MS = 15 * 60_000   // 15 min
const DEFAULT_DEAD_TTL_MS    = 15 * 60_000   // 15 min

// ── helpers ──────────────────────────────────────────────────────────────────

function isFreeModel(entry) {
  if (typeof entry === 'string') return entry.endsWith(':free') || entry.includes('-free')
  const id      = String(entry?.id ?? '')
  const prompt  = entry?.pricing?.prompt
  return id.endsWith(':free')
    || id.includes('-free')
    || prompt === '0'
    || prompt === 0
    || Number(prompt) === 0
}

function dedupeOrdered(arr) {
  const seen = new Set()
  return arr.filter(x => !seen.has(x) && seen.add(x))
}

// ── class ────────────────────────────────────────────────────────────────────

export class LiveModelCatalog {
  /**
   * @param {object} opts
   * @param {string}           opts.name          Catalog / provider label
   * @param {string|null}      opts.catalogUrl    Live /models endpoint (null → static-only)
   * @param {string[]|null}    opts.registry      Static model id list (Zen ZEN_MODELS keys, etc.)
   * @param {string[]|null}    opts.bootstrap     Fallback when live fetch fails
   * @param {string[]}         opts.preferredFirst Models to rank first (project defaults)
   * @param {string|null}      opts.apiKey        API key for auth header on catalog fetch
   * @param {number}           opts.ttlMs         Catalog cache TTL
   * @param {number}           opts.deadTtlMs     Dead-model record TTL
   * @param {boolean}          opts.mergeRegistry When live fetch succeeds, union the curated
   *                                              registry into the pool (registry first, then
   *                                              live additions). Prevents losing known-free
   *                                              models whose ids carry no free marker and
   *                                              still surfaces newly added free models.
   * @param {boolean}          opts.preferFree    Tiered selection: FREE models first
   *                                              (pricing == 0 or :free — any license), then
   *                                              FOSS (open-weights) models as fallback when
   *                                              the free tier is empty/exhausted. Paid
   *                                              proprietary models are never selected.
   *                                              Default false = plain pool order.
   * @param {string[]}         opts.knownFree     Model ids that ARE free but carry no free
   *                                              marker / pricing metadata (e.g. OpenCode
   *                                              Zen's big-pickle). Treated as free-tier
   *                                              members, and kept when registryFossOnly is
   *                                              set.
   * @param {boolean}          opts.registryFossOnly Curated registry entries are restricted to
   *                                              FOSS (open-weights) models (plus knownFree
   *                                              entries). Used to keep proprietary registry
   *                                              entries (e.g. Zen's minimax / mimo /
   *                                              north-mini-code) out of the candidate pool.
   * @param {string|null}      opts.healthFilePath Path for persisted health state (null → none)
   * @param {Function}         opts.fetchImpl     fetch implementation (tests can stub)
   * @param {Function}         opts.now           () => timestamp (testable clock)
   * @param {Function}         opts.fsWrite       Optional fs override for persistence (tests)
   * @param {Function}         opts.fsRead        Optional fs override for persistence (tests)
   */
  constructor(opts = {}) {
    this.name           = opts.name || 'catalog'
    this.catalogUrl     = opts.catalogUrl ?? null
    // Markerless but genuinely FREE ids (OpenCode Zen's big-pickle, etc.)
    this.knownFree      = new Set(Array.isArray(opts.knownFree) ? opts.knownFree : [])
    // Curated registry entries can be restricted to FOSS-licensed models so
    // proprietary curated entries never enter the candidate pool. knownFree
    // entries survive the gate (free access is the primary policy).
    this.registry       = (Array.isArray(opts.registry) ? opts.registry.slice() : [])
    if (opts.registryFossOnly === true) {
      this.registry = this.registry.filter(id => isFossModelId(id) || this.knownFree.has(id))
    }
    this.bootstrap      = Array.isArray(opts.bootstrap)   ? opts.bootstrap.slice()
                         : this.registry.length            ? this.registry.slice()
                         : []
    this.preferredFirst = Array.isArray(opts.preferredFirst) ? opts.preferredFirst.filter(Boolean) : []
    this.apiKey         = opts.apiKey || null
    this.ttlMs          = opts.ttlMs  ?? DEFAULT_CATALOG_TTL_MS
    this.deadTtlMs      = opts.deadTtlMs ?? DEFAULT_DEAD_TTL_MS
    this.mergeRegistry  = opts.mergeRegistry === true
    this.preferFree     = opts.preferFree === true
    this.healthFilePath = opts.healthFilePath ?? null
    this.fetchImpl      = opts.fetchImpl || ((...a) => fetch(...a))
    this._now           = opts.now || (() => Date.now())
    this._fsWrite       = opts.fsWrite || null
    this._fsRead        = opts.fsRead  || null

    // mutable state
    this._dead   = new Map()   // modelId → { expiresAt, reason, status, deadAt }
    this._cache  = null        // { fetchedAt, models: string[] }
    this._loadPromise = null

    // seed from persisted file (best-effort, non-fatal)
    if (this.healthFilePath) this._load()
  }

  // ── free classification ───────────────────────────────────────────────────

  isFree(id) {
    return isFreeModel(id) || this.knownFree.has(String(id))
  }

  // ── catalog refresh ──────────────────────────────────────────────────────

  async refresh(force = false) {
    const now = this._now()

    if (!force && this._cache && (now - this._cache.fetchedAt) < this.ttlMs) {
      return this._cache.models
    }

    // static-only catalog (Zen registry, etc.) — no network fetch needed
    if (!this.catalogUrl) {
      this._cache = { fetchedAt: now, models: this.registry.slice() }
      return this._cache.models
    }

    // coalesce concurrent refreshes
    if (!this._loadPromise) {
      this._loadPromise = this._fetchLive()
        .catch(() => this._fallbackPool())
        .then(models => {
          this._cache = { fetchedAt: this._now(), models }
          this._persist()
          return models
        })
        .finally(() => { this._loadPromise = null })
    }

    return this._loadPromise
  }

  async _fetchLive() {
    const res = await this.fetchImpl(this.catalogUrl, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`catalog fetch ${res.status}`)
    const json = await res.json()
    const data = Array.isArray(json?.data)  ? json.data
               : Array.isArray(json?.models) ? json.models
               : []
    // Keep FREE (pricing == 0 or :free — any license) AND FOSS models. Paid
    // FOSS models must survive to the pool so they remain reachable when the
    // entire free tier is exhausted/failing (the preferFree fallback tier).
    const keep = data
      .filter(m => {
        const id = typeof m === 'string' ? m : m?.id
        return Boolean(id) && (isFreeModel(m) || this.knownFree.has(String(id)) || isFossModelId(id))
      })
      .map(m => typeof m === 'string' ? m : m.id)
      .filter(Boolean)
    if (!keep.length) return this._fallbackPool()
    // mergeRegistry: union curated registry (first) with live discoveries.
    // Keeps known-free models whose ids carry no free marker AND surfaces
    // newly added free/FOSS models without manual updates.
    if (this.mergeRegistry && this.registry.length) {
      return dedupeOrdered([...this.registry, ...keep])
    }
    return keep
  }

  _fallbackPool() {
    return this.registry.length ? this.registry.slice() : this.bootstrap.slice()
  }

  // ── model selection ──────────────────────────────────────────────────────

  async availableModels(extraExclude = new Set()) {
    const pool = await this.refresh()
    this._prune()
    const deadSet = new Set()
    for (const [model, rec] of this._dead) {
      if (rec.expiresAt > this._now()) deadSet.add(model)
    }
    const exclude = new Set([...deadSet, ...extraExclude])
    const eligible = pool.filter(id => !exclude.has(id))
    // Tiered selection (preferFree): FREE models first — pricing == 0 or
    // :free, ANY license (proprietary free tiers included — "free & healthy
    // must be used"). Only when no free model remains do we fall back to FOSS
    // (open-weights) models. Paid proprietary models are never selected.
    let orderedPool = eligible
    if (this.preferFree) {
      const freeTier = eligible.filter(id => this.isFree(id))
      const fossTier = eligible.filter(id => !this.isFree(id) && isFossModelId(id))
      orderedPool = dedupeOrdered([...freeTier, ...fossTier])
    }
    // rank: preferredFirst (in preferred order) + rest (tier/API order);
    // preferred picks are only honored when actually present in the pool.
    const preferred = this.preferredFirst.filter(id => orderedPool.includes(id))
    const rest = orderedPool.filter(id => !preferred.includes(id))
    return dedupeOrdered([...preferred, ...rest])
  }

  async selectNext(extraExclude = new Set()) {
    const list = await this.availableModels(extraExclude)
    return list[0] ?? null
  }

  // ── dead-model tracking ──────────────────────────────────────────────────

  markDead(model, reason = 'UNKNOWN', status = null) {
    const now = this._now()
    this._dead.set(model, {
      deadAt:    now,
      expiresAt: now + this.deadTtlMs,
      reason,
      status,
    })
    this._persist()
  }

  isDead(model, now = this._now()) {
    this._prune(now)
    const rec = this._dead.get(model)
    return rec ? rec.expiresAt > now : false
  }

  getDead() {
    this._prune()
    return new Map([...this._dead])
  }

  recover(model) {
    this._dead.delete(model)
    this._persist()
  }

  _prune(now = this._now()) {
    for (const [model, rec] of this._dead) {
      if (rec.expiresAt <= now) this._dead.delete(model)
    }
  }

  // ── persistence (TTL-based, data/model-health.json) ──────────────────────

  _load() {
    try {
      const raw = this._fsRead
        ? this._fsRead(this.healthFilePath)
        : fs.readFileSync(this.healthFilePath, 'utf-8')
      const data = JSON.parse(raw)
      const now  = this._now()

      // dead records
      if (data.dead && typeof data.dead === 'object') {
        for (const [model, rec] of Object.entries(data.dead)) {
          if (rec?.expiresAt && rec.expiresAt > now) {
            this._dead.set(model, rec)
          }
        }
      }

      // cached catalog (only reuse if fresh)
      if (data.catalog?.fetchedAt && data.catalog.fetchedAt > now - this.ttlMs && Array.isArray(data.catalog.models)) {
        this._cache = { fetchedAt: data.catalog.fetchedAt, models: data.catalog.models }
      }
    } catch { /* file missing / corrupt → start fresh */ }
  }

  _persist() {
    if (!this.healthFilePath) return
    try {
      const dead = {}
      for (const [model, rec] of this._dead) dead[model] = rec
      const payload = {
        version: 1,
        catalog: this._cache ? { name: this.name, fetchedAt: this._cache.fetchedAt, models: this._cache.models } : null,
        dead,
      }
      const dir = path.dirname(this.healthFilePath)
      if (this._fsWrite) {
        this._fsWrite(this.healthFilePath, JSON.stringify(payload, null, 2))
      } else {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(this.healthFilePath, JSON.stringify(payload, null, 2))
      }
    } catch { /* best-effort — persist failure never blocks provider */ }
  }
}
