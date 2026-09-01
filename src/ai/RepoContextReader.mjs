// Repo-aware context reader for StoryDirector prompts.
//
// Injects the ACTUAL render-contract rules from the repo (caption caps, scene
// types, narrative states) into the LLM prompt so the model stops inventing
// over-length captions in the first place — rather than relying only on
// ScenePlanner's post-hoc truncation. The prompt reflects the REAL limits the
// renderer enforces (never guessed numbers).

import { BROADCAST_TEXT } from '../style/text-tokens.mjs'
import { NARRATIVE_STATES } from '../video/NarrativeTextComposition.mjs'

const SCENE_TYPES = ['hook', 'fact', 'reveal', 'explanation', 'reaction', 'close']

export class RepoContextReader {
  // Deterministic render-contract rules extracted from the source of truth.
  contract() {
    const caption = BROADCAST_TEXT.caption || {}
    const close = BROADCAST_TEXT.close || {}
    return {
      format: '16:9 YouTube, canvas 1920x1080 / logical 1280x720',
      narrativeStates: NARRATIVE_STATES,
      sceneTypes: SCENE_TYPES,
      caption: {
        maxChars: caption.maxChars ?? 80,
        maxLines: caption.maxLines ?? 2,
        absoluteMaxLines: 3,
        minSize: caption.minSize ?? 32,
      },
      centerStage: { x: '50%', y: '50%' },
      finalScene: 'close — fixed NEWS-MONSTER brand outro, article words never appear',
    }
  }

  // The full context block appended to the StoryDirector system prompt.
  build() {
    const c = this.contract()
    return [
      '## REPO RENDER CONTRACT (ENFORCED — DO NOT VIOLATE)',
      `Format: ${c.format}.`,
      `Narrative states are SEQUENTIAL and mutually exclusive: ${c.narrativeStates.join(' → ')}.`,
      `Scene types: ${c.sceneTypes.join(', ')}.`,
      '',
      'CAPTION LIMITS (hard, enforced by the renderer):',
      `- maxChars: ${c.caption.maxChars}`,
      `- maxLines: ${c.caption.maxLines} (absolute max ${c.caption.absoluteMaxLines})`,
      `- prefer 3-8 words; never exceed 12 words`,
      `- caption is centered at x=${c.centerStage.x}, y=${c.centerStage.y} — NOT a lower-third, NOT bottom-aligned`,
      '',
      'NARRATION = AUDIO ONLY. It is spoken by the voice, never rendered as',
      'visual text. caption.fullText is the ONLY visual text for narration.',
      '',
      `Final scene: ${c.finalScene}.`,
    ].join('\n')
  }
}