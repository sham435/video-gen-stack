import { execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'

const REMOTION_DIR = join(process.cwd(), 'remotion')

export async function renderWithRemotion({ headline, source, publishedAt, category = 'technology' } = {}) {
  const tmpPath = join(tmpdir(), `remotion_${Date.now()}.mp4`)
  const props = JSON.stringify({ headline: (headline || '').slice(0, 200), source: (source || '').slice(0, 60), publishedAt, category })

  execFileSync(
    'npx',
    ['remotion', 'render', join(REMOTION_DIR, 'src/index.ts'), 'TechNews', tmpPath, `--props=${props}`, '--log=error', '--overwrite'],
    { stdio: 'pipe', timeout: 120000, cwd: REMOTION_DIR }
  )
  return tmpPath
}
