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
    const urls = scene.images || (scene.image ? [scene.image] : null) || (scene.bRoll ? [scene.bRoll] : null) || (scene.backgroundImage ? [scene.backgroundImage] : null)
    if (!urls || urls.length === 0) return

    // B-roll cycling: swap the hero image every ~2.5s within the scene
    const cycle = Math.floor(progress * 3.5) % urls.length
    const imgUrl = urls[cycle]
    const img = await this.load(imgUrl)
    if (!img) return

    // Crossfade between images on swap
    const local = progress * 3.5 - Math.floor(progress * 3.5)
    const blendAlpha = 0.6 * (1 - Math.abs(local - 0.5) * 1.4)

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

    ctx.globalAlpha = Math.max(0.35, blendAlpha)
    ctx.drawImage(img, sx, sy, sw, sh, offsetX, offsetY, W * zoom, H * zoom)

    const fadeGrad = ctx.createLinearGradient(0, H * 0.5, 0, H)
    fadeGrad.addColorStop(0, 'rgba(0,0,0,0)')
    fadeGrad.addColorStop(1, 'rgba(0,0,0,0.7)')
    ctx.fillStyle = fadeGrad
    ctx.fillRect(0, 0, W, H)

    ctx.restore()
  }
}