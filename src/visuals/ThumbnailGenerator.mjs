import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

const W = 1080, H = 1920

export class ThumbnailGenerator {
  async generate(article, outPath = 'output/thumbnail.png') {
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')

    this.drawCarbonFiberBg(ctx)
    this.drawSplitLayout(ctx, article)
    this.drawGlitchDivider(ctx)
    this.drawExclusiveBadge(ctx)
    this.drawHeadline(ctx, article)

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }

  drawCarbonFiberBg(ctx) {
    const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W)
    grad.addColorStop(0, '#1a1a2e')
    grad.addColorStop(0.5, '#0f0f1a')
    grad.addColorStop(1, '#050508')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)

    ctx.strokeStyle = 'rgba(255,255,255,0.02)'
    ctx.lineWidth = 0.5
    for (let i = 0; i < W; i += 4) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, H)
      ctx.stroke()
    }
    for (let i = 0; i < H; i += 4) {
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(W, i)
      ctx.stroke()
    }
  }

  drawSplitLayout(ctx, article) {
    const midX = W / 2

    ctx.save()

    ctx.fillStyle = 'rgba(225, 0, 255, 0.04)'
    ctx.fillRect(0, 0, midX - 2, H)

    ctx.fillStyle = 'rgba(0, 229, 255, 0.04)'
    ctx.fillRect(midX + 2, 0, midX - 2, H)

    const gradientLeft = ctx.createLinearGradient(0, H * 0.3, midX, H * 0.7)
    gradientLeft.addColorStop(0, 'rgba(225, 0, 255, 0.12)')
    gradientLeft.addColorStop(1, 'rgba(225, 0, 255, 0)')
    ctx.fillStyle = gradientLeft
    ctx.fillRect(0, H * 0.3, midX, H * 0.4)

    const gradientRight = ctx.createLinearGradient(midX, H * 0.2, W, H * 0.8)
    gradientRight.addColorStop(0, 'rgba(0, 229, 255, 0)')
    gradientRight.addColorStop(0.5, 'rgba(0, 229, 255, 0.1)')
    gradientRight.addColorStop(1, 'rgba(0, 229, 255, 0)')
    ctx.fillStyle = gradientRight
    ctx.fillRect(midX, H * 0.2, midX, H * 0.6)

    ctx.restore()
  }

  drawGlitchDivider(ctx) {
    const midX = W / 2

    ctx.save()
    ctx.shadowColor = '#E100FF'
    ctx.shadowBlur = 20
    ctx.strokeStyle = '#E100FF'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(midX, 0)
    ctx.lineTo(midX, H)
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.strokeStyle = '#00E5FF'
    ctx.lineWidth = 1
    const offsets = [4, -3, 6, -2]
    offsets.forEach((off, i) => {
      const y = H * 0.2 + i * H * 0.15
      ctx.beginPath()
      ctx.moveTo(midX + off, y)
      ctx.lineTo(midX + off, y + 40)
      ctx.stroke()
    })

    ctx.restore()
  }

  drawExclusiveBadge(ctx) {
    const badgeW = 240
    const badgeH = 36
    const badgeX = 20
    const badgeY = 20

    ctx.save()

    ctx.fillStyle = '#0A1128'
    ctx.beginPath()
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6)
    ctx.fill()

    ctx.strokeStyle = '#FFD700'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6)
    ctx.stroke()

    ctx.font = '700 14px Inter, sans-serif'
    ctx.fillStyle = '#FFD700'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('EXCLUSIVE ANALYSIS', badgeX + badgeW / 2, badgeY + badgeH / 2)

    ctx.restore()
  }

  drawHeadline(ctx, article) {
    const title = article.title || 'TECH BREAKTHROUGH'
    const words = title.split(' ')

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 15

    const primaryWords = words.slice(0, 3).join(' ')
    ctx.font = '900 72px Anton, Impact, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#FFD700'
    ctx.fillText(primaryWords.toUpperCase(), W / 2, H * 0.88)

    const secondaryWords = words.slice(3, 6).join(' ')
    ctx.font = '700 42px Inter, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(secondaryWords.toUpperCase(), W / 2, H * 0.94)

    ctx.shadowBlur = 0

    ctx.font = '900 180px Inter, sans-serif'
    ctx.fillStyle = 'rgba(225, 0, 255, 0.15)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('?', W * 0.75, H * 0.4)

    ctx.restore()
  }
}
