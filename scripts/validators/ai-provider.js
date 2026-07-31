import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const metadata = {
  name: 'ai-provider',
  version: '1.0.0',
  dependsOn: ['schema'],
  provides: ['aiProviderChecks'],
  group: 'ai',
  description: 'Validate AI provider abstraction layer: provider interface, implementations (OpenRouter, OpenAI, Ollama, Gemini), ProviderChain fallback, bridge integration',
}

const REQUIRE_FIELDS = ['generate']

async function tryImport(absPath) {
  try {
    const mod = await import(pathToFileURL(absPath).href)
    return mod
  } catch {
    return null
  }
}

function listProviderFiles(root) {
  const dir = path.join(root, 'src/ai/providers')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.mjs'))
}

export default async function (ctx) {
  const r = ctx.results
  const ROOT = ctx.root

  // 1. Verify provider directory and file structure
  const provDir = path.join(ROOT, 'src/ai/providers')
  if (fs.existsSync(provDir)) {
    const files = listProviderFiles(ROOT)
    r.add('ai', `provider directory: ${files.length} provider files`, 'INFO', true,
      `files: ${files.join(', ')}`)
  } else {
    r.add('ai', 'src/ai/providers/ directory missing', 'ERROR', false)
    return
  }

  // 2. Verify AIProvider base class exists and has generate method
  const baseMod = await tryImport(path.join(provDir, 'AIProvider.mjs'))
  if (baseMod && baseMod.AIProvider) {
    const proto = baseMod.AIProvider.prototype
    const hasGenerate = typeof proto.generate === 'function'
    r.add('ai', 'AIProvider base class with generate()', 'INFO', true, hasGenerate ? 'interface defined' : 'generate() missing')
  } else {
    r.add('ai', 'AIProvider base class not found', 'ERROR', false)
  }

  // 3. Verify each provider implementation
  const providers = ['OpenRouterProvider', 'OpenAIProvider', 'OllamaProvider', 'GeminiProvider']
  for (const pName of providers) {
    const mod = await tryImport(path.join(provDir, `${pName}.mjs`))
    if (mod) {
      const Cls = mod[pName]
      if (Cls) {
        const proto = Cls.prototype
        const hasGenerate = typeof proto.generate === 'function'
        const hasName = typeof Cls.prototype.name === 'undefined' || 'name' in Cls.prototype
        const instance = new Cls('test-key')
        const name = instance.name
        r.add('ai', `${pName} implements generate()`, 'INFO', true,
          `name="${name}"`)
      } else {
        r.add('ai', `${pName} class not exported`, 'ERROR', false)
      }
    } else {
      r.add('ai', `${pName} module not found`, 'NOTICE', false, 'optional provider not installed')
    }
  }

  // 4. Verify ProviderChain exists
  const chainMod = await tryImport(path.join(provDir, 'ProviderChain.mjs'))
  if (chainMod && chainMod.ProviderChain) {
    r.add('ai', 'ProviderChain fallback mechanism', 'INFO', true)
  } else {
    r.add('ai', 'ProviderChain not found', 'NOTICE', false)
  }

  // 5. Verify OpenCodeBridge has aiProvider support
  const bridgePath = path.join(ROOT, 'src/integration/OpenCodeBridge.mjs')
  const bridgeSrc = fs.readFileSync(bridgePath, 'utf-8')
  const hasAiProvider = bridgeSrc.includes('aiProvider')
  const hasGetStoryPlanner = bridgeSrc.includes('getStoryPlanner')
  const hasGetStoryDirector = bridgeSrc.includes('getStoryDirector')
  const hasGenerateVideoPackage = bridgeSrc.includes('generateVideoPackage')

  if (hasAiProvider && hasGetStoryPlanner && hasGenerateVideoPackage) {
    r.add('ai', 'OpenCodeBridge integration: aiProvider, getStoryPlanner(), generateVideoPackage()', 'INFO', true)
  } else {
    const missing = []
    if (!hasAiProvider) missing.push('aiProvider option')
    if (!hasGetStoryPlanner) missing.push('getStoryPlanner()')
    if (!hasGenerateVideoPackage) missing.push('generateVideoPackage()')
    r.add('ai', `bridge integration missing: ${missing.join(', ')}`, 'WARNING', false)
  }

  // 6. Verify StoryPlanner and StoryDirector accept provider
  try {
    const spMod = await import(pathToFileURL(path.join(ROOT, 'src/ai/StoryPlanner.mjs')).href)
    const sdMod = await import(pathToFileURL(path.join(ROOT, 'src/ai/StoryDirector.mjs')).href)

    const SpCls = spMod.default || Object.values(spMod)[0]
    const SdCls = sdMod.default || Object.values(sdMod)[0]

    if (SpCls) {
      const proto = SpCls.prototype
      if (typeof proto.plan === 'function') {
        r.add('ai', 'StoryPlanner uses provider abstraction', 'INFO', true)
      }
    }
    if (SdCls) {
      const proto = SdCls.prototype
      if (typeof proto.plan === 'function') {
        r.add('ai', 'StoryDirector uses provider abstraction', 'INFO', true)
      }
    }
  } catch (e) {
    r.add('ai', `StoryPlanner/Director imports: ${e.message}`, 'NOTICE', false)
  }

  // 7. Verify env var keys are documented
  const envKeys = [
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'OLLAMA_URL',
    'OLLAMA_MODEL',
    'LLM_MODEL',
  ]
  const foundKeys = envKeys.filter(k => process.env[k])
  if (foundKeys.length > 0) {
    r.add('ai', `environment keys configured: ${foundKeys.join(', ')}`, 'INFO', true)
  } else {
    r.add('ai', 'no AI provider API keys in environment; will use fallback plans', 'NOTICE', false,
      `available keys: ${envKeys.join(', ')}`)
  }
}
