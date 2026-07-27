export class AudioPlanner {
  plan(category, scenes) {
    return {
      music: this.musicFor(category),
      sfx: this.sfxFor(scenes),
      voice: { style: 'professional news anchor', pacing: 'fast' },
      mix: { voice: 0.7, music: 0.20, sfx: 0.10 },
      timeline: this.buildTimeline(scenes),
    }
  }

  musicFor(category) {
    const map = {
      gaming: { genre: 'arcade_cinematic', bpm: 140, mood: 'energetic' },
      sports: { genre: 'stadium_rock', bpm: 150, mood: 'pumped' },
      politics: { genre: 'news_theme', bpm: 100, mood: 'serious' },
      science: { genre: 'discovery', bpm: 110, mood: 'awe' },
      space: { genre: 'epic_cinematic', bpm: 90, mood: 'epic' },
      ai: { genre: 'tech_cinematic', bpm: 120, mood: 'futuristic' },
    }
    return map[category] || { genre: 'cinematic_tech', bpm: 120, mood: 'urgent' }
  }

  sfxFor(scenes) {
    const sfx = []
    for (const s of scenes) {
      if (s.type === 'hook') sfx.push({ time: s.start, type: 'impact', duration: 0.4 })
      else if (s.type === 'fact') sfx.push({ time: s.start, type: 'whoosh', duration: 0.3 })
      else if (s.type === 'retention') sfx.push({ time: s.start, type: 'riser', duration: 1.5 })
      else if (s.type === 'close') sfx.push({ time: s.start, type: 'reveal', duration: 0.8 })
    }
    return sfx
  }

  buildTimeline(scenes) {
    const events = []
    scenes.forEach(s => {
      events.push({ time: s.start, type: 'scene_start', label: s.type })
    })
    return events
  }
}
