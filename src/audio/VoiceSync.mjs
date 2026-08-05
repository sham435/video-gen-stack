import { execFileSync } from 'child_process'
import fs from 'fs'

// NEWS-MONSTER voice profile — every video uses THIS voice. The old default
// (N2lVS1w4EtoT3F4G4C2d) was deleted on the account and returned 404, which
// silently cascaded to espeak and produced the robotic narration on the
// regen uploads. Never let that happen again:
//   ElevenLabs (premium, retried) -> edge-tts (human) -> FAIL (no espeak)
const NEWS_VOICE_ID = 'cjVigY5qzO86Huf0OWal' // Eric — Smooth, Trustworthy

const VOICE_PROFILE = {
  provider: process.env.VOICE_PROVIDER || 'elevenlabs',
  voiceId: process.env.ELEVENLABS_VOICE_ID || NEWS_VOICE_ID,
  modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
  stability: parseFloat(process.env.ELEVENLABS_STABILITY || '0.55'),
  similarity: parseFloat(process.env.ELEVENLABS_SIMILARITY || '0.85'),
  style: parseFloat(process.env.ELEVENLABS_STYLE || '0.30'),
  useSpeakerBoost: true,
}

const MAX_RETRIES = 3
const MIN_AUDIO_BYTES = 1024
const MIN_DURATION = 0.5

function retryDelay(attempt) {
  return 1500 * Math.pow(2, attempt - 1) // 1.5s, 3s, 6s
}

export class VoiceSync {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY
    this.profile = { ...VOICE_PROFILE }
    this.lastReport = null
  }

  async generateNarration(scenes, outPath = 'output/voice.mp3') {
    const script = this.buildNarrationScript(scenes)
    return this.generateTTS(script, outPath)
  }

  buildNarrationScript(scenes) {
    return scenes
      .filter(s => s.type !== 'hook' && s.type !== 'brand_close')
      .map(s => s.text)
      .join(' ')
  }

  // Premium-first voice generation. Returns the audio path and records a
  // quality report in this.lastReport. Throws when no human-quality voice
  // could be produced — the pipeline must fail the render rather than
  // publish robotic narration.
  async generateTTS(text, outPath) {
    const script = text.slice(0, 2500)
    if (this.apiKey) {
      try {
        const path = await this.elevenLabsWithRetry(script, outPath)
        this.lastReport = this.measure(path, 'elevenlabs')
        return path
      } catch (e) {
        console.warn(`[TTS] ElevenLabs failed after retries: ${e.message}`)
      }
    } else {
      console.warn('[TTS] ELEVENLABS_API_KEY missing — falling back to edge-tts')
    }

    const edgePath = this.edgeTTS(script, outPath)
    if (edgePath) {
      this.lastReport = this.measure(edgePath, 'edge-tts')
      return edgePath
    }

    if (process.env.ALLOW_SPEAK_FALLBACK === '1') {
      console.warn('[TTS] WARNING: generating espeak narration — dev only, never publish this')
      execFileSync('espeak', [text.slice(0, 500), '-w', outPath], { stdio: 'inherit' })
      this.lastReport = this.measure(outPath, 'espeak')
      return outPath
    }

    throw new Error(
      'Voice generation failed: ElevenLabs retries exhausted and edge-tts unavailable. ' +
      'Refusing to narrate with espeak — fix ELEVENLABS_API_KEY/VOICE_ID or install edge-tts.'
    )
  }

  async elevenLabsWithRetry(text, outPath) {
    let lastErr = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.elevenLabsOnce(text, outPath)
      } catch (e) {
        lastErr = e
        if (!e.retryable) throw e // misconfig: 404 voice / 401 key — never retried
        console.warn(`[TTS] ElevenLabs attempt ${attempt}/${MAX_RETRIES} failed (${e.message}) — retrying in ${retryDelay(attempt)}ms`)
        await new Promise(r => setTimeout(r, retryDelay(attempt)))
      }
    }
    throw lastErr
  }

  async elevenLabsOnce(text, outPath) {
    const { voiceId, modelId, stability, similarity, style, useSpeakerBoost } = this.profile
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability,
            similarity_boost: similarity,
            style,
            use_speaker_boost: useSpeakerBoost,
          },
        }),
      }
    )

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`voice ${voiceId} not found (404) — update ELEVENLABS_VOICE_ID`)
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`ElevenLabs auth ${res.status} — check ELEVENLABS_API_KEY`)
      }
      const retryable = res.status === 429 || res.status >= 500
      const err = new Error(`ElevenLabs ${res.status} ${res.statusText}`)
      err.retryable = retryable
      throw err
    }

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < MIN_AUDIO_BYTES) {
      const err = new Error(`ElevenLabs response suspiciously small (${buf.length}B)`)
      err.retryable = true
      throw err
    }

    fs.mkdirSync('output', { recursive: true })
    fs.writeFileSync(outPath, buf)

    if (!this.validateAudio(outPath)) {
      const err = new Error('ElevenLabs output is not valid audio')
      err.retryable = true
      throw err
    }

    console.log(`TTS (ElevenLabs ${this.profile.voiceId}):`, outPath, `(${(buf.length / 1024).toFixed(0)}KB)`)
    return outPath
  }

  edgeTTS(text, outPath) {
    const args = ['--voice', 'en-US-AriaNeural', '--text', text.slice(0, 1000), '--write-media', outPath]
    try {
      execFileSync('edge-tts', args, { stdio: 'pipe', timeout: 60000 })
      if (this.validateAudio(outPath)) {
        console.log('TTS (edge-tts en-US-AriaNeural):', outPath)
        return outPath
      }
      console.warn('[TTS] edge-tts produced invalid audio')
    } catch (e) {
      console.warn(`[TTS] edge-tts failed: ${e.message}`)
    }
    // fallback invocation when the binary is not on PATH (python3 user install)
    try {
      execFileSync('python3', ['-m', 'edge_tts', ...args], { stdio: 'pipe', timeout: 60000 })
      if (this.validateAudio(outPath)) {
        console.log('TTS (edge-tts via python -m edge_tts):', outPath)
        return outPath
      }
      console.warn('[TTS] edge-tts (python -m) produced invalid audio')
    } catch (e) {
      console.warn(`[TTS] edge-tts (python -m) failed: ${e.message}`)
    }
    return null
  }

  validateAudio(audioPath) {
    try {
      const dur = parseFloat(
        execFileSync(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath]
        ).toString()
      )
      return dur > MIN_DURATION
    } catch {
      return false
    }
  }

  getDuration(audioPath) {
    try {
      return parseFloat(
        execFileSync(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath]
        ).toString()
      )
    } catch {
      return 15
    }
  }

  // Lightweight voice-quality gate: provider + duration + average loudness
  // (dBFS via ffmpeg astats). Pipeline logs this; a fail-too-quiet threshold
  // is enforced by the caller when configured.
  measure(audioPath, provider) {
    let meanVolume = null
    let maxVolume = null
    try {
      const out = execFileSync(
        'sh',
        ['-c', 'ffmpeg -i "$1" -af astats=metadata=1 -f null - 2>&1', 'sh', audioPath],
        { timeout: 15000, encoding: 'utf8' }
      )
      const rm = /RMS level dB:\s*(-?[\d.]+)/.exec(out)
      const pk = /Peak level dB:\s*(-?[\d.]+)/.exec(out)
      if (rm) meanVolume = parseFloat(rm[1])
      if (pk) maxVolume = parseFloat(pk[1])
    } catch { /* metrics are best-effort */ }
    const report = {
      provider,
      voiceId: provider === 'elevenlabs' ? this.profile.voiceId : null,
      durationSec: this.getDuration(audioPath),
      meanVolumeDb: meanVolume,
      maxVolumeDb: maxVolume,
      generatedAt: new Date().toISOString(),
    }
    console.log(`[VOICE-QA] ${JSON.stringify(report)}`)
    return report
  }

  generateSceneAudio(scenes, outDir = 'output') {
    fs.mkdirSync(outDir, { recursive: true })

    for (const scene of scenes) {
      if (!scene.audio) continue
      this.generateAudioEffect(scene.audio, `${outDir}/sfx_${scene.id}.mp3`)
    }

    const introPath = `${outDir}/intro_audio.mp3`
    this.generateIntroAudio(introPath)
    return introPath
  }

  generateAudioEffect(type, outPath) {
    try {
      let args = ['-y']
      switch (type) {
        case 'impact':
          args = ['-y', '-f', 'lavfi', '-i', 'sine=f=80:r=48000,afade=t=out:st=0.2:d=0.1,volume=1.0', '-c:a', 'mp3', outPath]
          break
        case 'whoosh':
          args = ['-y', '-f', 'lavfi', '-i', 'anoisesrc=d=0.5:c=white:a=0.3,afade=t=in:st=0:d=0.05,afade=t=out:st=0.3:d=0.2,volume=0.3', '-c:a', 'mp3', outPath]
          break
        case 'suspense':
          args = ['-y', '-f', 'lavfi', '-i', 'sine=f=55:r=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=1.5:d=0.3,volume=0.2', '-c:a', 'mp3', outPath]
          break
        case 'reveal':
          args = ['-y', '-f', 'lavfi', '-i', 'sine=f=220:r=48000,afade=t=in:st=0:d=0.1,afade=t=out:st=0.8:d=0.2,volume=0.35', '-c:a', 'mp3', outPath]
          break
        default:
          return
      }
      execFileSync('ffmpeg', args, { stdio: 'pipe', timeout: 10000 })
    } catch {}
  }

  generateIntroAudio(outPath) {
    try {
      const args = [
        '-y',
        '-f', 'lavfi', '-t', '0.3', '-i', 'sine=f=80:r=48000,afade=t=out:st=0.25:d=0.05,volume=1.0',
        '-f', 'lavfi', '-t', '0.8', '-i', 'sine=f=120:r=48000,afade=t=out:st=0.7:d=0.1,volume=0.5',
        '-f', 'lavfi', '-t', '0.5', '-i', 'sine=f=60:r=48000,afade=t=out:st=0.4:d=0.1,volume=0.8',
        '-f', 'lavfi', '-t', '12', '-i', 'anoisesrc=d=12:c=pink:a=0.06:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=11:d=1,volume=0.35',
        '-f', 'lavfi', '-t', '12', '-i', 'sine=f=55:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=11.5:d=0.5,volume=0.12',
        '-filter_complex', '[0:a]adelay=0|0[hit1];[1:a]adelay=300|300[hit2];[2:a]adelay=2500|2500[hit3];[3:a][4:a]amix=inputs=2:duration=longest:normalize=0,volume=0.4[bed];[hit1][hit2][hit3][bed]amix=inputs=4:duration=longest:normalize=0,volume=0.65,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=11.5:d=0.5[a]',
        '-map', '[a]', '-c:a', 'mp3', '-b:a', '192k', outPath,
      ]

      execFileSync('ffmpeg', args, { stdio: 'pipe', timeout: 15000 })
      console.log('Intro audio generated')
    } catch {}
  }
}
