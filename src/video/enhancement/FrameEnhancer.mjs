import { EnhancementProfileManager } from './EnhancementProfileManager.mjs'

export class FrameEnhancer {
  constructor() {
    this.manager = EnhancementProfileManager
  }

  enhance(ctx, category) {
    const profile = this.manager.getProfileFor(category)
    this.applyColorGrade(ctx, profile)
    this.applyContrast(ctx, profile.contrast)
    this.applySaturation(ctx, profile.saturation)
    this.applySharpen(ctx, profile.sharpen)
  }

  applyColorGrade(ctx, profile) {
    const { width, height } = ctx.canvas
    ctx.save()
    ctx.globalCompositeOperation = 'overlay'
    const grad = ctx.createLinearGradient(0, 0, width, height)
    grad.addColorStop(0, 'rgba(0, 229, 255, 0.08)')
    grad.addColorStop(0.5, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(225, 6, 0, 0.12)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
  }

  applyContrast(ctx, amount) {
    if (!amount || amount === 1) return
    const { width, height } = ctx.canvas
    const imageData = ctx.getImageData(0, 0, width, height)
    const d = imageData.data
    const factor = (259 * (amount * 100 + 255)) / (255 * (259 - amount * 100 + 255))
    for (let i = 0; i < d.length; i += 4) {
      d[i] = factor * (d[i] - 128) + 128
      d[i + 1] = factor * (d[i + 1] - 128) + 128
      d[i + 2] = factor * (d[i + 2] - 128) + 128
    }
    ctx.putImageData(imageData, 0, 0)
  }

  applySaturation(ctx, amount) {
    if (!amount || amount === 1) return
    const { width, height } = ctx.canvas
    const imageData = ctx.getImageData(0, 0, width, height)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      d[i] = gray + (r - gray) * amount
      d[i + 1] = gray + (g - gray) * amount
      d[i + 2] = gray + (b - gray) * amount
    }
    ctx.putImageData(imageData, 0, 0)
  }

  applySharpen(ctx, amount) {
    if (!amount || amount <= 1.0) return
    const { width, height } = ctx.canvas
    const src = ctx.getImageData(0, 0, width, height)
    const out = ctx.createImageData(width, height)
    const s = src.data, t = out.data
    const amt = amount - 1.0
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          const center = s[i + c]
          const up = s[i - width * 4 + c]
          const down = s[i + width * 4 + c]
          const left = s[i - 4 + c]
          const right = s[i + 4 + c]
          const blurred = (up + down + left + right) / 4
          const sharpened = center + amt * (center - blurred)
          t[i + c] = Math.max(0, Math.min(255, sharpened))
        }
        t[i + 3] = 255
      }
    }
    ctx.putImageData(out, 0, 0)
  }
}
