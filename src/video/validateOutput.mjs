import fs from 'fs'
import { execFileSync } from 'child_process'

// Minimum plausible mp4 size before we treat it as corrupt/truncated (100 KB).
const MIN_SIZE = 1024 * 100

// A valid file of zero frames / sub-second duration is not publishable.
const MIN_DURATION = 0

export async function validateOutput(videoPath, options = {}) {
  const errors = []
  const { minSize = MIN_SIZE, requireAudio = true } = options

  if (!videoPath) {
    return { ok: false, errors: ['VIDEO_PATH_MISSING'] }
  }

  if (!fs.existsSync(videoPath)) {
    return { ok: false, errors: ['FILE_MISSING'] }
  }

  let stat
  try {
    stat = fs.statSync(videoPath)
  } catch {
    return { ok: false, errors: ['FILE_UNREADABLE'] }
  }

  if (!stat.isFile()) {
    errors.push('NOT_A_FILE')
  }

  if (stat.size < minSize) {
    errors.push(`FILE_TOO_SMALL:${stat.size}`)
  }

  const moov = detectMoovAtom(videoPath)
  if (!moov) {
    errors.push('MOOV_ATOM_MISSING')
  }

  let probe
  try {
    probe = probeWithFfprobe(videoPath)
  } catch (err) {
    errors.push(`FFPROBE_FAILED:${err.stderr ? String(err.stderr).trim().slice(0, 200) : err.message}`)
  }

  if (probe) {
    if (!(probe.duration > MIN_DURATION)) {
      errors.push('ZERO_DURATION')
    }
    if (!probe.hasVideo) {
      errors.push('NO_VIDEO_STREAM')
    }
    if (requireAudio && !probe.hasAudio) {
      errors.push('NO_AUDIO_STREAM')
    }
  }

  return { ok: errors.length === 0, errors }
}

function probeWithFfprobe(videoPath) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-show_entries', 'stream=codec_type',
      '-of', 'json',
      videoPath,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const parsed = JSON.parse(out)
  const duration = Number.parseFloat(parsed?.format?.duration) || 0
  const types = (parsed?.streams || []).map((s) => s.codec_type)
  return {
    duration,
    hasVideo: types.includes('video'),
    hasAudio: types.includes('audio'),
  }
}

// Look for a 'moov' atom in the file bytes. `moov` sits either at the start
// (faststart / normalized) or at the end of an mp4, so we scan the first 16 MB
// and the final 2 MB. A rendered mp4 whose moov atom is entirely absent has
// been truncated and cannot be parsed by downstream consumers.
function detectMoovAtom(videoPath) {
  try {
    const size = fs.statSync(videoPath).size
    const scans = []
    scans.push({ start: 0, end: Math.min(size, 16 * 1024 * 1024) })
    if (size > 16 * 1024 * 1024) {
      scans.push({ start: Math.max(0, size - 2 * 1024 * 1024), end: size })
    }

    const fd = fs.openSync(videoPath, 'r')
    const chunk = Buffer.alloc(64 * 1024)
    try {
      for (const { start, end } of scans) {
        let offset = start
        while (offset < end) {
          const readLen = Math.min(chunk.length, end - offset)
          const bytes = fs.readSync(fd, chunk, 0, readLen, offset)
          if (bytes <= 0) break
          if (chunk.subarray(0, bytes).includes(Buffer.from('moov'))) return true
          offset += bytes
        }
      }
      return false
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}