// Stage: article — source data must exist before any work begins.
export class ArticlePreflight {
  static async run(job, options = {}) {
    const errors = []
    const warnings = []
    if (!job?.article && !options.article) errors.push('ARTICLE_MISSING')
    if (!job?.category && !options.category) errors.push('CATEGORY_MISSING')
    return { errors, warnings }
  }
}
