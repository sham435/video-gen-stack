// Cinematic Visual Director — ranks images, prevents near-duplicates, plans camera per scene
export class VisualDirector {
  constructor() {
    this.cameraPlans = {
      hook: { motion: 'push_in', zoom: 0.25, pan: false },
      fact: { motion: 'slow_zoom', zoom: 0.12, pan: false },
      reveal: { motion: 'pan', zoom: 0.08, pan: true },
      explanation: { motion: 'orbit', zoom: 0.05, pan: false },
      retention: { motion: 'shake', zoom: 0.18, pan: false },
      reaction: { motion: 'parallax', zoom: 0.15, pan: true },
      close: { motion: 'pull_back', zoom: 0.1, pan: false },
      brand_close: { motion: 'pull_back', zoom: 0.1, pan: false },
      default: { motion: 'slow_zoom', zoom: 0.1, pan: false },
    }
  }

  // Rank images by heuristic quality + relevance; drop near-duplicates
  rank(images, article) {
    if (!images || images.length === 0) return []
    const titleWords = (article?.title || '').toLowerCase().split(' ').filter(w => w.length > 3)

    const scored = images.map(url => {
      let score = 50
      // resolution: prefer larger (implied by size in URL, best-effort)
      if (/w=1200|w=1920|large2x/.test(url)) score += 15
      // portrait suitability
      if (/portrait|orientation/.test(url)) score += 5
      // relevance: title keyword match in URL slug
      const slug = decodeURIComponent(url).toLowerCase()
      let match = 0
      for (const w of titleWords) {
        if (slug.includes(w)) match++
      }
      score += Math.min(20, match * 7)
      return { url, score }
    }).sort((a, b) => b.score - a.score)

    // Near-duplicate prevention: drop images sharing the same dominant slug token
    const seen = new Set()
    const unique = []
    for (const img of scored) {
      const slug = img.url.split('/').pop().replace(/[^a-z0-9]/g, '').slice(0, 20)
      if (seen.has(slug)) continue
      seen.add(slug)
      unique.push(img)
      if (unique.length >= 3) break
    }
    return unique
  }

  getCameraPlan(sceneType) {
    return this.cameraPlans[sceneType] || this.cameraPlans.default
  }

  // Visual safe zones — text never placed over faces/objects (top/bottom bands reserved)
  safeZones() {
    return {
      headline: { y0: 0.08, y1: 0.20 },   // top band
      center: { y0: 0.22, y1: 0.62 },      // face/object band — no text
      caption: { y0: 0.70, y1: 0.88 },     // bottom caption band
      logo: { y0: 0.90, y1: 0.96 },        // lower right logo
    }
  }
}
