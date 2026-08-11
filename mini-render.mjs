import { mkdtempSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
const { NewsBroadcastEngine } = await import('./src/index.mjs')
const outDir = mkdtempSync(join(tmpdir(), 'nr-'))
const engine = new NewsBroadcastEngine()
const article = {
  title: 'OpenAI launches new flagship AI model for video generation',
  description: 'OpenAI has announced a new model capable of generating studio-quality video from text prompts. The model understands camera angles, lighting, and narrative structure.',
  source: 'Tech News', url: 'https://example.com/ai-model', category: 'technology',
}
const res = await engine.generateFromArticle(article, outDir, null, { quick: true })
const videoPath = res.videoPath || res
console.log('video:', videoPath)
console.log('outdir:', outDir)
console.log('files:', readdirSync(outDir).join(', '))
// Extract frames at 1s, 5s, 28s
for (const t of [1, 4, 29]) {
  const p = `${outDir}/frame_${t}s.png`
  try { execFileSync('ffmpeg',['-y','-ss',String(t),'-i',videoPath,'-frames:v','1',p],{stdio:'pipe'}) } catch(e){}
}
console.log('FRAMES_DIR='+outDir)
