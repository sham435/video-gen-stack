export class VisualPromptEngine {
  generate(scene, article, category) {
    const base = this.basePrompt(category)
    const topic = (article.title || '').slice(0, 60)
    const narrative = scene.narration || scene.caption || topic
    return `${narrative}, ${base}, vertical 9:16`
  }

  basePrompt(category) {
    const prompts = {
      gaming: 'retro future aesthetic, pixel art style, neon purple and cyan, CRT screen glow, arcade lighting, 8k',
      sports: 'high energy stadium, dramatic sports lighting, motion blur, crowd atmosphere, vibrant colors, professional camera, 8k',
      politics: 'professional newsroom, serious documentary style, muted colors, authoritative, clean lighting, 8k',
      science: 'laboratory environment, clean lighting, blue tones, microscopic detail, research facility, photorealistic, 8k',
      space: 'deep space, cosmic lighting, stars, nebula, cinematic, epic scale, volumetric lighting, 8k',
      ai: 'cyberpunk, holographic UI, neon blue and red, data visualization, futuristic technology, 8k',
      cybersecurity: 'dark digital environment, glowing green code, matrix style, cyberpunk, threat visualization, 8k',
      robotics: 'mechanical detailed, industrial lighting, robot hardware, tech lab, metallic textures, 8k',
      biotech: 'biological微观, glowing cells, DNA helix, medical research, clean white environment, 8k',
      quantum: 'quantum particles, abstract visualization, glowing energy, deep blue purple, theoretical physics, 8k',
      programming: 'code on screen, dark mode IDE, syntax highlighting, developer workspace, clean minimal, 8k',
    }
    return prompts[category] || 'cinematic news broadcast, dramatic lighting, professional, 8k'
  }
}
