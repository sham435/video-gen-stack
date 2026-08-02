import { subjectOf } from '../ai/thumbnail/CuriosityEngine.mjs'

// Topic CTA Builder — optimizes the last 2 seconds of every Short.
//
// Real analytics showed the generic outro ("this changes the entire
// industry…") causes end-of-video drop-off. Instead of a generic follow
// plea, the close scene gets a short, topic-specific call to action that
// names the brand and asks for the next step ("Sub for the next S27 leak!").
// A secondary engagement prompt ("Camera or battery — tell us below!")
// converts the retained audience into commenters.
const SUB_CTA = (brand) => `Sub for the next ${brand} leak!`
const FOLLOW_CTA = (brand) => `Follow for more ${brand} news!`
const WATCH_CTA = (brand) => `Part two — ${brand} explained. Sub now!`

const QUESTION_PAIRS = {
  technology: ['the design', 'the specs'],
  ai: ['the price', 'the power'],
  science: ['the mission', 'the data'],
  gaming: ['the graphics', 'the story'],
  finance: ['the gains', 'the risk'],
  space: ['the launch', 'the landing'],
  sports: ['the team', 'the transfer'],
  default: ['this', 'the alternative'],
}

const QUESTION = (a, b) => `Which matters more — ${a} or ${b}? Tell us below!`
const TEAM_QUESTION = (brand) => `Team ${brand}? Drop a 👍 if you're hyped!`

export class TopicCtaBuilder {
  constructor() {
    this.forbidden = ['hidden', 'revealed', 'secret', 'shocking', "you won't believe", 'exposed', 'buried']
  }

  // Outro CTA — short enough to land in the last 2 seconds
  build(article) {
    const { brand, topic } = subjectOf(article, { forbidden: this.forbidden })
    const b = brand || topic || 'NEWS'
    const category = (article?.category || 'default').toLowerCase()
    const topicWord = topic.split(' ')[0].toLowerCase()

    const cta = article?.description?.toLowerCase().includes('leak') || article?.title?.toLowerCase().includes('leak')
      ? SUB_CTA(b)
      : article?.description?.toLowerCase().includes('update') || article?.title?.toLowerCase().includes('update')
        ? FOLLOW_CTA(b)
        : WATCH_CTA(b)

    return {
      cta,
      narration: cta, // close scene narration = the CTA itself
      caption: `SUB FOR NEXT ${b.toUpperCase()}`.slice(0, 24),
      engagement: this._engagementPrompt(article, b, category),
      topic: topicWord,
    }
  }

  // The pinned-comment question — gives the 'stayed' audience a reason to
  // jump into the comments
  _engagementPrompt(article, brand, category) {
    const title = (article?.title || '').toLowerCase()
    const desc = (article?.description || '').toLowerCase()
    const pair = QUESTION_PAIRS[category] || QUESTION_PAIRS.default
    // Prefer two concrete aspects from the article description
    const keywords = (desc + ' ' + title)
      .replace(/[^a-zA-Z ]/g, ' ')
      .split(' ')
      .filter(w => w.length > 4 && !['about','their','there','which','these','those','after','before','being','while','still','massive','camera','battery','leaked','leak','reported','according','including','beginning','month','announced','release','new'].includes(w))
    const [a, b] = [keywords[0], keywords[1]].filter(Boolean)
    if (a && b) return QUESTION(a, b)
    return TEAM_QUESTION(brand)
  }
}
