#!/usr/bin/env node
/**
 * review-translations.mjs — editorial CLI for the LocalizationPipeline
 * (stage 5 human-in-the-loop controls).
 *
 * Usage:
 *   node scripts/review-translations.mjs list [lang]            # items + statuses
 *   node scripts/review-translations.mjs show  <lang> <id>      # full content
 *   node scripts/review-translations.mjs approve <lang> <id>    # human sign-off
 *   node scripts/review-translations.mjs correct <lang> <id> "Corrected text"
 *
 * Exit codes: list=0 (pending OK, gate decides), approve/correct: 0 on success.
 */
import fs from 'node:fs'
import path from 'node:path'
import { flag, approve, correct, status, applyDecisions, _internals } from '../src/localize/ReviewStore.mjs'

const [, , cmd, lang, id, rest] = process.argv

function die(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

function loadStore(lang) {
  const file = _internals.fileFor(lang)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { lang, items: [] }
  }
}

function trunc(s, n = 60) {
  return String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || '')
}

switch (cmd) {
  case 'list': {
    const langs = lang ? [lang] : fs.existsSync(_internals.DIR) ? fs.readdirSync(_internals.DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')) : []
    if (!langs.length) {
      console.log('No review stores. Nothing pending.')
      break
    }
    for (const l of langs) {
      const st = status(l)
      console.log(`── ${l} ── pending=${st.pendingCount}/${st.total}`)
      for (const it of loadStore(l).items) {
        console.log(`  [${it.status}] ${it.id}  src: ${trunc(it.sourceText)}`)
        console.log(`          ${l}: ${trunc(it.correction ?? it.translation, 80)}`)
        if (it.issues?.length) console.log(`          issues: ${it.issues.join(', ')}`)
      }
    }
    break
  }
  case 'show': {
    if (!lang || !id) die('show <lang> <id>')
    const it = loadStore(lang).items.find((x) => x.id === id)
    if (!it) die(`no item ${id}`) // exit 1
    console.log(JSON.stringify(it, null, 2))
    break
  }
  case 'approve': {
    if (!lang || !id) die('approve <lang> <id>')
    const st = approve(lang, id)
    console.log(`APPROVED ${id} (${lang}) by ${st.editor}`)
    break
  }
  case 'correct': {
    if (!lang || !id || !rest || !rest.trim()) die('correct <lang> <id> "Corrected text"')
    const st = correct(lang, id, rest)
    console.log(`CORRECTED ${id} (${lang}) by ${st.editor}: ${st.correction.slice(0, 50)}…`)
    break
  }
  default:
    die('usage: list|show|approve|correct …')
}
