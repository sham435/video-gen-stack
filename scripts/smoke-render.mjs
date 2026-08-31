// Smoke test — render a single hook frame at the 16:9 profile to confirm the
// production composition pipeline runs end-to-end (1280x720 logical -> 1920x1080).
import { SceneEngine } from '../src/video/SceneEngine.mjs'
import { DesignSystem } from '../src/visuals/DesignSystem.mjs'
import { VIDEO_HD } from '../src/video/RenderProfile.mjs'
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
  const dims = [DesignSystem.W, DesignSystem.H]
  console.log(`[SMOKE] ${label} profile=${profile.type} w=${dims[0]} h=${dims[1]} bytes=${png.length} -> ${file}`)
  return file
}

await renderOne(VIDEO_HD, 'video')
console.log('[SMOKE] OK 16:9 profile rendered without crashing')
