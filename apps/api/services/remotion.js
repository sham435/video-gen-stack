import { execSync } from 'child_process'
import { copyFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const REMOTION_DIR = join(process.cwd(), 'remotion')

export async function renderWithRemotion({ headline, source, publishedAt, category = 'technology' } = {}) {
  const tmpPath = join(tmpdir(), `remotion_${Date.now()}.mp4`)
  const props = JSON.stringify({ headline, source, publishedAt, category })

  const cmd = `npx remotion render "${join(REMOTION_DIR, 'src/index.ts')}" TechNews "${tmpPath}" --props='${props}' --log=error --overwrite`

  execSync(cmd, { stdio: 'pipe', timeout: 120000, cwd: REMOTION_DIR })
  return tmpPath
}
