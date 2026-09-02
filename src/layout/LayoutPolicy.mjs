// LayoutPolicy — retention-aware layout parameters. Feeds ViewerBehaviorModel
// risk/hazard signals into TextLayoutEngine as input constraints:
//   - text_overload risk        -> fewer caption lines, smaller caption
//   - strong hook / low hazard  -> bigger emphasis keyword
//   - repeated emphasis text    -> shorter headline layouts
// The policy only tunes parameters; the layout engine still guarantees the
// safe zone and legibility floors.

const DEFAULTS = {
  emphasis: { preferredFontSize: 120, maxLines: 1 },
  headline: { preferredFontSize: 92, maxLines: 2 },
  caption: { preferredFontSize: 58, maxLines: 2 },
  source: { preferredFontSize: 48, maxLines: 1 },
}

export class LayoutPolicy {
  static defaults() {
    return structuredClone(DEFAULTS)
  }

  // policyFor(scene, viewerBehaviorModel) -> per-role layout overrides.
  // scene must already carry caption/textManifest/hookScore (as the pipeline
  // has after the conflict resolver and hook analyzer run).
  static policyFor(scene, model) {
    const policy = LayoutPolicy.defaults()
    if (!model) return policy

    const risks = model.risks(scene) || []

    // Text overload: reduce caption density so viewers can actually read it
    if (risks.some(r => r.type === 'text_overload')) {
      policy.caption.preferredFontSize = 52
      policy.caption.maxLines = 1
    }

    // Strong opening: spend attention budget on a bigger emphasis keyword
    const hazard = model.hazard(scene)
    const strongHook = scene.type === 'hook' && (scene.hookScore ?? 0) >= 85
    if (strongHook || hazard < 0.010) {
      policy.emphasis.preferredFontSize = 150
    }

    // Repeated emphasis text: prefer shorter layouts over denser ones
    const emphasisCount = Array.isArray(scene.textManifest?.emphasis) ? scene.textManifest.emphasis.length : 0
    if (emphasisCount >= 3) {
      policy.headline.maxLines = 2
    }

    return policy
  }
}
