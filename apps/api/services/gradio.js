const DEFAULT_SPACE = process.env.HF_SPACE_URL || 'https://pyramid-flow-pyramid-flow.hf.space'
const JOIN_TIMEOUT_MS = 600000

async function resolveFnIndex(base) {
  const res = await fetch(`${base}/config`, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Gradio config ${res.status} (space may be sleeping)`)
  const cfg = await res.json()
  const fnIndex = cfg.dependencies.findIndex(d => d.api_name === 'generate_video')
  if (fnIndex < 0) throw new Error('Space has no generate_video endpoint')
  return fnIndex
}

async function pollStatus(base, sessionHash, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/gradio_api/queue/status?session_hash=${sessionHash}`, {
      signal: AbortSignal.timeout(30000),
    })
    for (const line of (await res.text()).trim().split('\n').filter(Boolean)) {
      let m
      try { m = JSON.parse(line) } catch { continue }
      if (m.msg === 'process_completed') {
        const out = m.output?.data?.[0]
        if (typeof out === 'string' && out.startsWith('http')) return out
        if (typeof out === 'string' && out.startsWith('/')) return `${base}/gradio_api/file${out}`
        throw new Error(`Unexpected gradio output: ${String(out).slice(0, 120)}`)
      }
      if (m.msg === 'error') throw new Error(`Gradio job error: ${String(m).slice(0, 200)}`)
    }
    await new Promise(r => setTimeout(r, 8000))
  }
  throw new Error('Pyramid Flow generation timed out (free Space cold start can take several minutes; try again)')
}

export async function generateVideo({ prompt, duration = 5, fps = 24 }) {
  const base = DEFAULT_SPACE
  const fnIndex = await resolveFnIndex(base)
  const sessionHash = 's' + Date.now()

  const join = await fetch(`${base}/gradio_api/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [null, prompt, 5, 7.5, null, fps],
      event_data: null,
      fn_index: fnIndex,
      session_hash: sessionHash,
    }),
  })
  if (!join.ok) throw new Error(`Gradio join ${join.status}: ${(await join.text()).slice(0, 120)}`)

  const url = await pollStatus(base, sessionHash, JOIN_TIMEOUT_MS)
  return {
    provider: 'huggingface',
    model: 'pyramid-flow',
    freeTier: true,
    videos: [{ url, contentType: 'video/mp4', duration }],
    note: 'Pyramid Flow via free HuggingFace Space (zero-a10g)',
  }
}
