// Shared provider-chain factory — ONE source of truth for assembling the AI
// provider chain used by every consumer (StoryDirector, CompositionJudge,
// ProductionPreflight).
//
// Order (primary → fallback):
//   1. OpenRouter   (primary — project standard LLM gateway)
//   2. OpenCode Zen (fallback — opencode.ai's own OpenAI-compatible gateway.
//                    Separate base URL + key; kicks in automatically when
//                    OpenRouter errors out or isn't configured)
//   3. OpenAI       (if key present and not an OpenRouter key)
//   4. Gemini       (if key present)
//   5. Ollama       (local, if reachable)
//
// The ProviderChain tries each provider in order and falls back on failure, so
// story generation keeps working when any single gateway is unavailable.

import { ProviderChain } from './ProviderChain.mjs'
import { ZenProvider } from './ZenProvider.mjs'
import { OpenRouterProvider } from './OpenRouterProvider.mjs'
import { OpenAIProvider } from './OpenAIProvider.mjs'
import { GeminiProvider } from './GeminiProvider.mjs'
import { OllamaProvider } from './OllamaProvider.mjs'

const isOpenRouterKey = (k) => String(k || '').startsWith('sk-or-v1')

export function buildProviders(env = process.env) {
  const providers = []
  const openaiKey = env.OPENAI_API_KEY || ''
  const openrouterKey = env.OPENROUTER_API_KEY || ''

  // OpenRouter first — the standard gateway for this project.
  if (openrouterKey) {
    providers.push(new OpenRouterProvider(openrouterKey))
  } else if (isOpenRouterKey(openaiKey)) {
    // Some setups route an sk-or-v1 key through the OpenAI env slot.
    providers.push(new OpenRouterProvider(openaiKey))
  }

  // OpenCode Zen fallback — separate gateway (own base URL + key), independent
  // of OpenRouter. Read from ZEN_API_KEY or the local opencode config.
  try {
    const zen = new ZenProvider()
    if (zen.apiKey) providers.push(zen)
  } catch { /* skip */ }

  if (openaiKey && !isOpenRouterKey(openaiKey)) {
    providers.push(new OpenAIProvider(openaiKey))
  }
  if (env.GEMINI_API_KEY) {
    try { providers.push(new GeminiProvider(env.GEMINI_API_KEY)) } catch { /* skip */ }
  }
  return providers
}

export async function resolveProviderChain(env = process.env) {
  const providers = buildProviders(env)
  if (!providers.length) return { chain: null, providers: [] }
  return { chain: new ProviderChain(providers), providers }
}

// Human-readable summary for preflight/diagnostic output.
export function providerSummary(providers) {
  if (!providers || !providers.length) return 'none'
  return providers.map(p => p.name).join(' → ')
}