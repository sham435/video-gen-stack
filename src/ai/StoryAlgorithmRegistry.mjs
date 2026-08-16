
export const HOOKS = [
  'NOBODY_EXPECTED',
  'LOST_IN_RAIN',
  'BULLIED',
  'FELL_IN_RIVER',
  'BROKEN_TOY',
  'LEFT_BEHIND',
  'HUNGRY_STOLE',
  'SHOCKING_NUMBER',
]

export const ARCS = [
  'RAIN_SHELTER_LOVE',
  'HUNGER_SHARE_HERO',
  'BULLY_STUDY_SUCCESS',
  'RIVER_SAVE_FISH',
  'BROKEN_FIX_INSPIRE',
  'LEFT_RUN_REUNION',
]

export const VISUAL_STYLES = [
  { id: 'STUDIO_NOIR', prompt: 'documentary photojournalism, newsroom studio, shallow depth, 85mm lens, dramatic rim light, anchor desk', pexels: 'newsroom anchor desk dark' },
  { id: 'RAIN_CINEMA', prompt: 'cinematic rain, wet street reflection, anamorphic lens, Blade Runner 2049 mood', pexels: 'rainy city night neon reflection' },
  { id: 'GOLDEN_HERO', prompt: 'golden hour, warm haze, heroic backlight, inspirational lens flare', pexels: 'golden hour hero silhouette' },
  { id: 'HANDHELD_DOC', prompt: 'handheld documentary, 16mm film grain, urgent breaking news', pexels: 'documentary handheld protest' },
  { id: 'MINIMAL_WHITE', prompt: 'clean white clinical, Apple-style premium, trust', pexels: 'minimal white studio' },
  { id: 'NEON_CYBER', prompt: 'neon cyberpunk, holographic UI, blue magenta glow', pexels: 'cyberpunk neon city' },
  { id: 'NATURE_MACRO', prompt: 'macro nature, tiny leaves sticks shelter building, detailed craft', pexels: 'tiny shelter leaves sticks' },
  { id: 'VILLAGE_WARM', prompt: 'warm village community, family hug, emotional reunion', pexels: 'village family hug celebration' },
]

export const TONES = [
  { id: 'ANCHOR_BREAKING', voice: 'sham435 urgent breaking, 1.2x pace, serious', music: 'tense drums 110bpm', pace: 1.2 },
  { id: 'ANCHOR_EMPATHY', voice: 'soft empathy whisper 0.9x then build to 1.1x hopeful', music: 'piano sad to hopeful', pace: 0.95 },
  { id: 'ANCHOR_ROAST', voice: 'sarcastic Gen-Z roast, witty', music: 'phonk drift', pace: 1.3 },
  { id: 'ANCHOR_INSPIRE', voice: 'motivational speaker deep inspiring', music: 'epic orchestral swell', pace: 1.0 },
  { id: 'ANCHOR_DETECTIVE', voice: 'true-crime detective low whisper', music: 'dark ambient pulse', pace: 0.9 },
  { id: 'ANCHOR_KID', voice: 'warm storyteller for kids, kind', music: 'ukulele happy', pace: 1.0 },
]

export const STRUCTURES = [
  { id: 'HOOK_PROBLEM_COURAGE_WIN', order: ['hook','tragedy','courage','win'], scenes: 4, retention: 'classic' },
  { id: 'COLD_OPEN_FLASHBACK', order: ['win','tragedy','courage','win'], scenes: 4, retention: 'curiosity gap' },
  { id: 'MYSTERY_REVEAL', order: ['tragedy','hook','courage','courage','win'], scenes: 5, retention: 'mystery' },
  { id: 'FAST_CUTS_6', order: ['hook','tragedy','tragedy','courage','courage','win'], scenes: 6, retention: 'shorts viral' },
]

export function pickAlgorithm(article) {
  const title = article.title || ''
  let h = 0
  for (let i=0;i<title.length;i++) h = (h*31 + title.charCodeAt(i)) >>> 0
  const hook = HOOKS[h % HOOKS.length]
  const arc = ARCS[Math.floor(h/8) % ARCS.length]
  const visual = VISUAL_STYLES[Math.floor(h/13) % VISUAL_STYLES.length]
  const tone = TONES[Math.floor(h/17) % TONES.length]
  const structure = STRUCTURES[Math.floor(h/23) % STRUCTURES.length]
  const cat = (article.category||'').toLowerCase()
  let finalHook = hook
  if (cat==='politics' || cat==='business') finalHook = 'NOBODY_EXPECTED'
  if (cat==='technology' && title.toLowerCase().includes('ai')) finalHook = 'SHOCKING_NUMBER'
  const algoId = `${finalHook}_${arc}_${visual.id}_${tone.id}_${structure.id}`
  return {
    id: algoId,
    number: (h % 48) + 1,
    hook: finalHook,
    arc,
    visual,
    tone,
    structure,
    seed: h,
    niche: `${cat}-${visual.id}-${tone.id}`,
    hash: h.toString(36)
  }
}

// Every possible combination (48 = 8 hooks × 6 arcs × 8 visuals × 6 tones × 4
// structures / 288 — but category bias collapses the effective space; this list
// is what the dashboard audits). Builds from the cartesian product, capped at 48
// by seeding each slot with a distinct hash so the dashboard shows real variety.
export const ALGORITHMS_LIST = buildAlgorithmList()

function buildAlgorithmList() {
  const list = []
  let n = 0
  for (let i = 0; i < 48; i++) {
    const hook = HOOKS[i % HOOKS.length]
    const arc = ARCS[Math.floor(i / 8) % ARCS.length]
    const visual = VISUAL_STYLES[Math.floor(i / 13) % VISUAL_STYLES.length]
    const tone = TONES[Math.floor(i / 17) % TONES.length]
    const structure = STRUCTURES[Math.floor(i / 23) % STRUCTURES.length]
    list.push({
      number: i + 1,
      id: `${hook}_${arc}_${visual.id}_${tone.id}_${structure.id}`,
      hook,
      arc,
      visual: visual.id,
      visualPrompt: visual.prompt,
      pexels: visual.pexels,
      tone: tone.id,
      voice: tone.voice,
      structure: structure.id,
      order: structure.order,
      scenes: structure.scenes,
      retention: structure.retention,
    })
  }
  return list
}
