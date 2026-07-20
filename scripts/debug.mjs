import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'

console.log('Testing @napi-rs/canvas...')
const c = createCanvas(100, 100)
console.log('Canvas OK:', c.width, 'x', c.height)

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf')) {
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
    console.log('Anton font registered')
  }
} catch (e) {
  console.log('Font error:', e.message)
}

console.log('Canvas binding dir:', fs.readdirSync('node_modules/@napi-rs/canvas').slice(0,10).join(', '))
try {
  console.log('Linux binding:', fs.readdirSync('node_modules/@napi-rs/canvas-linux-x64-gnu').slice(0,5).join(', '))
} catch {
  console.log('Linux binding: NOT FOUND')
}
