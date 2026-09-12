// QuoteRenderer — dedicated canvas pipeline for the engagement-quote format.
//
// Deliberately SEPARATE from the news compositor: it must not touch
// SceneEngine/compositor/BrandingLayer/BroadcastUILayer (news branding shows
// LIVE/GENERAL badges, ticker, Subscribe bar — the quote format has none).
//
// Layout: landscape 16:9 canvas (logical 1280x720, physical 1920x1080 —
// same render profile as the news pipeline), full-bleed blurred background
// image per line, dark scrim, centered quote text with the spec's
// FLASH-REVEAL effect: each line blurs in (12px→0), holds sharp, then
// quickly blurs out (→10px). No narration, no captions.

import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const QUOTE_TIMING = Object.freeze({
  preRoll: 0.4,
  phaseIn: 0.45,
  phaseOut: 0.35,
  holdL1: 2.6,
  holdL2: 2.6,
  holdL3: 2.4,
  holdL4: 3.6,   // the variable line is the comment driver — hold it longest
  tail: 0.4,
  stagger: 0.5,  // overlap between consecutive line windows
})

// Build the per-line time windows from the timing table.
// Returns [{start, end, phaseIn, phaseOut}] and totalDuration.
export function buildTimeline(timing = QUOTE_TIMING) {
  const windows = []
  let cursor = timing.preRoll
  for (let i = 0; i < 4; i++) {
    const hold = i === 3 ? timing.holdL4 : i === 0 ? timing.holdL1 : i === 1 ? timing.holdL2 : timing.holdL3
    const start = cursor
    const end = start + timing.phaseIn + hold + timing.phaseOut
    windows.push({ start, end, phaseIn: timing.phaseIn, phaseOut: timing.phaseOut, hold })
    cursor = end - timing.stagger
  }
  const totalDuration = windows[3].end + timing.tail
  return { windows, totalDuration }
}

// Per-line visual state at time t (seconds): flash-reveal envelope.
export function lineState(window, t) {
  if (t < window.start || t >= window.end) {
    return { visible: false, alpha: 0, blur: 14 }
  }
  const { start, end, phaseIn, phaseOut } = window
  if (t < start + phaseIn) {
    const p = (t - start) / phaseIn
    return { visible: true, alpha: p, blur: 12 * (1 - p) }
  }
  if (t >= end - phaseOut) {
    const p = (t - (end - phaseOut)) / phaseOut
    return { visible: true, alpha: Math.max(0, 1 - p), blur: 10 * p }
  }
  return { visible: true, alpha: 1, blur: 0 }
}

const FONT_CANDIDATES = [
  ['Anton', 'assets/fonts/anton-regular.ttf'],
  ['Anton', 'assets/fonts/Anton-Regular.ttf'],
  ['Montserrat', 'assets/fonts/montserrat-extra-bold.ttf'],
  ['Montserrat', 'assets/fonts/Montserrat-ExtraBold.ttf'],
]

export function registerQuoteFonts() {
  for (const [name, p] of FONT_CANDIDATES) {
    if (fs.existsSync(p) && !GlobalFonts.has(name)) {
      try { GlobalFonts.registerFromPath(p, name) } catch { /* best effort */ }
    }
  }
  return { anton: GlobalFonts.has('Anton'), montserrat: GlobalFonts.has('Montserrat') }
}

export class QuoteRenderer {
  constructor({ width = 1280, height = 720, fps = 10, outFps = 30, outWidth = 1920, outHeight = 1080 } = {}) {
    this.width = width
    this.height = height
    this.fps = fps
    this.outFps = outFps
    this.outWidth = outWidth
    this.outHeight = outHeight
    this.timeline = buildTimeline()
    registerQuoteFonts()
    this._bgCache = new Map() // url -> Canvas|'missing'|Promise
  }

  // ── Background images ────────────────────────────────────────────────

  async preloadBackgrounds(scenes) {
    await Promise.all(scenes.map(s => this._bg(s)))
  }

  async _bg(scene) {
    const url = scene?.image
    if (!url) return null
    if (this._bgCache.has(url)) {
      const hit = this._bgCache.get(url)
      if (hit instanceof Promise) return await hit
      return hit === 'missing' ? null : hit
    }
    const p = (async () => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!res.ok) throw new Error(`bg fetch ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        return await loadImage(buf)
      } catch {
        return 'missing'
      }
    })()
    this._bgCache.set(url, p)
    const img = await p
    // Cache the resolved value (including 'missing') — a later caller must
    // never re-await the stale Promise and get a truthy 'missing' string.
    this._bgCache.set(url, img)
    return img === 'missing' ? null : img
  }

  // Cover-crop the image onto the logical canvas (kept crisp enough for a
  // blurred background).
  _drawCover(ctx, img, alpha = 1) {
    const iw = img.width
    const ih = img.height
    const scale = Math.max(this.width / iw, this.height / ih)
    const dw = iw * scale
    const dh = ih * scale
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.filter = 'blur(14px)'
    ctx.drawImage(img, (this.width - dw) / 2, (this.height - dh) / 2, dw, dh)
    ctx.restore()
  }

  _drawScrim(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.height)
    g.addColorStop(0, 'rgba(6,10,16,0.74)')
    g.addColorStop(0.45, 'rgba(6,10,16,0.42)')
    g.addColorStop(1, 'rgba(6,10,16,0.8)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.width, this.height)
    // slight vignette
    const v = ctx.createRadialGradient(this.width / 2, this.height / 2, this.height * 0.35, this.width / 2, this.height / 2, this.height * 0.85)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,0.34)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, this.width, this.height)
  }

  _drawGradientFallback(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.height)
    g.addColorStop(0, '#233a4d')
    g.addColorStop(0.55, '#0f1b26')
    g.addColorStop(1, '#070c12')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.width, this.height)
  }

  // ── Text layout ──────────────────────────────────────────────────────

  _wrapText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/)
    const lines = []
    let cur = ''
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w
      if (ctx.measureText(trial).width > maxWidth && cur) {
        lines.push(cur)
        cur = w
      } else {
        cur = trial
      }
    }
    if (cur) lines.push(cur)
    return lines
  }

  // Pre-render a line to an offscreen canvas so per-frame blur is one
  // drawImage with ctx.filter (true blur-in, not just alpha).
  _makeTextCanvas(lines, { font, color, maxWidth, lineHeight }) {
    const lineFor = (t) => lines[0]
    let w = 0
    let h = 0
    // measure with a scratch canvas
    const scratch = createCanvas(1, 1)
    const sctx = scratch.getContext('2d')
    sctx.font = font
    for (const l of lines) {
      const m = sctx.measureText(l).width
      w = Math.max(w, m)
    }
    h = lines.length * lineHeight
    const padX = 28
    const canvas = createCanvas(Math.ceil(w + padX * 2), Math.ceil(h + 40))
    const ctx = canvas.getContext('2d')
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 3
    ctx.fillStyle = color
    lines.forEach((l, i) => {
      ctx.fillText(l, canvas.width / 2, 20 + lineHeight * (i + 0.5))
    })
    void lineFor
    return canvas
  }

  _textBlockFor(line, index, ctx) {
    const isCta = index === 2
    const isVar = index === 3
    // Big centered text — sized for a 1280-wide logical canvas (1080p out).
    const fontBig = `600 ${isCta ? 56 : 88}px ${isCta ? 'Montserrat' : 'Anton'}`
    const fontFallback = `${isCta ? 56 : 88}px Arial`
    const font = GlobalFonts.has(isCta ? 'Montserrat' : 'Anton') ? fontBig : fontFallback
    const maxWidth = this.width * 0.8
    ctx.font = font
    const wrapped = this._wrapText(ctx, line, maxWidth)
    const color = isCta ? '#FFB800' : isVar ? '#FFFFFF' : '#FFFFFF'
    const lineHeight = isCta ? 66 : 104
    const canvas = this._makeTextCanvas(wrapped, { font, color, maxWidth, lineHeight })
    const yCenter = this.height * (isCta ? 0.68 : 0.5)
    return { canvas, x: this.width / 2, y: yCenter }
  }

  // ── Frame rendering ──────────────────────────────────────────────────

  async renderFrame(scenes, lines, t) {
    const ctx = createCanvas(this.width, this.height).getContext('2d')
    // Background: the active scene is the last line window containing t.
    let activeIdx = 0
    for (let i = 0; i < this.timeline.windows.length; i++) {
      if (t >= this.timeline.windows[i].start) activeIdx = i
    }
    const scene = scenes[activeIdx] || scenes[0]
    const img = await this._bg(scene)
    if (img) this._drawCover(ctx, img)
    else this._drawGradientFallback(ctx)

    // Crossfade between scene backgrounds at line boundaries.
    if (activeIdx > 0) {
      const prevWindow = this.timeline.windows[activeIdx - 1]
      const prevStart = prevWindow.start
      const fadeDur = Math.min(0.4, (this.timeline.windows[activeIdx].start - prevStart) / 2)
      const tIn = t - this.timeline.windows[activeIdx].start
      if (tIn < fadeDur) {
        const prevImg = await this._bg(scenes[activeIdx - 1])
        if (prevImg) this._drawCover(ctx, prevImg, 1 - tIn / fadeDur)
      }
    }

    this._drawScrim(ctx)

    // Text — flash reveal per line.
    for (let i = 0; i < lines.length && i < 4; i++) {
      const st = lineState(this.timeline.windows[i], t)
      if (!st.visible || st.alpha <= 0) continue
      const block = this._textBlockFor(lines[i], i, ctx)
      ctx.save()
      ctx.globalAlpha = st.alpha
      if (st.blur > 0.5) ctx.filter = `blur(${st.blur.toFixed(1)}px)`
      ctx.drawImage(block.canvas, block.x - block.canvas.width / 2, block.y - block.canvas.height / 2)
      ctx.restore()
    }
    return ctx.canvas.toBuffer('image/png')
  }

  // ── Full render + assemble ───────────────────────────────────────────

  async renderAll(scenes, lines, { framesDir, totalDuration = this.timeline.totalDuration } = {}) {
    fs.mkdirSync(framesDir, { recursive: true })
    await this.preloadBackgrounds(scenes)
    const totalFrames = Math.ceil(totalDuration * this.fps)
    for (let f = 0; f < totalFrames; f++) {
      const t = f / this.fps
      const buf = await this.renderFrame(scenes, lines, t)
      fs.writeFileSync(path.join(framesDir, `frame_${String(f).padStart(5, '0')}.png`), buf)
      if (f % 30 === 0) console.log(`[QuoteRenderer] frame ${f}/${totalFrames}`)
    }
    return totalFrames
  }

  async assemble({ framesDir, totalDuration, outDir, videoPath, musicPath = null }) {
    fs.mkdirSync(outDir, { recursive: true })
    const listPath = path.join(outDir, 'quote_list.txt')
    const frameFiles = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => path.resolve(path.join(framesDir, f)))
    const perFrame = totalDuration / frameFiles.length
    const listContent = frameFiles.map(f => `file '${f}'\nduration ${perFrame.toFixed(4)}\n`).join('') +
      `file '${frameFiles[frameFiles.length - 1]}'\n`
    fs.writeFileSync(listPath, listContent)

    const silentVideo = path.join(outDir, 'quote_silent.mp4')
    execFileSync(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-vf', `scale=${this.outWidth}:${this.outHeight}:force_original_aspect_ratio=decrease,pad=${this.outWidth}:${this.outHeight}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${this.outFps}`,
        '-c:v', 'libx264', '-preset', 'faster', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
        '-b:v', '6M', '-maxrate', '7M', '-bufsize', '7M', '-r', this.outFps, silentVideo],
      { stdio: 'inherit', timeout: 600000 }
    )

    if (musicPath && fs.existsSync(musicPath)) {
      // Music-only bed (this format has no narration): quiet, loudness-limited.
      execFileSync(
        'ffmpeg',
        ['-y', '-i', silentVideo, '-i', musicPath,
          '-filter_complex', '[1:a]volume=0.35,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11[a]',
          '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac',
          '-movflags', '+faststart', '-t', String(totalDuration), videoPath],
        { stdio: 'inherit', timeout: 600000 }
      )
    } else {
      // Silent AAC track so the container always carries audio.
      execFileSync(
        'ffmpeg',
        ['-y', '-i', silentVideo, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
          '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac',
          '-movflags', '+faststart', '-t', String(totalDuration), videoPath],
        { stdio: 'inherit', timeout: 600000 }
      )
    }
    return videoPath
  }

  async renderAndAssemble(scenes, lines, outDir, { musicPath = null, videoPath = null } = {}) {
    const { totalDuration } = this.timeline
    const framesDir = path.join(outDir, 'frames')
    await this.renderAll(scenes, lines, { framesDir, totalDuration })
    const finalPath = videoPath || path.join(outDir, 'quote.mp4')
    await this.assemble({ framesDir, totalDuration, outDir, videoPath: finalPath, musicPath })
    return { videoPath: finalPath, totalDuration, framesDir, totalFrames: Math.ceil(totalDuration * this.fps) }
  }
}