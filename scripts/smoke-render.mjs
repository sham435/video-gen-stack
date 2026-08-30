// STEP14 smoke test — render a single hook frame at both profiles to confirm
// the aspect-aware InformationLayer composition works for 9:16 and 16:9.
import { SceneEngine } from '../src/video/SceneEngine.mjs'
import { DesignSystem } from '../src/visuals/DesignSystem.mjs'
import { RenderProfiles } from '../src/video/RenderProfile.mjs'
import { createCanvas } from '@napi-rs/canvas'
import fs from 'fs'

const scene = {
  id: 'scene-0-hook',
  index: 0,
  type: 'hook',
  text: 'Nobody expected this move - AI startup surprises Wall Street',
  subheadline: 'BREAKING MARKETS',
  category: 'technology',
  headlineFontSize: 92,
  duration: 3,
  ticker: ['AI', 'Robotics', 'Cybersecurity', 'Space'],
}

async function renderOne(profile, label) {
  DesignSystem.setProfile(profile)
  const engine = new SceneEngine({ category: 'technology' })
  const png = await engine.renderSceneFrame(scene, 0.9, [], 0, null)
  const file = `output/smoke-${label}.png`
  fs.writeFileSync(file, png)
  const canvas = createCanvas(0, 0)
  const dims = [DesignSystem.W, DesignSystem.H]
  console.log(`[SMOKE] ${label} profile=${profile.type} w=${dims[0]} h=${dims[1]} bytes=${png.length} -> ${file}`)
  return file
}

await renderOne(RenderProfiles.SHORT_4K, 'short')
await renderOne(RenderProfiles.VIDEO_HD, 'video')
console.log('[SMOKE] OK both profiles rendered without crashing')
