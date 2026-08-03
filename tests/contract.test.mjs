import { test } from 'node:test'

test('text dedup suite — no duplicate keyword rendering, contract wiring', async () => {
  await import('../scripts/test-text-dedup.mjs')
})

test('text legibility suite — broadcast minimums, preflight gates', async () => {
  await import('../scripts/test-text-legibility.mjs')
})
