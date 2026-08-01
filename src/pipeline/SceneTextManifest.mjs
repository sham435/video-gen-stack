// Scene Text Manifest — single source of truth for all text layers in a scene.
// Every scene produces structured TextObjects instead of raw strings, so the
// renderer never independently guesses emphasis vs caption intent.
export class SceneTextManifest {
  static build(scene) {
    const layers = []

    // Emphasis layer (large animated keyword) — highest priority
    const emphasis = scene.caption_focus || scene.focus || scene.keyword
    if (emphasis) {
      layers.push({
        type: 'emphasis',
        text: String(emphasis).toUpperCase(),
        priority: 10,
        position: 'top',
        id: `${scene.id || 0}-emphasis`,
      })
    }

    // Headline layer (for hook/fact scenes)
    if (scene.text && !['brand_close'].includes(scene.type)) {
      layers.push({
        type: 'headline',
        text: String(scene.text).toUpperCase(),
        priority: 8,
        position: 'top_center',
        id: `${scene.id || 0}-headline`,
      })
    }

    // Caption layer (subtitle) — lowest priority
    if (scene.caption || scene.narration) {
      layers.push({
        type: 'caption',
        text: scene.caption || scene.narration,
        priority: 5,
        position: 'bottom',
        id: `${scene.id || 0}-caption`,
      })
    }

    // Source/CTA layer
    if (scene.source_label || (scene.type === 'brand_close' && scene.cta)) {
      layers.push({
        type: 'source',
        text: scene.source_label || scene.cta,
        priority: 3,
        position: 'bottom_right',
        id: `${scene.id || 0}-source`,
      })
    }

    return {
      scene_id: scene.id || 0,
      type: scene.type || 'fact',
      text_layers: layers,
    }
  }
}
