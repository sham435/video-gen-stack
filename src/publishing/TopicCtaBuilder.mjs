// M9 TopicCtaBuilder — 6 arc-specific CTAs with viral triggers
// Each of the 6 monkey-empathy arcs gets a unique CTA designed to hit million audience.
// Backward-compatible: new TopicCtaBuilder().build(article) returns { cta, narration, caption, engagement, topic, mode }

const ARC_CTAS = {
  RAIN_SHELTER_LOVE: {
    primary: (title) => `Have you ever built shelter in the rain? Comment your story`,
    pinned: (title) => `NOBODY_EXPECTED - ${title.slice(0, 50)}...\nHave you ever built shelter in the rain? Comment your story\nI read every comment!`,
    caption: 'YOUR STORY',
    followUp: 'FOLLOW NOW for more family love stories!',
    engagement: 'Have you ever built shelter in the rain? Comment your story',
  },
  HUNGER_SHARE_HERO: {
    primary: (title) => `Have you ever shared when you had nothing? Tell us below`,
    pinned: (title) => `NOBODY_EXPECTED - ${title.slice(0, 50)}...\nHave you ever shared when you had nothing? Tell us below\nI read every comment!`,
    caption: 'YOUR KINDNESS',
    followUp: 'FOLLOW NOW for more hero stories!',
    engagement: 'Have you ever shared when you had nothing? Tell us below',
  },
  BULLY_STUDY_SUCCESS: {
    primary: (title) => `Were you ever counted out? Prove them wrong in the comments`,
    pinned: (title) => `NOBODY_EXPECTED - ${title.slice(0, 50)}...\nWere you ever counted out? Prove them wrong in the comments\nI read every comment!`,
    caption: 'YOUR COMEBACK',
    followUp: 'FOLLOW NOW for more comeback stories!',
    engagement: 'Were you ever counted out? Prove them wrong in the comments',
  },
  RIVER_SAVE_FISH: {
    primary: (title) => `Have you ever saved someone while drowning yourself? Share below`,
    pinned: (title) => `NOBODY_EXPECTED - ${title.slice(0, 50)}...\nHave you ever saved someone while drowning yourself? Share below\nI read every comment!`,
    caption: 'YOUR BRAVERY',
    followUp: 'FOLLOW NOW for more rescue stories!',
    engagement: 'Have you ever saved someone while drowning yourself? Share below',
  },
  BROKEN_FIX_INSPIRE: {
    primary: (title) => `Have you fixed something everyone said was broken? Show us below`,
    pinned: (title) => `NOBODY_EXPECTED - ${title.slice(0, 50)}...\nHave you fixed something everyone said was broken? Show us below\nI read every comment!`,
    caption: 'YOUR CREATION',
    followUp: 'FOLLOW NOW for more innovation stories!',
    engagement: 'Have you fixed something everyone said was broken? Show us below',
  },
  LEFT_RUN_REUNION: {
    primary: (title) => `Have you ever run to reunite with someone you love? Tell us`,
    pinned: (title) => `NOBODY_EXPECTED - ${title.slice(0, 50)}...\nHave you ever run to reunite with someone you love? Tell us\nI read every comment!`,
    caption: 'YOUR REUNION',
    followUp: 'FOLLOW NOW for more reunion stories!',
    engagement: 'Have you ever run to reunite with someone you love? Tell us',
  },
}

const DEFAULT_ARC = ARC_CTAS.RAIN_SHELTER_LOVE

export class TopicCtaBuilder {
  build(article) {
    const arc = article?.algorithm?.arc || article?.arc || 'RAIN_SHELTER_LOVE'
    const ctas = ARC_CTAS[arc] || DEFAULT_ARC
    const category = (article?.category || 'default').toLowerCase()
    const title = article?.title || article?.headline || 'NEWS'

    return {
      cta: ctas.primary(title),
      narration: ctas.primary(title),
      caption: ctas.caption,
      engagement: ctas.engagement,
      followUp: ctas.followUp,
      pinnedComment: ctas.pinned(title),
      topic: category,
      mode: 'arc',
      arc,
    }
  }
}
