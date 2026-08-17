// M9 PublishingEnhancer — combines algo + hashtags + CTA into full YouTube description
// Usage:
//   const enh = PublishingEnhancer.enhance({ title, category, source, algorithm })
//   enh.fullDescription  — YouTube description with ALGO + hashtags + CTA
//   enh.pinnedComment   — first comment with hook + engagement question
//   enh.hashtags        — array of 15 hashtags
//   enh.algoTag         — "ALGO #N/48 • VISUAL • TONE"

import { HashtagBuilder } from './HashtagBuilder.mjs'
import { TopicCtaBuilder } from './TopicCtaBuilder.mjs'

export class PublishingEnhancer {
  static enhance({ title, category, source, algorithm, article }) {
    const algo = algorithm || article?.algorithm || null
    const topic = HashtagBuilder.topicFromHeadline(title)
    const hashtags = HashtagBuilder.build({
      topic,
      category: category || 'technology',
      pipelineProfile: 'breaking',
      channel: 'NEWS-MONSTER',
      algorithm: algo,
    })
    const ctaBuilder = new TopicCtaBuilder()
    const articleObj = { title, category, algorithm: algo, ...(article || {}) }
    const cta = ctaBuilder.build(articleObj)

    const algoTag = algo
      ? `ALGO #${algo.number}/48 • ${algo.visual?.id || ''} • ${algo.tone?.id || ''}`
      : null

    const fullDescription = [
      title,
      '',
      cta.pinnedComment || '',
      '',
      algoTag ? `${algoTag} • ${category || 'technology'}-${algo.visual?.id || ''}-${algo.tone?.id || ''}` : '',
      '',
      `Nobody expected this move - ${algo?.arc?.replace(/_/g, ' → ') || 'BREAKING'} 😭 → 💪 → ✨`,
      '',
      `Source: ${source || 'NEWS-MONSTER'} | NEWS-MONSTER | sham435·ANCHOR`,
      '',
      hashtags,
    ].filter(Boolean).join('\n')

    const pinnedComment = [
      `${algo?.hook || 'NOBODY_EXPECTED'} - ${title.slice(0, 60)}...`,
      cta.engagement,
      cta.followUp,
      'I read every comment!',
    ].filter(Boolean).join('\n')

    return {
      fullDescription,
      pinnedComment,
      hashtags: hashtags.split(' ').filter(Boolean),
      algoTag,
      cta: cta.cta,
      caption: cta.caption,
      arc: cta.arc,
      algorithm: algo,
    }
  }
}
