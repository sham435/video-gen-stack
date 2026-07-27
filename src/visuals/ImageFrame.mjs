const W = 1080, H = 1920

export async function drawImageFrame(ctx, imageUrl, progress, loadImage) {
  const p = Math.min(1, progress * 1.5)
  if (!imageUrl) return

  ctx.save()
  ctx.globalAlpha = 0.4 * p
  ctx.filter = 'blur(30px)'

  try {
    const img = await loadImage(imageUrl)
    ctx.drawImage(img, -100, -100, W + 200, H + 200)
    ctx.filter = 'none'

    const imgW = W * 0.85
    const imgH = imgW * (img.height / img.width)
    const ix = W / 2 - imgW / 2
    const iy = H / 2 - imgH / 2

    ctx.globalAlpha = p
    const parallaxX = (1 - p) * 20
    const parallaxY = (1 - p) * 12

    ctx.drawImage(img, ix + parallaxX, iy + parallaxY, imgW, imgH)

    ctx.strokeStyle = `rgba(0, 229, 255, ${0.2 * p})`
    ctx.lineWidth = 2
    ctx.strokeRect(ix + parallaxX, iy + parallaxY, imgW, imgH)

    ctx.fillStyle = `rgba(0, 229, 255, ${0.04 * p})`
    ctx.fillRect(ix + parallaxX, iy + parallaxY, imgW, 3)

    const grad = ctx.createLinearGradient(ix + parallaxX, iy + parallaxY + imgH - 60, ix + parallaxX, iy + parallaxY + imgH)
    grad.addColorStop(0, 'rgba(5,5,5,0)')
    grad.addColorStop(1, 'rgba(5,5,5,0.6)')
    ctx.fillStyle = grad
    ctx.fillRect(ix + parallaxX, iy + parallaxY + imgH - 60, imgW, 60)
  } catch {}

  ctx.restore()
}
