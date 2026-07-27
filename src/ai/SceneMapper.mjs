export class SceneMapper {
  map(article, category, story) {
    const scenes = (story.scenes || []).map((s, i) => ({
      id: i + 1,
      type: s.type || 'fact',
      purpose: s.purpose || '',
      start: 0,
      end: 0,
      duration: s.duration || 3,
      narration: (s.narration || '').replace(/\*\*/g, '').trim(),
      caption: s.caption_focus || '',
      camera: s.camera || 'push_in',
      transition: s.transition || 'cut',
      emotion: s.emotion || 'neutral',
      music_cue: s.music_cue || 'none',
      sfx: s.sfx || 'none',
      visual: { type: 'ai_image', prompt: s.visual_prompt || '', motion: s.camera || 'push_in' },
    }))

    let cursor = 0
    const timed = scenes.map(s => {
      const scene = { ...s, start: cursor, end: cursor + s.duration }
      cursor = scene.end
      return scene
    })

    return { scenes: timed, totalDuration: cursor }
  }

  buildScript(scenes) {
    return scenes.map(s => s.narration).filter(Boolean).join('. ')
  }
}
