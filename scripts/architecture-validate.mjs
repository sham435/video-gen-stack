#!/usr/bin/env node
/**
 * architecture-validate.mjs — REGISTRY CONSISTENCY CHECK (v1, incremental).
 *
 * Doctrine §30 / §57: the codebase, registry, tests and mirrors must evolve together.
 * Detects:
 *   [FAIL] registered module missing from filesystem
 *   [FAIL] declared public API not exported by the module source
 *   [FAIL] declared test file missing
 *   [FAIL] mirror drift (mirrorPath not byte-identical / missing) for manual-byte-sync
 *   [WARN] public export present in source but NOT registered in publicApis
 *          (either register it or keep it internal)
 *   [WARN] process.env.* used in source but absent from .env.example
 *
 * Hard failures exit 1 (guard the commit gate); warnings exit 0.
 *
 * Run: npm run architecture:validate
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = join(ROOT, 'docs/registry/module-registry.json')
const ENV_EXAMPLE = join(ROOT, '.env.example')
const SCAN_DIRS = ['src', 'scripts', 'apps']

const fail = []
const warn = []

// ── 1. registry parses ────────────────────────────────────────────────────
let reg
try {
  reg = JSON.parse(readFileSync(REGISTRY, 'utf-8'))
} catch (e) {
  console.error(`[FAIL] cannot parse ${REGISTRY}: ${e.message}`)
  process.exit(1)
}
if (!Array.isArray(reg.modules)) {
  console.error('[FAIL] registry missing modules[]')
  process.exit(1)
}

const ids = new Set(reg.modules.map((m) => m.id))
if (ids.size !== reg.modules.length) fail.push('duplicate module ids in registry')

const required = ['id', 'name', 'type', 'layer', 'path', 'purpose', 'status']
for (const m of reg.modules) {
  for (const k of required) {
    if (!m[k]) fail.push(`${m.id}: missing required field '${k}'`)
  }
}

// ── 2..5. per-module checks ───────────────────────────────────────────────
// Export collector (hardened v1.1): detects ALL valid ESM export forms —
//   export class/function/const/let/var NAME
//   export default ...
//   export { a, b as c }             (alias = exported name)
//   export { a } from './x'
//   export * from './x'              (recursively merged; cycle-guarded)
//   export * as ns from './x'
// Returns { direct, all }: direct = declared in this file (warn target),
// all = direct + star-inherited (FAIL target for registered publicApis).
const exportCache = new Map()

function collectExports(path, chain = new Set()) {
  if (exportCache.has(path)) return exportCache.get(path)
  const direct = new Set()
  const all = new Set()
  const done = { direct, all }
  if (chain.has(path)) return done // cycle guard (do not cache partial)
  chain.add(path)

  let src = ''
  try { src = readFileSync(path, 'utf-8') } catch { exportCache.set(path, done); return done }

  let m
  // Named declarations
  const declRe = /export\s+(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g
  while ((m = declRe.exec(src))) { direct.add(m[1]); all.add(m[1]) }

  // export default …
  if (/export\s+default\b/.test(src)) { direct.add('default'); all.add('default') }

  // export { a, b as c }  [from './x']
  const namedRe = /export\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/g
  while ((m = namedRe.exec(src))) {
    for (const part of m[1].split(',')) {
      const raw = part.trim()
      if (!raw) continue
      const segs = raw.split(/\s+as\s+/)
      const exportedName = (segs.length > 1 ? segs[1] : segs[0]).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(exportedName)) { direct.add(exportedName); all.add(exportedName) }
    }
  }

  // export * from './x'  |  export * as ns from './x'
  const starRe = /export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"]/g
  while ((m = starRe.exec(src))) {
    if (m[1]) {
      direct.add(m[1]); all.add(m[1])
    } else {
      try {
        const target = resolve(dirname(path), m[2])
        if (existsSync(target)) {
          const sub = collectExports(target, chain)
          for (const n of sub.all) all.add(n) // inherited: counted in `all` only
        } else {
          warn.push(`star-export target missing -> ${m[2]} (from ${path.replace(ROOT + '/', '')})`)
        }
      } catch (e) {
        warn.push(`star-export resolve failed ${m[2]}: ${e.message}`)
      }
    }
  }

  exportCache.set(path, done)
  return done
}

function exportedNames(path) {
  if (!exportCache.has(path)) collectExports(path)
  return exportCache.get(path)
}

for (const m of reg.modules) {
  const path = join(ROOT, m.path)
  if (!existsSync(path)) {
    fail.push(`${m.id}: registered path missing -> ${m.path}`)
    continue
  }
  // publicApis exported?
  for (const api of m.publicApis || []) {
    if (!exportedNames(path).all.has(api)) {
      fail.push(`${m.id}: publicApi '${api}' NOT exported by ${m.path}`)
    }
  }
  // unregistered DIRECT exports (report only; star-inherited names are not
  // the module's own responsibility to register)
  for (const api of exportedNames(path).direct) {
    if (!(m.publicApis || []).includes(api)) {
      warn.push(`${m.id}: public export '${api}' NOT registered in publicApis (register or make internal)`)
    }
  }
  // tests exist
  for (const t of m.tests || []) {
    if (!existsSync(join(ROOT, t))) fail.push(`${m.id}: declared test missing -> ${t}`)
  }
  // mirror byte-identity
  if (m.mirrorPath) {
    if (!existsSync(join(ROOT, m.mirrorPath))) {
      fail.push(`${m.id}: mirrorPath missing -> ${m.mirrorPath}`)
    } else {
      try {
        const a = readFileSync(path)
        const b = readFileSync(join(ROOT, m.mirrorPath))
        if (!a.equals(b)) fail.push(`${m.id}: MIRROR DRIFT -> ${m.path} differs from ${m.mirrorPath}`)
      } catch (e) {
        fail.push(`${m.id}: mirror compare error ${e.message}`)
      }
    }
  }
}

// ── 6. env scan (report only; some runtime-only vars are legit) ───────────
const envExample = existsSync(ENV_EXAMPLE) ? readFileSync(ENV_EXAMPLE, 'utf-8') : ''
const declared = new Set(envExample.match(/^[A-Z][A-Z0-9_]{2,}/gm) || [])
const envRe = /process\.env\.([A-Z][A-Z0-9_]*)/g
const used = new Set()
for (const dir of SCAN_DIRS) {
  const walk = (d) => {
    let entries = []
    try { entries = readdirSync(d) } catch { return }
    for (const entry of entries) {
      const full = join(d, entry)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue
        walk(full)
      } else if (/\.(mjs|js)$/.test(entry)) {
        try {
          const src = readFileSync(full, 'utf-8')
          let m
          while ((m = envRe.exec(src))) used.add(m[1])
        } catch { /* skip */ }
      }
    }
  }
  walk(join(ROOT, dir))
}
for (const v of [...used].sort()) {
  if (!declared.has(v)) warn.push(`env var '${v}' used in source but absent from .env.example (register or document)`)
}

// ── report ────────────────────────────────────────────────────────────────
let n = 0
for (const w of [...new Set(warn)].sort()) { console.log(`  [warn] ${w}`); n++ }
console.log(`[architecture:validate] ${reg.modules.length} modules · ${n} warnings`)
if (fail.length) {
  console.error(`\nARCHITECTURE VALIDATION FAILED (${fail.length}):`)
  for (const f of [...new Set(fail)]) console.error(`  [FAIL] ${f}`)
  process.exit(1)
}
console.log('[architecture:validate] OK — registry, tests, mirrors consistent')