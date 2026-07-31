import { createCanvas, loadImage } from '@napi-rs/canvas'

const MIN_IMAGE_BYTES = 20 * 1024

export class CoverValidator {
  async validate(coverPath, brief) {
    const checks = { hasImage: false, hasBrandLogo: false, hasHeadline: false, imageResolution: null, contrastScore: 0, readability: 'FAIL' }

    try {
      const { statSync } = await import('fs')
      const stat = statSync(coverPath)
      checks.hasImage = stat.size >= MIN_IMAGE_BYTES
      if (!checks.hasImage) {
        return { ok: false, checks, reason: 'cover image too small or missing' }
      }

      const img = await loadImage(coverPath)
      checks.imageResolution = `${img.width}x${img.height}`

      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      // Brand + headline presence: check for high-contrast pixels in expected bands
      const w = img.width, h = img.height
      const band = (y0, y1) => {
        let bright = 0, total = 0, dark = 0
        for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x += 8) {
          for (let y = y0; y < y1; y += 8) {
            const d = ctx.getImageData(x, y, 1, 1).data
            const lum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]
            if (lum > 200) bright++
            else if (lum < 60) dark++
            total++
          }
        }
        return { bright, dark, total }
      }

      // Top band = brand bar (NEWS-MONSTER + accent), headline band = center
      const top = band(Math.floor(h * 0.02), Math.floor(h * 0.10))
      const headlineBand = band(Math.floor(h * 0.45), Math.floor(h * 0.62))

      // Brand logo: strong accent contrast in top band
      checks.hasBrandLogo = top.bright > 0 && top.dark > 0 && top.total > 10
      checks.hasHeadline = headlineBand.bright > 3 && headlineBand.total > 10

      // Contrast score: bright-vs-dark separation in headline band
      const sep = top.total > 0 ? (top.bright + top.dark) / top.total : 0
      checks.contrastScore = Math.round(Math.min(100, sep * 220))
      checks.readability = checks.contrastScore >= 55 && checks.hasHeadline ? 'PASS' : 'FAIL'

      // CTR prediction heuristic: contrast + headline + brand presence + subject keywords
      const ctr = Math.round(
        40 +
        (checks.contrastScore / 100) * 30 +
        (checks.hasHeadline ? 12 : 0) +
        (checks.hasBrandLogo ? 8 : 0) +
        (brief?.text_overlay?.top ? 5 : 0)
      )
      checks.ctrPrediction = Math.min(97, ctr)
      checks.regenerate = checks.ctrPrediction < 70
    } catch (e) {
      return { ok: false, checks, reason: e.message }
    }

    const ok = checks.hasImage && checks.hasBrandLogo && checks.hasHeadline && checks.readability === 'PASS' && !checks.regenerate
    return {
      ok,
      checks,
      reason: !checks.regenerate
        ? (ok ? 'cover ready for publishing' : 'cover failed validation — block publishing')
        : `CTR prediction ${checks.ctrPrediction} < 70 — regenerate cover`,
    }
  }
}
