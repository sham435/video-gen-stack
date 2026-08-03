import { test } from 'node:test'

test('emphasis resolver suite — headline/emphasis keyword selection + preflight', async () => {
  await import('../scripts/test-emphasis-resolver.mjs')
})

test('caption conflict suite — grammar-aware caption cleanup', async () => {
  await import('../scripts/test-caption-conflict.mjs')
})
