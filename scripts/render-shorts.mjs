import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf')) {
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  }
  if (fs.existsSync('assets/fonts/Inter-Black.ttf')) {
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
  }
} catch {}

const W = 1080, H = 1920

function splitIntoPhrases(text, maxWords = 3) {
  const words = text.split(' ')
  const phrases = []
  for (let i = 0; i < words.length; i += maxWords) {
    phrases.push(words.slice(i, i + maxWords).join(' '))
  }
  return phrases
}

function drawPhrase(text, outPath, accentColor = '#FFFFFF') {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)

  const fontSize = text.length > 12 ? 130 : 165
  ctx.font = `900 ${fontSize}px Anton, InterBlack, Impact, sans-serif`
  ctx.fillStyle = accentColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.transform(1, 0, -0.22, 1, 0, 0)
  ctx.scale(0.92, 1)
  ctx.fillText(text.toUpperCase(), 0, 0)
  ctx.restore()

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  return outPath
}

export function renderShortsFrames(phrases, outDir = 'output/frames') {
  fs.mkdirSync(outDir, { recursive: true })
  return phrases.map((phrase, i) => {
    const p = `${outDir}/frame_${String(i).padStart(3, '0')}.png`
    drawPhrase(phrase, p)
    return p
  })
}

// CLI
if (import.meta.url.endsWith('render-shorts.mjs')) {
  const txt = process.argv[2] || 'ACTUALLY SEE'
  const phrases = splitIntoPhrases(txt)
  renderShortsFrames(phrases, 'output/frames')
  console.log('Rendered phrases:', phrases)
}
