// M9 TopicCtaBuilder — NEWS-aware engagement CTA.
//
// The CTA is the on-screen + spoken engagement question on the end card, so it
// must be ABOUT THE ARTICLE, not about an unrelated emotional arc. The old
// builder anchored the CTA to the monkey-empathy arc vocabulary ("Have you
// ever built shelter in the rain?"), which published the same moral question
// on gaming, tech, and AI-safety videos alike. This version derives the
// question from the article's own subject + category.
//
// Backward-compatible: new TopicCtaBuilder().build(article) returns the same
// shape { cta, narration, caption, engagement, followUp, pinnedComment, topic,
// mode, arc }.

import { subjectOf } from '../ai/thumbnail/CuriosityEngine.mjs'

// Category-aware engagement questions. `<subject>` is the article's own
// entity/product term extracted from the title (e.g. "Xbox", "iPad", "M4").
const CATEGORY_QUESTIONS = {
  gaming: (s) => `What do you think of ${s}? Tell us below`,
  ai: (s) => `What does ${s} mean for AI? Tell us below`,
  technology: (s) => `Would you switch to ${s}? Tell us below`,
  finance: (s) => `Is ${s} the turning point? Tell us below`,
  health: (s) => `Would you trust ${s}? Tell us below`,
  space: (s) => `Are you excited about ${s}? Tell us below`,
  science: (s) => `What should ${s} do next? Tell us below`,
  sports: (s) => `Is ${s} the story of the year? Tell us below`,
}

const CATEGORY_CAPTION = {
  gaming: 'YOUR CALL',
  ai: 'YOUR CALL',
  technology: 'YOUR CALL',
  finance: 'YOUR CALL',
  health: 'YOUR CALL',
  space: 'YOUR CALL',
  science: 'YOUR CALL',
  sports: 'YOUR CALL',
}

const FALLBACK_QUESTION = 'What do you think of this story? Tell us below'

export class TopicCtaBuilder {
  build(article) {
    const category = (article?.category || 'default').toLowerCase()
    const title = article?.title || article?.headline || 'NEWS'
    const { brand, topic } = subjectOf(article)
    const subject = brand || topic || title.split(' ').slice(0, 3).join(' ') || 'this story'
    const ask = CATEGORY_QUESTIONS[category] || CATEGORY_QUESTIONS.technology
    const question = ask(subject) || FALLBACK_QUESTION
    const caption = CATEGORY_CAPTION[category] || 'YOUR CALL'
    const arc = article?.algorithm?.arc || article?.arc || null

    return {
      cta: question,
      narration: question,
      caption,
      engagement: question,
      followUp: `FOLLOW NOW for more ${category === 'default' ? 'news' : category} coverage!`,
      pinnedComment: `${title}\n${question}\nI read every comment!`,
      topic: topic || category,
      mode: 'news',
      arc,
    }
  }
}