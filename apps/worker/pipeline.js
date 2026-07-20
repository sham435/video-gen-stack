import { getDb, initSchema, generateContentId } from '../../packages/common/database/schema.js'
import { DuplicateDetector } from '../../packages/news/detector/duplicate.js'
import { QualityChecker } from '../../packages/common/quality/checker.js'
import { QualityValidator } from '../../packages/common/quality/validator.js'
import { AudioManager } from '../../packages/media/audio/manager.js'
import { TypographyManager } from '../../packages/branding/templates/typography/manager.js'
import { RollbackManager } from '../../packages/common/rollback/manager.js'
import { AssetManager } from '../../packages/storage/manager.js'
import { copyFileSync } from 'fs'

export class NewsPipeline {
  constructor() {
    this.db = getDb()
    initSchema(this.db)
    this.detector = new DuplicateDetector()
    this.quality = new QualityChecker()
    this.validator = new QualityValidator()
    this.audio = new AudioManager()
    this.typography = new TypographyManager()
    this.rollback = new RollbackManager()
  }

  async run({ category = 'technology', topic, publish = true } = {}) {
    const startTime = Date.now()
    const { fetchTopHeadlines, searchNews } = await import('../../apps/api/services/news.js')
    const { renderNewsVideo } = await import('../../apps/api/services/renderer.js')
    const { uploadShort } = await import('../../apps/api/publishers/youtube.js')

    // Phase 1: Fetch
    console.log('[PIPELINE] Phase 1: Fetching news...')
    const articles = topic
      ? await searchNews(topic, { pageSize: 15 })
      : await fetchTopHeadlines({ category, pageSize: 15 })

    if (!articles.length) {
      return { status: 'no_articles' }
    }

    // Phase 2: Deduplicate
    console.log('[PIPELINE] Phase 2: Checking duplicates...')
    let freshArticle = null
    for (const article of articles) {
      const check = this.detector.check(article)
      if (!check.isDuplicate) {
        freshArticle = article
        break
      }
    }

    if (!freshArticle) {
      return { status: 'all_duplicates', checked: articles.length }
    }

    const headline = freshArticle.title
    const contentId = generateContentId(headline, category)

    this.detector.logPipeline(contentId, 'fetch', 'success', `Found: ${headline.slice(0, 60)}`, Date.now() - startTime)

    // Phase 3: Quality Check
    console.log('[PIPELINE] Phase 3: Quality check...')
    const quality = await this.quality.check(freshArticle, freshArticle.description)
    if (!quality.passed) {
      this.detector.logPipeline(contentId, 'quality', 'rejected', quality.issues.join(', '), Date.now() - startTime)
      return { status: 'quality_failed', score: quality.score, issues: quality.issues }
    }

    // Phase 4: Setup asset storage
    console.log('[PIPELINE] Phase 4: Organizing assets...')
    const assets = new AssetManager(contentId)
    assets.save('article', 'article.json', {
      contentId,
      headline,
      url: freshArticle.url,
      source: freshArticle.source?.name,
      author: freshArticle.author,
      publishedAt: freshArticle.publishedAt,
      description: freshArticle.description,
      fetchedAt: new Date().toISOString(),
    })

    // Phase 5: Select audio from asset manager
    console.log('[PIPELINE] Phase 5: Selecting audio...')
    const audioTrack = this.audio.selectTrack(category, 30)
    const musicUrl = audioTrack?.url
    const mixPreset = this.audio.getPreset('default')

    // Phase 6: Render
    console.log('[PIPELINE] Phase 6: Rendering video...')
    const renderStart = Date.now()
    const useArticles = [freshArticle, ...articles.slice(0, 4).filter(a => a.title !== freshArticle.title)]

    const videoPath = await renderNewsVideo(useArticles, { musicUrl })
    const renderTime = Date.now() - renderStart
    this.detector.logPipeline(contentId, 'render', 'success', `Rendered in ${renderTime}ms`, renderTime)

    // Phase 7: Quality validation
    console.log('[PIPELINE] Phase 7: Validating quality...')
    const validation = this.validator.validateAll(freshArticle, videoPath)
    this.validator.logValidation(contentId, validation)

    if (!validation.passed && validation.totalScore < 50) {
      this.detector.logPipeline(contentId, 'quality', 'rejected', `Score: ${validation.totalScore}`, Date.now() - startTime)
      return { status: 'quality_failed', score: validation.totalScore, issues: validation.text?.issues }
    }

    // Create snapshot before publishing
    await this.rollback.createSnapshot(contentId, contentId, videoPath, 'pre_publish')

    // Phase 8: Publish
    if (publish) {
      console.log('[PIPELINE] Phase 8: Publishing to YouTube...')
      const { readFileSync, unlinkSync } = await import('fs')
      const videoBuffer = readFileSync(videoPath)
      const base64 = videoBuffer.toString('base64')

      const title = `📰 ${headline.slice(0, 90)}`
      const description = `Latest ${category} news update\n\n${headline}\n\nSource: ${freshArticle.source?.name || 'News API'}\n\n#${category} #news #AI`

      const youtubeResult = await uploadShort(
        `data:video/mp4;base64,${base64}`,
        title,
        description,
        process.env.YOUTUBE_PRIVACY || 'public'
      )

      // Save final assets
      const outputPath = assets.path('render_final', `${contentId}.mp4`)
      copyFileSync(videoPath, outputPath)
      unlinkSync(videoPath)

      assets.save('youtube_metadata', 'youtube.json', {
        videoId: youtubeResult?.id,
        url: `https://youtu.be/${youtubeResult?.id}`,
        title,
        template: this.typography.getActiveVersion('technology_news')?.version,
        audioTrack: audioTrack?.name,
        qualityScore: validation.totalScore,
        uploadedAt: new Date().toISOString(),
      })

      // Record in database
      const articleId = this.detector.record(freshArticle, youtubeResult?.id, validation.totalScore)
      this.detector.logPipeline(contentId, 'publish', 'success', `https://youtu.be/${youtubeResult?.id}`, Date.now() - renderStart)

      return {
        status: 'published',
        contentId,
        headline,
        videoId: youtubeResult?.id,
        url: `https://youtu.be/${youtubeResult?.id}`,
        qualityScore: validation.totalScore,
        templateVersion: this.typography.getActiveVersion('technology_news')?.version,
        renderTime: `${renderTime}ms`,
        totalTime: `${Date.now() - startTime}ms`,
      }
    }

    return { status: 'rendered_not_published', contentId, videoPath }
  }
}
