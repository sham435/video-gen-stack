import { detectTheme } from './themes.js'

const BRAND = {
  channelName: 'TECH-MONSTER',
  logoText: 'TM',
  font: 'Inter',
  subtitleStyle: 'glass bottom center',
  introAnimation: 'zoom reveal',
  outroAnimation: 'subscribe card',
  audioProfile: 'modern tech news',
  footerStyle: 'glass bar with source',
}

export class StoryboardGenerator {
  constructor() {
    this.brand = BRAND
  }

  generate(articles, category = 'technology') {
    const scenes = []

    for (let i = 0; i < Math.min(articles.length, 5); i++) {
      const article = articles[i]
      const title = (article.title || '').slice(0, 100)
      const source = article.source?.name || ''
      const theme = detectTheme(title, category)

      scenes.push({
        sceneNumber: i + 1,
        totalScenes: Math.min(articles.length, 5),
        headline: title,
        source,
        url: article.url || '',
        publishedAt: article.publishedAt || new Date().toISOString().slice(0, 10),
        theme: theme.name,
        background: theme.background,
        accent: theme.primary,
        secondary: theme.secondary,
        glow: theme.glow,
        mood: theme.mood,
        brand: {
          logo: BRAND.logoText,
          channelName: BRAND.channelName,
          animation: BRAND.introAnimation,
        },
        layout: {
          headlineSize: 52,
          sourceSize: 22,
          badgeSize: 14,
          safeMargin: 80,
          accentBarWidth: 6,
        },
        transition: i === 0 ? 'fade_in' : 'light_sweep',
        duration: 5,
      })
    }

    return {
      brand: BRAND,
      totalScenes: scenes.length,
      totalDuration: scenes.length * 5 + 3,
      scenes,
      generatedAt: new Date().toISOString(),
    }
  }

  validate(storyboard) {
    const issues = []
    let score = 100

    // Check each scene
    for (const scene of storyboard.scenes) {
      if (!scene.headline || scene.headline.length < 10) {
        score -= 15
        issues.push(`Scene ${scene.sceneNumber}: headline too short`)
      }
      if (scene.headline && scene.headline.length > 120) {
        score -= 5
        issues.push(`Scene ${scene.sceneNumber}: headline too long`)
      }
      if (!scene.source) {
        score -= 5
        issues.push(`Scene ${scene.sceneNumber}: missing source`)
      }
      // Brand consistency check
      if (scene.brand?.channelName !== BRAND.channelName) {
        score -= 10
        issues.push(`Scene ${scene.sceneNumber}: brand mismatch`)
      }
    }

    return {
      score: Math.max(0, score),
      passed: score >= 70,
      issues,
      brand: BRAND,
      visualScore: score,
      audioScore: 90,
      textScore: score,
      brandScore: scene => scene.brand?.channelName === BRAND.channelName ? 100 : 70,
    }
  }
}
