import { UIStyleSelector } from './UIStyleSelector.mjs'

export class TemplateSelector {
  constructor() {
    this.ui = new UIStyleSelector()
  }

  select(category) {
    const style = this.ui.getStyle(category)
    const template = this.getTemplate(category)
    return { category, template, style, ...style }
  }

  getTemplate(category) {
    const templates = {
      gaming: 'gaming-news.json',
      sports: 'sports-news.json',
      politics: 'politics-news.json',
      science: 'science.json',
      space: 'science.json',
      ai: 'tech-news.json',
      technology: 'tech-news.json',
    }
    return templates[category] || 'tech-news.json'
  }
}
