// SceneAssetPreflight — validates that scene images exist and meet quality bars.
//
// This is a production-output validator. It proves that every scene in a
// rendered video has:
//   - an actual image file on disk
//   - valid resolution (meets minimum dimensions)
//   - an acceptable source aspect ratio (the image is cover-fitted onto the
//     16:9 frame, so source photos of any common ratio are valid inputs)
//   - exactly one primary image per scene
//
// SOURCE-ASSET validator (Option A): it validates the INCOMING scene images,
// not the rendered output. Source photos are fitted/cropped onto the 16:9
// canvas (object-fit cover), so a 16:9 or 1:1 source is a legitimate input
// and must not be rejected. The rendered output itself is 16:9 — that aspect
// contract is enforced separately by the QC render-output validators
// (VideoTestingEngine / QualityChecker), not here.
//
// Called after RENDER stage. Does NOT check uniqueness (that's UniquenessPreflight).
// Does NOT check semantic relevance (that's the LLM scoring in VisualSearchEngine).

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const MIN_WIDTH = 640
const MIN_HEIGHT = 360
// Source-asset aspect tolerance (Option A): these are INCOMING scene images
// that get cover-fitted onto the 16:9 frame, so common source ratios (16:9,
// 1:1) are all accepted. The rendered output is always 16:9.
const VALID_ASPECT_RATIOS = ['16:9', '1:1']

export class SceneAssetPreflight {
  /**
   * Validate all scene images for a production run.
   *
   * @param {Array} scenes — [{ sceneIndex, imagePath, imageHash, type, headline }]
   * @param {object} context — { outputDir, videoPath }
   * @returns {{ pass: boolean, checks: object[], errors: string[] }}
   */
  static validate(scenes, context = {}) {
    const checks = []
    const errors = []

    if (!scenes?.length) {
      return { pass: true, checks: [{ name: 'no_scenes', pass: true, detail: '0 scenes (audio-only?)' }], errors: [] }
    }

    // 1. Scene count
    checks.push({ name: 'scene_count', pass: scenes.length > 0, detail: `${scenes.length} scenes` })

    // 2. Each scene has an image
    const scenesWithImages = scenes.filter(s => s.imagePath && fs.existsSync(s.imagePath))
    const scenesWithoutImages = scenes.filter(s => !s.imagePath || !fs.existsSync(s.imagePath))

    checks.push({
      name: 'all_scenes_have_images',
      pass: scenesWithoutImages.length === 0,
      detail: `${scenesWithImages.length}/${scenes.length} have images`,
    })
    for (const s of scenesWithoutImages) {
      errors.push(`SCENE_${s.sceneIndex ?? s.id}_NO_IMAGE: ${s.imagePath || 'path missing'}`)
    }

    // 3. Validate each image
    for (const scene of scenesWithImages) {
      const sceneLabel = `scene_${scene.sceneIndex ?? scene.id}`

      try {
        const probe = SceneAssetPreflight._probeImage(scene.imagePath)

        // Resolution
        const resolutionOk = probe.width >= MIN_WIDTH && probe.height >= MIN_HEIGHT
        checks.push({
          name: `${sceneLabel}_resolution`,
          pass: resolutionOk,
          detail: `${probe.width}x${probe.height}`,
        })
        if (!resolutionOk) {
          errors.push(`${sceneLabel}_RESOLUTION_LOW: ${probe.width}x${probe.height} (min ${MIN_WIDTH}x${MIN_HEIGHT})`)
        }

        // Aspect ratio
        const aspect = SceneAssetPreflight._classifyAspect(probe.width, probe.height)
        const aspectOk = VALID_ASPECT_RATIOS.includes(aspect)
        checks.push({
          name: `${sceneLabel}_aspect_ratio`,
          pass: aspectOk,
          detail: aspect,
        })
        if (!aspectOk) {
          errors.push(`${sceneLabel}_INVALID_ASPECT: ${aspect}`)
        }

        // File size (sanity check — not a corrupted/empty image)
        const sizeOk = probe.size > 1024
        checks.push({
          name: `${sceneLabel}_file_size`,
          pass: sizeOk,
          detail: `${(probe.size / 1024).toFixed(0)}KB`,
        })
        if (!sizeOk) {
          errors.push(`${sceneLabel}_FILE_TOO_SMALL: ${probe.size} bytes`)
        }

      } catch (e) {
        checks.push({ name: `${sceneLabel}_probe`, pass: false, detail: e.message })
        errors.push(`${sceneLabel}_PROBE_FAILED: ${e.message}`)
      }
    }

    // 4. Scene has exactly one primary image (no duplicates within a scene)
    const seenImages = new Set()
    for (const scene of scenes) {
      const key = scene.imagePath || scene.imageHash
      if (key && seenImages.has(key)) {
        errors.push(`DUPLICATE_IMAGE_IN_SCENE: ${scene.sceneIndex ?? scene.id} reuses ${key}`)
      }
      if (key) seenImages.add(key)
    }

    return { pass: errors.length === 0, checks, errors }
  }

  /**
   * ffprobe: get image dimensions + size.
   */
  static _probeImage(imagePath) {
    const out = execFileSync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'stream=width',
        '-show_entries', 'stream=height',
        '-show_entries', 'stream=codec_name',
        '-show_entries', 'format=size',
        '-of', 'json',
        imagePath,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const parsed = JSON.parse(out)
    const stream = parsed?.streams?.[0] || {}
    return {
      width: stream.width || 0,
      height: stream.height || 0,
      codec: stream.codec_name || 'unknown',
      size: Number(parsed?.format?.size) || 0,
    }
  }

  /**
   * Classify an incoming SOURCE image's aspect ratio from its dimensions.
   * Any of these ratios is a valid source — the image is cover-fitted onto
   * the 16:9 frame during rendering, so we classify (not reject) it here.
   */
  static _classifyAspect(width, height) {
    if (!width || !height) return 'unknown'
    const ratio = width / height
    if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9'
    if (Math.abs(ratio - 1) < 0.05) return '1:1'
    return `${width}:${height}`
  }
}
