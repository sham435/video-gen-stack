// RenderManifest — single source of truth for semantic layer ownership.
//
// Every semantic element (headline, caption, emphasis, banner, subtitle,
// footer) has exactly ONE owner renderer. Renderers must ask canRender()
// before drawing. This makes duplicate rendering (e.g. canvas karaoke +
// FFmpeg SRT burn of the same narration) structurally impossible.

export const LAYER_OWNERS = ['canvas', 'ffmpeg']

const DEFAULT_MANIFEST = {
  headline: { owner: 'canvas', enabled: true },
  caption: { owner: 'canvas', enabled: true },
  emphasis: { owner: 'canvas', enabled: true },
  banner: { owner: 'canvas', enabled: true },
  subtitle: { owner: 'ffmpeg', enabled: false },
  footer: { owner: 'canvas', enabled: true },
}

export class RenderManifest {
  constructor(layers = {}) {
    this.layers = { ...DEFAULT_MANIFEST, ...layers }
  }

  canRender(layer, owner) {
    const entry = this.layers[layer]
    if (!entry) return false
    return entry.enabled && entry.owner === owner
  }

  owner(layer) {
    return this.layers[layer]?.owner ?? null
  }

  isEnabled(layer) {
    return this.layers[layer]?.enabled ?? false
  }

  validate() {
    const issues = []
    for (const [layer, entry] of Object.entries(this.layers)) {
      if (!LAYER_OWNERS.includes(entry.owner)) {
        issues.push(`${layer}: unknown owner '${entry.owner}' (allowed: ${LAYER_OWNERS.join(', ')})`)
      }
    }
    return issues
  }
}

// Derive the render manifest from engine options. Defaults keep the canvas
// pipeline as the single text authority: no FFmpeg subtitle burn and no
// footer.png composite unless explicitly requested.
export function resolveRenderManifest(options = {}) {
  return new RenderManifest({
    subtitle: { owner: 'ffmpeg', enabled: !!options.burnSubtitles },
    footer: { owner: 'canvas', enabled: options.footer !== false },
  })
}

// Decide which FFmpeg-level compositing steps may run for this render.
// overlayFooter (footer.png) is only allowed when the canvas footer is
// disabled — mutual exclusion: one owner per semantic layer.
export function resolveRenderGates(options = {}, manifest = resolveRenderManifest(options)) {
  const issues = manifest.validate()
  if (issues.length) throw new Error(`RenderManifest invalid: ${issues.join('; ')}`)
  return {
    burnSubtitles: manifest.canRender('subtitle', 'ffmpeg'),
    overlayFooter: !!options.overlayFooter && !manifest.canRender('footer', 'canvas'),
  }
}
