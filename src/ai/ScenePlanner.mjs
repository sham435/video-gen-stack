export class ScenePlanner {
  planScenes(article, story) {
    const scenes = story.scenes.map((s, i) => this.buildScene(s, i, article))
    return scenes
  }

  buildScene(sceneDef, index, article) {
    const scene = {
      id: sceneDef.id || index + 1,
      type: sceneDef.type || 'fact',
      purpose: sceneDef.purpose || '',
      start: 0,
      end: 0,
      duration: Math.max(2, Math.min(8, sceneDef.duration || 3)),
      end: 0,
      duration: sceneDef.duration || 3,
      narration: this.cleanNarration(sceneDef.narration),
      caption: sceneDef.caption_focus || (sceneDef.narration || '').split(' ').slice(0, 3).join(' ').toUpperCase(),
      captionFocus: (sceneDef.caption_focus || '').toUpperCase(),
      camera: {
        type: sceneDef.camera || 'push_in',
        speed: this.cameraSpeed(sceneDef.camera),
        shake: sceneDef.camera === 'shake',
      },
      transition: sceneDef.transition || 'cut',
      emotion: sceneDef.emotion || 'neutral',
      music_cue: sceneDef.music_cue || 'none',
      sfx: sceneDef.sfx || 'none',
      visual: {
        type: this.inferVisualType(sceneDef.type),
        prompt: sceneDef.visual_prompt || '',
        motion: sceneDef.camera || 'push_in',
      },
      colors: this.emotionColors(sceneDef.emotion),
    }
    return scene
  }

  cleanNarration(text) {
    if (!text) return ''
    return text
      .replace(/\*\*/g, '')
      .replace(/[«»""]/g, '"')
      .trim()
  }

  cameraSpeed(cameraType) {
    const speeds = {
      push_in: 1.2,
      slow_zoom: 0.8,
      orbit: 0.6,
      pan: 1.0,
      shake: 2.0,
      parallax: 0.5,
      pull_back: 0.7,
    }
    return speeds[cameraType] || 1.0
  }

  inferVisualType(sceneType) {
    const map = {
      hook: 'ai_image',
      fact: 'ai_image',
      reveal: 'ai_image',
      explanation: 'ai_image',
      reaction: 'motion_graphic',
      close: 'logo',
    }
    return map[sceneType] || 'ai_image'
  }

  buildVisualPrompt(originalPrompt, article, analysis) {
    if (originalPrompt) return originalPrompt
    const brand = analysis.brand || article.title?.split(' ')[0] || 'technology'
    return `cinematic news broadcast about ${brand}, professional lighting, dramatic composition, 8k, vertical 9:16, photorealistic`
  }

  emotionColors(emotion) {
    const map = {
      shock: { primary: '#E10600', secondary: '#FFD700', bg: '#050505' },
      awe: { primary: '#00E5FF', secondary: '#FFFFFF', bg: '#050510' },
      curiosity: { primary: '#00E5FF', secondary: '#E10600', bg: '#050505' },
      tension: { primary: '#E10600', secondary: '#FF4444', bg: '#080808' },
      excitement: { primary: '#FFD700', secondary: '#00E5FF', bg: '#050510' },
    }
    return map[emotion] || { primary: '#E10600', secondary: '#00E5FF', bg: '#050505' }
  }

  assignTimestamps(scenes) {
    let cursor = 0
    return scenes.map(s => {
      const scene = { ...s, start: cursor, end: cursor + s.duration }
      cursor = scene.end
      return scene
    })
  }

  buildNarrationScript(scenes) {
    return scenes.map(s => s.narration).filter(Boolean).join('. ')
  }
}
