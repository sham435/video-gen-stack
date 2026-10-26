/**
 * ReviewStore — editorial review ledger (stage 5) of the LocalizationPipeline.
 *
 * Editorial controls guarantee: names, quotations, sensitive claims and
 * uncertain translations must be REVIEWABLE before publication. This store is
 * the source of truth, one file per locale, append-per-item with statuses:
 *
 *   pending  → flagged for a human (name transliteration, number mismatch,
 *              quote carry-over, provider uncertainty)
 *   approved → a human signed off
 *   corrected→ edited text replaces the segment output at publish time
 *
 * Publish gate contract: when TRANSLATION_REVIEW=1 any `pending` item blocks
 * ONLY its own locale — other locales continue untouched. Approved/corrected
 * locales proceed. Corrections are durable (they live in the store and get
 * applied on load, so a resume cannot resurrect un-edited text).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DIR = path.join('data', 'translations', 'reviews')

const fileFor = (lang) => path.join(DIR, `${lang}.json`)

function load(lang) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(lang), 'utf8'))
  } catch {
    return { lang, items: [] }
  }
}

function save(lang, store) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(fileFor(lang), JSON.stringify(store, null, 2))
}

export const segKey = (sourceText) => crypto.createHash('sha256').update(String(sourceText)).digest('hex').slice(0, 24)

/** Flag a translation for review. idempotent per source text.
 *  severity: 'pending' (blocks publish under TRANSLATION_REVIEW) or
 *  'info' (visible for editorial names/uncertainty, never blocks). */
export function flag(lang, { sourceText, translation, issues, segment, severity = 'pending' }) {
  const store = load(lang)
  const id = segKey(sourceText)
  let item = store.items.find((x) => x.id === id)
  if (!item) {
    item = { id, created: new Date().toISOString(), status: severity === 'info' ? 'info' : 'pending', history: [] }
    store.items.push(item)
  } else if (item.status !== 'corrected') {
    // Reputation of a translated item may change between runs; a human
    // correction is final and never demoted.
    item.status = severity === 'info' ? (item.status === 'pending' ? 'pending' : 'info') : 'pending'
  }
  Object.assign(item, {
    sourceText: String(sourceText),
    translation: String(translation ?? ''),
    issues: issues || [],
    segment: segment || null,
    updated: new Date().toISOString(),
  })
  item.history.push({ at: item.updated, action: 'flag', issues: issues || [] })
  save(lang, store)
  return item
}

export function approve(lang, id, { editor = process.env.USER || 'unknown' } = {}) {
  const store = load(lang)
  const item = store.items.find((x) => x.id === id)
  if (!item) throw new Error(`ReviewStore: no item ${id} for ${lang}`)
  item.status = 'approved'
  item.editor = editor
  item.updated = new Date().toISOString()
  item.history.push({ at: item.updated, action: 'approve', editor })
  save(lang, store)
  return item
}

/** Record a human correction; correction is authoritative at apply-time. */
export function correct(lang, id, correctedText, { editor = process.env.USER || 'unknown' } = {}) {
  const store = load(lang)
  const item = store.items.find((x) => x.id === id)
  if (!item) throw new Error(`ReviewStore: no item ${id} for ${lang}`)
  if (!correctedText || !String(correctedText).trim()) throw new Error('ReviewStore: empty correction refused')
  item.status = 'corrected'
  item.correction = String(correctedText)
  item.editor = editor
  item.updated = new Date().toISOString()
  item.history.push({ at: item.updated, action: 'correct', editor })
  save(lang, store)
  return item
}

/** Post-gate view: { pending, blocking } for the publish gate. */
export function status(lang) {
  const store = load(lang)
  const pending = store.items.filter((x) => x.status === 'pending')
  return { pendingCount: pending.length, pendingIds: pending.map((x) => x.id), total: store.items.length }
}

/** Apply corrections/approvals to translated outputs. */
export function applyDecisions(lang, segments) {
  const store = load(lang)
  if (!store.items.length) return { segments, applied: 0 }
  let applied = 0
  const out = segments.map((s) => {
    const item = store.items.find((x) => x.sourceText === s.source)
    if (!item) return s
    if (item.status === 'corrected' && item.correction) {
      applied++
      return { ...s, text: item.correction, reviewed: 'corrected' }
    }
    if (item.status === 'approved') {
      applied++
      return { ...s, reviewed: 'approved' }
    }
    return s
  })
  return { segments: out, applied }
}

export const _internals = { fileFor, load, save, DIR }
