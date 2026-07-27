import { CategoryClassifier } from './CategoryClassifier.mjs'
import { StoryPlanner } from './StoryPlanner.mjs'
import { SceneMapper } from './SceneMapper.mjs'
import { VisualPromptEngine } from './VisualPromptEngine.mjs'
import { TemplateSelector } from './TemplateSelector.mjs'
import { ScenePlanner } from './ScenePlanner.mjs'

export class OpenCodeAgent {
  constructor() {
    this.classifier = new CategoryClassifier()
    this.storyPlanner = new StoryPlanner()
    this.sceneMapper = new SceneMapper()
    this.visualPrompts = new VisualPromptEngine()
    this.templateSelector = new TemplateSelector()
    this.scenePlanner = new ScenePlanner()
  }

  async direct(article) {
    const start = Date.now()

    const { category, confidence } = this.classifier.classify(article)
    const template = this.templateSelector.select(category)
    const story = await this.storyPlanner.plan(article)
    const { scenes, totalDuration } = this.sceneMapper.map(article, category, story)
    const timed = this.scenePlanner.assignTimestamps(scenes)

    const enriched = timed.map(s => ({
      ...s,
      visual: { ...s.visual, prompt: this.visualPrompts.generate(s, article, category) },
    }))

    return {
      article,
      category,
      confidence,
      template,
      story,
      scenes: enriched,
      totalDuration,
      directives: {
        audio: this.audioDirection(category, story),
        visual: this.visualDirection(category),
        ui: template.style,
      },
      meta: {
        scenes: enriched.length,
        duration: totalDuration,
        processed_ms: Date.now() - start,
      },
    }
  }

  audioDirection(category, story) {
    const music = {
      gaming: 'arcade_cinematic', sports: 'energetic_stadium', politics: 'professional_news',
      science: 'discovery', space: 'epic_cinematic', ai: 'cinematic_tech',
    }
    return {
      music: music[category] || 'cinematic_tech',
      sfx: ['impact', 'whoosh', (story.scenes?.[story.scenes.length-2]?.emotion === 'tension' ? 'riser' : 'reveal')],
      voice: 'professional news anchor',
      emotion: story.scenes?.[0]?.emotion || 'urgent',
    }
  }

  visualDirection(category) {
    const dirs = {
      gaming: { camera: 'fast_zoom', effects: ['glitch', 'scanlines'], lighting: 'neon_purple' },
      sports: { camera: 'action_zoom', effects: ['flash', 'motion_blur'], lighting: 'stadium_gold' },
      politics: { camera: 'stable', effects: ['data_panel'], lighting: 'newsroom_white' },
      science: { camera: 'slow_zoom', effects: ['particles', 'glow'], lighting: 'lab_blue' },
      space: { camera: 'orbit', effects: ['starfield', 'light_sweep'], lighting: 'cosmic' },
    }
    return dirs[category] || { camera: 'push_in', effects: ['glitch'], lighting: 'dramatic' }
  }
}
