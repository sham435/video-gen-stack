import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export class AssetManager {
  constructor(cacheDir = 'cache/assets') {
    this.cacheDir = cacheDir
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  assetKey(scene, article) {
    const hash = crypto.createHash('md5')
      .update(`${article.title || ''}_${scene.id}_${scene.visual?.prompt || ''}_${scene.visual?.type || ''}`)
      .digest('hex')
      .slice(0, 12)
    return hash
  }

  async resolve(scenes, article, resolveFn) {
    const resolved = []
    for (const scene of scenes) {
      const key = this.assetKey(scene, article)
      const cached = this.findCached(key)
      if (cached) {
        resolved.push({ ...scene, visual: { ...scene.visual, primary: { path: cached, source: 'cache' } } })
        continue
      }
      const enriched = await resolveFn(scene, article)
      const mergedVisual = {
        ...scene.visual,
        assets: enriched.assets || scene.visual?.assets || [],
        primary: enriched.primary || scene.visual?.primary || { type: 'gradient', path: null, source: 'fallback' },
      }
      if (mergedVisual.primary?.path && !mergedVisual.primary.path.startsWith('file://') && !mergedVisual.primary.path.startsWith('/')) {
        const localPath = await this.downloadToCache(key, mergedVisual.primary.path)
        mergedVisual.primary.path = localPath
      }
      resolved.push({ ...scene, visual: mergedVisual })
    }
    return resolved
  }

  findCached(key) {
    const files = fs.readdirSync(this.cacheDir).filter(f => f.startsWith(key))
    if (files.length > 0) return path.resolve(this.cacheDir, files[0])
    return null
  }

  async downloadToCache(key, url) {
    if (!url || url.startsWith('/') || url.startsWith('file://')) return url
    const ext = this.guessExtension(url)
    const dest = path.join(this.cacheDir, `${key}${ext}`)
    if (fs.existsSync(dest)) return dest
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return url
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(dest, buf)
      return dest
    } catch { return url }
  }

  guessExtension(url) {
    const clean = url.split('?')[0].split('#')[0]
    const ext = path.extname(clean).toLowerCase()
    return ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.gif'].includes(ext) ? ext : '.jpg'
  }

  purge(olderThanMs = 86400000) {
    const now = Date.now()
    for (const f of fs.readdirSync(this.cacheDir)) {
      const fp = path.join(this.cacheDir, f)
      try { if (now - fs.statSync(fp).mtimeMs > olderThanMs) fs.unlinkSync(fp) } catch {}
    }
  }

  getStats() {
    const files = fs.readdirSync(this.cacheDir).filter(f => !f.startsWith('.'))
    const totalSize = files.reduce((sum, f) => {
      try { return sum + fs.statSync(path.join(this.cacheDir, f)).size } catch { return sum }
    }, 0)
    return { files: files.length, sizeBytes: totalSize, sizeMB: (totalSize / 1024 / 1024).toFixed(1) }
  }
}
