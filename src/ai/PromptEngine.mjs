const CATEGORY_IMAGE_STYLES = {
  gaming: 'retro future aesthetic, pixel art, neon purple/cyan, CRT glow, arcade lighting, 8K',
  sports: 'high energy stadium, dramatic lighting, motion blur, crowd atmosphere, vibrant colors, 8K',
  politics: 'professional newsroom, documentary style, muted colors, authoritative, clean lighting, 8K',
  science: 'laboratory environment, clean lighting, blue tones, microscopic detail, photorealistic, 8K',
  space: 'deep space, cosmic lighting, stars, nebula, cinematic, epic scale, volumetric lighting, 8K',
  ai: 'cyberpunk, holographic UI, neon blue/red, data visualization, futuristic technology, 8K',
  cybersecurity: 'dark digital environment, glowing green code, matrix style, cyberpunk, threat visualization, 8K',
  robotics: 'mechanical detailed, industrial lighting, robot hardware, tech lab, metallic textures, 8K',
  biotech: 'glowing cells, DNA helix, medical research, clean white environment, biological detail, 8K',
  quantum: 'quantum particles, abstract visualization, glowing energy, deep blue/purple, theoretical physics, 8K',
  programming: 'code on screen, dark mode IDE, syntax highlighting, developer workspace, clean minimal, 8K',
  technology: 'futuristic technology, neon blue/red, dark cinematic, holographic displays, cyberpunk, 8K',
  lifestyle: 'clean modern aesthetic, warm lighting, soft gradients, lifestyle product shot, premium, 8K',
}

const EMOTION_VOICE = {
  shock: { tone: 'urgent_breathless', pace: 'fast', emphasis: 'high' },
  awe: { tone: 'wonder', pace: 'medium_slow', emphasis: 'medium' },
  curiosity: { tone: 'intriguing_mystery', pace: 'medium', emphasis: 'low' },
  tension: { tone: 'serious_concern', pace: 'medium_fast', emphasis: 'medium' },
  excitement: { tone: 'energetic', pace: 'fast', emphasis: 'high' },
  neutral: { tone: 'professional_calm', pace: 'medium', emphasis: 'low' },
}

const HOOK_FORMATS = {
  mystery: 'cinematic mystery reveal, dark dramatic lighting, glitch effect, split screen, carbon fiber, 8K',
  shock: 'explosive reveal, dramatic impact, particles flying, cinematic lighting, high contrast, 8K',
  question: 'deep focus, intrigue, question mark visual, spotlight effect, dramatic shadows, 8K',
  stat: 'data visualization, big numbers, infographic style, clean modern, glowing data, 8K',
}

const SCENE_COMPOSITION = {
  hook: 'extreme close-up, dramatic angle, shallow depth of field, intense focus',
  fact: 'wide shot, informative, clean composition, data overlay, professional',
  reveal: 'dramatic slow reveal, cinematic lighting, focus pull, atmospheric',
  explanation: 'medium shot, diagram overlay, educational, clear visual hierarchy',
  reaction: 'dynamic composition, emotional impact, motion blur, intense moment',
  close: 'brand reveal, logo, clean background, premium aesthetic, cinematic',
}

const MUSIC_PROFILES = {
  cinematic_tech: { genre: 'electronic cinematic', bpm: '100-110', energy: 'medium-high', instruments: 'synths, pads, percussion' },
  epic_cinematic: { genre: 'orchestral cinematic', bpm: '80-90', energy: 'high', instruments: 'strings, brass, choir' },
  energetic_stadium: { genre: 'electronic rock', bpm: '120-130', energy: 'high', instruments: 'drums, synth bass, guitar' },
  cyber_threat: { genre: 'dark electronic', bpm: '90-100', energy: 'medium', instruments: 'bass drone, glitch, digital fx' },
  discovery: { genre: 'ambient cinematic', bpm: '70-80', energy: 'low-medium', instruments: 'pads, piano, textures' },
  industrial: { genre: 'industrial cinematic', bpm: '100-110', energy: 'medium', instruments: 'metallic percussion, synths' },
  professional_news: { genre: 'news broadcast', bpm: '85-95', energy: 'medium', instruments: 'piano, strings, subtle percussion' },
  tech_beats: { genre: 'electronic', bpm: '110-120', energy: 'medium-high', instruments: 'synth, drum machine, bass' },
  upbeat_modern: { genre: 'pop electronic', bpm: '115-125', energy: 'high', instruments: 'synths, drums, bass' },
  ambient_sci_fi: { genre: 'ambient sci-fi', bpm: '60-70', energy: 'low', instruments: 'pads, drones, ethereal textures' },
  arcade_cinematic: { genre: 'retro cinematic', bpm: '110-120', energy: 'high', instruments: '8-bit synths, orchestral hits' },
}

export class PromptEngine {
  imagePrompt({ category, sceneType, keywords, hookStrategy }) {
    const base = CATEGORY_IMAGE_STYLES[category] || CATEGORY_IMAGE_STYLES.technology
    const comp = SCENE_COMPOSITION[sceneType] || 'cinematic composition'
    const hook = hookStrategy ? HOOK_FORMATS[hookStrategy] : ''
    const kw = (keywords || []).slice(0, 3).join(', ')
    const parts = [kw, comp, hook, base, 'vertical 9:16, ultra realistic, photorealistic'].filter(Boolean)
    return parts.join(', ')
  }

  voicePrompt(scene) {
    const emotion = scene.emotion || 'neutral'
    const base = EMOTION_VOICE[emotion] || EMOTION_VOICE.neutral
    return {
      tone: base.tone,
      pace: base.pace,
      emphasis: base.emphasis,
      style: scene.type === 'hook' ? 'high_impact_intro' : scene.type === 'close' ? 'warm_cta' : 'informative',
    }
  }

  musicPrompt(category, emotionalArc) {
    const profileName = this._getMusicProfile(category)
    const profile = MUSIC_PROFILES[profileName] || MUSIC_PROFILES.cinematic_tech
    const avgEnergy = emotionalArc?.length
      ? emotionalArc.map(e => e === 'shock' || e === 'excitement' ? 'high' : e === 'awe' || e === 'tension' ? 'medium' : 'low')
      : ['medium']
    return {
      genre: profile.genre,
      bpm: profile.bpm,
      energy: avgEnergy.includes('high') ? 'high' : avgEnergy.includes('medium') ? 'medium' : 'low',
      instruments: profile.instruments,
      duration_match: emotionalArc?.length ? `${emotionalArc.length * 4}-${emotionalArc.length * 6}s` : '25-35s',
    }
  }

  captionStyle(scene, category) {
    const intensity = scene.emotion === 'shock' || scene.emotion === 'excitement' ? 'bold' : 'standard'
    return {
      style: intensity,
      maxWords: category === 'cybersecurity' ? 2 : 3,
      glowColor: scene.emotion === 'shock' ? '#E10600' : scene.emotion === 'awe' ? '#00E5FF' : '#FFD700',
      animation: intensity === 'bold' ? 'scale_pop' : 'fade_in',
    }
  }

  _getMusicProfile(category) {
    const map = {
      gaming: 'arcade_cinematic',
      ai: 'cinematic_tech',
      robotics: 'industrial',
      cybersecurity: 'cyber_threat',
      space: 'epic_cinematic',
      sports: 'energetic_stadium',
      politics: 'professional_news',
      science: 'discovery',
      biotech: 'discovery',
      programming: 'tech_beats',
      quantum: 'ambient_sci_fi',
      technology: 'cinematic_tech',
      lifestyle: 'upbeat_modern',
    }
    return map[category] || 'cinematic_tech'
  }

  // NEWS-MONSTER 3-act narrative: Act 1 Tragedy → Act 2 Courage → Act 3 Transformation.
  // Wraps any story (tech, crypto, AI) in the monkey-empathy arc so viewers root
  // for a hero, not a headline. Returns the system prompt for the LLM director.
  anchorStoryPrompt(article, algorithm) {
    const arc = algorithm?.arc?.toLowerCase?.() || ''
    const archetype = ARCHETYPE_BY_ARC[arc] || 'the blocked founder'
    const heroGoal = archetypeGoal(arc)
    return `You are ${ANCHOR_NAME} (${ANCHOR_CHANNEL}), a hard-hitting anchor who tells every story as a 3-act drama.

STORY FORMULA (mandatory):
ACT 1 — PROBLEM/THE TRAGEDY 😭 (0-8s)
Dark, rainy, lonely. Establish the victim + the unfair world.
Visual: rain on glass, grainy newsroom, empty street, worried face, ${algorithm?.visual?.prompt || 'documentary shadows'}.
VO: "It started like any other day for ${archetype}."

ACT 2 — COURAGE/SACRIFICE 💪 (8-18s)
The hero fights back against the machine. Building, sharing, studying, refusing to give up.
Visual: hands working, night desk lamp, small wins, determination.
VO: "But ${archetype} refused to give up."

ACT 3 — TRANSFORMATION ✨ (18-25s)
Family love, celebration, golden hour light. The world notices.
Visual: embrace, golden light, applause, future.
VO: "Now the whole world is watching."

TOTAL: 25 seconds. 8s / 10s / 7s.
HOOK: "Nobody expected this move — ${article.title || 'this'}"
Always end with a moral: "This is the power of never giving up."
Keep VO punchy, short sentences, anchor energy.
Source attribution: mention the source once in Act 3.`
  }

  arcScenes(article, algorithm, scenes) {
    const arc = algorithm?.arc?.toLowerCase?.() || ''
    const archetype = ARCHETYPE_BY_ARC[arc] || 'the blocked founder'
    const order = algorithm?.structure?.order || ['hook', 'tragedy', 'courage', 'win']
    const labels = { hook: 'HOOK', tragedy: 'PROBLEM', courage: 'COURAGE', win: 'TRANSFORMATION' }
    const emojis = { hook: '📣', tragedy: '😭', courage: '💪', win: '✨' }
    const slot = {
      hook: `${article.title || 'THIS'} — NOBODY EXPECTED THIS MOVE`,
      tragedy: `The unfair start: ${archetype} has nothing but a dream`,
      courage: `${archetype} fights back — every small win counts`,
      win: `The world sees it. ${archetype} wins.`,
    }
    const ordered = order.map((key, i) => ({
      id: `scene_${i + 1}`,
      act: labels[key],
      emoji: emojis[key],
      duration: key === 'tragedy' ? 8 : key === 'courage' ? 10 : 7,
      narration: slot[key],
      keywords: [algorithm?.visual?.pexels, key, `${arc} ${key}`].filter(Boolean),
    }))
    if (scenes && scenes.length) {
      return ordered.map((s, i) => ({ ...scenes[i] || {}, ...s }))
    }
    return ordered
  }

  static get HOOK_FORMATS() { return HOOK_FORMATS }
  static get SCENE_COMPOSITION() { return SCENE_COMPOSITION }
  static get CATEGORY_IMAGE_STYLES() { return CATEGORY_IMAGE_STYLES }
}

const ANCHOR_NAME = 'sham435 · ANCHOR'
const ANCHOR_CHANNEL = 'NEWS-MONSTER'

// Story arcs mapped to a human archetype the audience can root for.
const ARCHETYPE_BY_ARC = {
  rain_shelter_love: 'the lonely founder',
  hunger_share_hero: 'the underdog creator',
  bully_study_success: 'the bullied innovator',
  river_save_fish: 'the desperate startup',
  broken_fix_inspire: 'the broken dreamer',
  left_run_reunion: 'the abandoned worker',
}

function archetypeGoal(arc) {
  const goals = {
    rain_shelter_love: 'builds a shelter from the storm, one brick at a time',
    hunger_share_hero: 'refuses to give up and builds something the world needs',
    bully_study_success: 'studies harder than anyone and proves the bullies wrong',
    river_save_fish: 'refuses to drown and swims against the current',
    broken_fix_inspire: 'picks up the broken pieces and fixes what the giants broke',
    left_run_reunion: 'never stops running until they are finally seen',
  }
  return goals[arc] || 'refuses to give up and proves the world wrong'
}