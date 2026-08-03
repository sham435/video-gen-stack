import { test } from 'node:test'

test('layout engine suite — TextLayoutEngine V1 + safe zones', async () => {
  await import('../scripts/test-layout-engine.mjs')
})

test('layout hardening suite — metrics, multilingual scripts, policy, snapshots', async () => {
  await import('../scripts/test-layout-hardening.mjs')
})

test('responsive text suite — fit scaling never clips', async () => {
  await import('../scripts/test-responsive-text.mjs')
})
