export class StoryDirector {
  direct(article, category) {
    const title = article.title || ''
    return {
      hook: this.generateHook(title, category),
      context: this.generateContext(article),
      impact: this.generateImpact(article),
      cta: 'Follow NEWS-MONSTER — Breaking News, AI, Science, Sports, Politics & Future Tech.',
    }
  }

  generateHook(title, category) {
    const words = title.split(' ').slice(0, 3).join(' ')
    const hooks = [
      `Why ${words} just changed everything.`,
      `Nobody expected what ${words} did next.`,
      `The secret behind ${words} finally revealed.`,
      `${words} — and it changes everything.`,
    ]
    return hooks[Math.floor(Math.random() * hooks.length)]
  }

  generateContext(article) {
    return (article.description || article.title || '').split('.')[0] + '.'
  }

  generateImpact(article) {
    return `This development affects millions globally. Industry experts are closely watching.`
  }
}
