// Error registry — maps error patterns to recovery actions and priorities
export const ERROR_ACTIONS = {
  VIDEO_RENDER_TIMEOUT: { action: 'QUICK_RENDER', priority: 'HIGH', pattern: /timeout|aborted/ },
  IMAGE_PROVIDER_FAIL: { action: 'USE_STOCK_FALLBACK', priority: 'MEDIUM', pattern: /pexels|image.*fail|primary/i },
  VOICE_FAIL: { action: 'CHANGE_VOICE_PROVIDER', priority: 'HIGH', pattern: /voice|tts|elevenlabs|espeak/ },
  AI_MODEL_FAIL: { action: 'OLLAMA_FALLBACK', priority: 'HIGH', pattern: /provider|openrouter|gemini|quota/ },
  YOUTUBE_FAIL: { action: 'RETRY_UPLOAD', priority: 'HIGH', pattern: /youtube|upload|oauth/ },
  MISSING_OBJECT: { action: 'ADD_NULL_GUARD', priority: 'HIGH', pattern: /undefined|primary|cannot read/ },
  FILE_MISSING: { action: 'RECREATE_ASSET', priority: 'MEDIUM', pattern: /ENOENT|no such file|existsSync/ },
  CONTRACT_INVALID: { action: 'REBUILD_CONTRACT', priority: 'HIGH', pattern: /contract invalid/i },
}

export class ErrorRegistry {
  static classify(message) {
    const m = String(message || '')
    for (const [type, cfg] of Object.entries(ERROR_ACTIONS)) {
      if (cfg.pattern.test(m)) return { type, action: cfg.action, priority: cfg.priority }
    }
    return { type: 'UNKNOWN', action: 'RETRY', priority: 'MEDIUM' }
  }
}
