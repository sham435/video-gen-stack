// Centralized hashtag builder — enforces topic → category → profile → channel order
// and the NEWS-MONSTER brand across every platform export.
export class HashtagBuilder {
  static build({ topic, category, pipelineProfile, channel = 'NEWS-MONSTER' }) {
    const hashtags = [
      topic,             // 1. News topic
      category,          // 2. Category
      pipelineProfile,   // 3. PIPELINE_PROFILE_MAP
      channel,           // 4. Channel brand
    ]

    return hashtags
      .filter(Boolean)
      .map(tag => `#${tag.toLowerCase().replace(/\s+/g, '-')}`)
      .join(' ')
  }

  static buildList({ topic, category, pipelineProfile, channel = 'NEWS-MONSTER' }) {
    return this.build({ topic, category, pipelineProfile, channel }).split(' ').filter(Boolean)
  }

  // Derive the topic hashtag from a headline (first meaningful keyword)
  static topicFromHeadline(headline) {
    if (!headline) return 'news'
    const stop = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'of', 'in', 'for', 'on', 'and', 'or', 'with', 'from', 'this', 'that', 'new', 'just', 'after', 'before', 'over', 'into'])
    const words = headline.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w))
    return words[0] || 'news'
  }
}
