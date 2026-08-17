#!/usr/bin/env node
/**
 * Quick render clean cover for Shorts Promote mode
 */

import path from 'path'

async function main() {
  const { CoverComposer } = await import('../src/video-studio/CoverComposer.mjs')
  const { pickAlgorithm } = await import('../src/ai/StoryAlgorithmRegistry.mjs')
  
  const composer = new CoverComposer()
  const article = { title: 'S&P Steady After Record Close', category: 'business', source: 'Politico' }
  const algo = pickAlgorithm(article)
  
  const brief = {
    title: article.title,
    category: article.category,
    source: article.source,
    hideBranding: true,
    algorithm: algo,
    text_overlay: { top: 'NOBODY EXPECTED THIS MOVE', bottom: 'S&P STEADY' }
  }
  
  const outPath = '/tmp/clean-short-cover.png'
  console.log(`Rendering clean cover to ${outPath} with hideBranding=true, ALGO #${algo.number}/48`)
  
  try {
    await composer.compose(brief, null, outPath)
    console.log(`✅ Clean cover rendered: ${outPath}`)
    console.log('No NM monogram, no avatar, no sham435, no ACTUALLY SEE')
  } catch (e) {
    console.error('Render failed:', e.message)
    console.error('Make sure PEXELS_API_KEY is set and CoverComposer is implemented')
  }
}

main()
