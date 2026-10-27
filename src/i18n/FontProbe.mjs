/**
 * FontProbe — verifies the CANVAS RENDERER can resolve the pack's fonts.
 *
 * ShapedText draws Indic text via harfbuzzjs+opentype.js glyph outlines and
 * never goes through ctx.font — but any Latin/digit fallback inside a
 * localized frame DOES use native fillText, which resolves families from
 * @napi-rs/canvas's GlobalFonts registry. Registering the Noto files under
 * the pack's family here makes native fallback resolvable AND proves the
 * binary can actually load the font files (a parse failure at the Skia
 * level would otherwise surface mid-render as invisible text).
 *
 * Idempotent: registering the same file under the same family is a no-op.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function DesignSystemFontProbe(pack) {
  const name = 'canvas-registered'
  if (!pack || !pack.fontFiles || !pack.fontFiles.length) {
    return { name, pass: true, detail: 'no pack fonts (native canvas path)' }
  }
  try {
    const { GlobalFonts } = await import('@napi-rs/canvas')
    let registered = 0
    for (const rel of pack.fontFiles) {
      const abs = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel)
      // Existence is hard-asserted by the preflight's file check; here we
      // simply skip (pass/fail is decided by GlobalFonts.has below).
      if (!fs.existsSync(abs)) continue
      if (GlobalFonts.registerFromPath(abs, pack.fontFamily)) registered++
    }
    const familyKnown = GlobalFonts.has(pack.fontFamily)
    return {
      name,
      pass: familyKnown,
      detail: `registered ${registered}/${pack.fontFiles.length} under "${pack.fontFamily}" — GlobalFonts.has("${pack.fontFamily}")=${familyKnown}`,
    }
  } catch (e) {
    return { name, pass: false, detail: `GlobalFonts registration failed: ${e.message}` }
  }
}
