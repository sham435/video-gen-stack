import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
  GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')
const ctx = createCanvas(1080,10).getContext('2d')
import { FooterLayout } from './src/video/footer/FooterLayout.mjs'
import { ellipsize } from './src/video/footer/blocks.mjs'
const layout = FooterLayout.compute(ctx, 1080)
const urlCol = layout.right.find(c=>c.key==='url')
const url='https://sham435.github.io/video-gen-stack/'
ctx.font='900 30px "Montserrat ExtraBold", sans-serif'
console.log('URL col w:', urlCol.w.toFixed(0))
console.log('full URL w:', ctx.measureText(url).width.toFixed(0))
const dom = 'sham435.github.io'
console.log('domain w:', ctx.measureText(dom).width.toFixed(0), '→ fits?', ctx.measureText(dom).width <= urlCol.w)
console.log('ellipsis display:', ellipsize(ctx, url, urlCol.w, 900, 30))
