import fs from 'fs'
import { execFileSync } from 'child_process'

// Minimum plausible mp4 size before we treat it as corrupt/truncated (100 KB).
const MIN_SIZE = 1024 * 100

// A valid file of zero frames / sub-second duration is not publishable.
const MIN_DURATION = 0

// RENDER-001: canonical render-output validator. Never trust file existence or
// the FFmpeg exit code alone — a killed/mid-write stage can leave a file on
// disk that ffmpeg exited 0 for but that no consumer (YouTube, LinkedIn,
// ffprobe) can open (e.g. missing moov atom, truncated mdat tail).
//
// Returns { ok, errors, diagnostics } — errors are stable machine-checkable
// codes; diagnostics carry the raw ffprobe observations (size, duration,
// stream table) so callers can log what was actually probed.
export async function validateRenderOutput(videoPath, options = {}) {
  const errors = []
  const diagnostics = { path: videoPath }
  const { minSize = MIN_SIZE, requireAudio = true, minDuration = MIN_DURATION } = options

  if (!videoPath) {
    return { ok: false, errors: ['VIDEO_PATH_MISSING'], diagnostics }
  }

  if (!fs.existsSync(videoPath)) {
    return { ok: false, errors: ['FILE_MISSING'], diagnostics }
  }

  let stat
  try {
    stat = fs.statSync(videoPath)
  } catch {
    return { ok: false, errors: ['FILE_UNREADABLE'], diagnostics }
  }
  diagnostics.size = stat.size

  if (!stat.isFile()) {
    errors.push('NOT_A_FILE')
  }

  if (stat.size < minSize) {
    errors.push(`FILE_TOO_SMALL:${stat.size}`)
  }

  const moov = detectMoovAtom(videoPath)
  diagnostics.moovDetected = moov
  if (!moov) {
    errors.push('MOOV_ATOM_MISSING')
  }

  let probe
  try {
    probe = probeWithFfprobe(videoPath)
    diagnostics.duration = probe.duration
    diagnostics.streams = probe.streams
    diagnostics.hasVideo = probe.hasVideo
    diagnostics.hasAudio = probe.hasAudio
    diagnostics.format = probe.format
  } catch (err) {
    errors.push(`FFPROBE_FAILED:${err.stderr ? String(err.stderr).trim().slice(0, 200) : err.message}`)
  }

  if (probe) {
    if (!(probe.duration > minDuration)) {
      errors.push('ZERO_DURATION')
    }
    if (!probe.hasVideo) {
      errors.push('NO_VIDEO_STREAM')
    }
    if (requireAudio && !probe.hasAudio) {
      errors.push('NO_AUDIO_STREAM')
    }
  }

  return { ok: errors.length === 0, errors, diagnostics }
}

// Backward-compatible alias: pre-RENDER-001 callers imported validateOutput.
export const validateOutput = validateRenderOutput

function probeWithFfprobe(videoPath) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration:format=format_name',
      '-show_entries', 'stream=codec_type:stream=codec_name:stream=width:stream=height',
      '-of', 'json',
      videoPath,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const parsed = JSON.parse(out)
  const duration = Number.parseFloat(parsed?.format?.duration) || 0
  const streams = (parsed?.streams || []).map((s) => ({
    type: s.codec_type,
    codec: s.codec_name,
    width: s.width,
    height: s.height,
  }))
  return {
    duration,
    streams,
    hasVideo: streams.some((s) => s.type === 'video'),
    hasAudio: streams.some((s) => s.type === 'audio'),
    format: parsed?.format?.format_name || 'unknown',
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