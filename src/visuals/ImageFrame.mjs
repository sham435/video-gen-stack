export async function drawImageFrame(ctx, imageUrl, progress, loadImage) {
  // Canvas-relative — derives W/H from the live canvas so it works at any
  // aspect (9:16 portrait or 16:9 landscape) instead of a hardcoded 1080x1920.
  const W = ctx.canvas?.width || 1080
  const H = ctx.canvas?.height || 1920
  const U = Math.min(W, H) / 1080
  const p = Math.min(1, progress * 1.5)
  if (!imageUrl) return

  ctx.save()
  ctx.globalAlpha = 0.4 * p
  ctx.filter = `blur(${Math.round(30 * U)}px)`

  try {
    const img = await loadImage(imageUrl)
    const bleed = 100 * U
    ctx.drawImage(img, -bleed, -bleed, W + bleed * 2, H + bleed * 2)
    ctx.filter = 'none'

    const imgW = W * 0.85
    const imgH = imgW * (img.height / img.width)
    const ix = W / 2 - imgW / 2
    const iy = H / 2 - imgH / 2

    ctx.globalAlpha = p
    const parallaxX = (1 - p) * 20 * U
    const parallaxY = (1 - p) * 12 * U

    ctx.drawImage(img, ix + parallaxX, iy + parallaxY, imgW, imgH)

    ctx.strokeStyle = `rgba(0, 229, 255, ${0.2 * p})`
    ctx.lineWidth = 2 * U
    ctx.strokeRect(ix + parallaxX, iy + parallaxY, imgW, imgH)

    ctx.fillStyle = `rgba(0, 229, 255, ${0.04 * p})`
    ctx.fillRect(ix + parallaxX, iy + parallaxY, imgW, 3 * U)

    const fadeH = 60 * U
    const grad = ctx.createLinearGradient(ix + parallaxX, iy + parallaxY + imgH - fadeH, ix + parallaxX, iy + parallaxY + imgH)
    grad.addColorStop(0, 'rgba(5,5,5,0)')
    grad.addColorStop(1, 'rgba(5,5,5,0.6)')
    ctx.fillStyle = grad
    ctx.fillRect(ix + parallaxX, iy + parallaxY + imgH - fadeH, imgW, fadeH)
  } catch {}

  ctx.restore()
}
