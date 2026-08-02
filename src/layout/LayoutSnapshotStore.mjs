// LayoutSnapshotStore — records validated scene layouts as JSON snapshots
// for regression testing. Each snapshot captures the full geometry contract
// (font size, wrapped lines, box, position, safe zone) so layout regressions
// are caught by diffing, not by eyeballing frames.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_FILE = new URL('../../snapshots/layout-snapshots.json', import.meta.url).pathname

export class LayoutSnapshotStore {
  // Snapshot entry for one scene layer.
  static record(scene, layout) {
    return {
      sceneId: String(scene.id ?? scene.sceneId ?? '?'),
      sceneType: scene.type || null,
      role: layout.role,
      priority: layout.priority,
      fontSize: layout.fontSize,
      lineHeight: layout.lineHeight,
      lines: layout.lines,
      width: layout.width,
      height: layout.height,
      x: layout.x,
      y: layout.y,
      scalePercent: layout.scalePercent,
      overflow: layout.overflow,
      safeZone: 'shorts',
    }
  }

  static load(file = DEFAULT_FILE) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return []
    }
  }

  static save(snapshots, file = DEFAULT_FILE) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(snapshots, null, 2) + '\n')
    return snapshots.length
  }

  // Append validated scene layouts to the snapshot store (env-gated in the
  // pipeline via LAYOUT_SNAPSHOTS=1; always safe to call — bounded append).
  static capture(scenes, file = DEFAULT_FILE, cap = 500) {
    const existing = LayoutSnapshotStore.load(file)
    for (const sc of scenes) {
      for (const role of ['emphasis', 'headline', 'caption', 'source']) {
        const layout = sc[`${role}Layout`]
        if (layout) existing.push(LayoutSnapshotStore.record(sc, layout))
      }
    }
    return LayoutSnapshotStore.save(existing.slice(-cap), file)
  }
}
