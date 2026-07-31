import { loadImage } from '@napi-rs/canvas'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'

const { W, H } = DesignSystem

export class HeroVisualLayer {
  constructor() {
    this.cache = {}
  }

  async load(url) {
    if (this.cache[url]) return this.cache[url]
    try {
      const img = await loadImage(url)
      this.cache[url] = img
      return img
    } catch {
      return null
    }
  }

  async draw(ctx, scene, progress) {
    const imgUrl = scene.image || scene.backgroundImage || scene.bRoll
    if (!imgUrl) return

    const img = await this.load(imgUrl)
    if (!img) return

    ctx.save()

    const zoom = 1 + Math.sin(progress * Math.PI) * 0.03
    const offsetX = Math.sin(progress * 0.3) * 20
    const offsetY = Math.cos(progress * 0.4) * 15

    const imgW = img.width
    const imgH = img.height
    const aspect = imgW / imgH
    const targetAspect = W / H

    let sx, sy, sw, sh
    if (aspect > targetAspect) {
      sh = imgH
      sw = imgH * targetAspect
      sx = (imgW - sw) / 2
      sy = 0
    } else {
      sw = imgW
      sh = imgW / targetAspect
      sx = 0
      sy = (imgH - sh) / 2
    }

    ctx.globalAlpha = 0.6
    ctx.drawImage(img, sx, sy, sw, sh, offsetX, offsetY, W * zoom, H * zoom)

    const fadeGrad = ctx.createLinearGradient(0, H * 0.5, 0, H)
    fadeGrad.addColorStop(0, 'rgba(0,0,0,0)')
    fadeGrad.addColorStop(1, 'rgba(0,0,0,0.7)')
    ctx.fillStyle = fadeGrad
    ctx.fillRect(0, 0, W, H)

    ctx.restore()
  }
}