// TextPolicy — single source of truth for whether a text layer may render on
// a given scene. Every renderer (Compositor, CaptionLayer, EmphasisLayer,
// TextTimelineScheduler) consults this ONE gate instead of inlining its own
// outro checks. The close/brand_outro scene owns its text exclusively: the
// dedicated OutroRenderer (InformationLayer) prints the fixed end card, so
// story captions, generic caption scheduling and the AI-emphasis layer must
// never draw over it.
//
// Layer semantics:
//   'caption'  — word-synced story captions (scene.caption / narration)
//   'generic'  — generic caption scheduling driven by the timeline scheduler
//   'emphasis' — AI accent keyword layer (scene.caption_focus / scene.focus)
//
// Returns true when the layer is allowed to render for the scene. A scene
// without a textPolicy gate is assumed to be standard story content (true).

export function canRenderText(scene, layer) {
  if (!scene?.textPolicy) return true

  if (layer === 'caption' && scene.textPolicy.allowStoryCaptions === false) {
    return false
  }

  if (layer === 'generic' && scene.textPolicy.allowGenericCaptionScheduling === false) {
    return false
  }

  if (layer === 'emphasis' && scene.textPolicy.allowEmphasisLayer === false) {
    return false
  }

  return true
}

export const TEXT_POLICY = { canRenderText }
