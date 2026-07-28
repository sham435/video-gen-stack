import { execSync } from 'child_process'
import fs from 'fs'

const NEWS_VOICE_ID = 'N2lVS1w4EtoT3F4G4C2d'

export class VoiceSync {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY
    this.voiceId = process.env.ELEVENLABS_VOICE_ID || NEWS_VOICE_ID
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

  async generateTTS(text, outPath) {
    if (!this.apiKey) {
      return this.fallbackTTS(text, outPath)
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text.slice(0, 2500),
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.85,
            style: 0.45,
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!res.ok) {
      console.warn(`ElevenLabs returned ${res.status}, falling back to edge-tts`)
      return this.fallbackTTS(text, outPath)
    }

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1024) {
      console.warn(`ElevenLabs response suspiciously small (${buf.length}B), falling back to edge-tts`)
      return this.fallbackTTS(text, outPath)
    }

    fs.mkdirSync('output', { recursive: true })
    fs.writeFileSync(outPath, buf)

    if (!this.validateAudio(outPath)) {
      console.warn('ElevenLabs output is not valid audio, falling back to edge-tts')
      return this.fallbackTTS(text, outPath)
    }

    console.log('News narration generated:', outPath, `(${(buf.length / 1024).toFixed(0)}KB)`)
    return outPath
  }

  validateAudio(audioPath) {
    try {
      const dur = parseFloat(
        execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
        ).toString()
      )
      return dur > 0.5
    } catch {
      return false
    }
  }

  async fallbackTTS(text, outPath) {
    const sanitized = text.replace(/"/g, '\\"').slice(0, 1000)
    try {
      execSync(
        `edge-tts --voice en-US-AriaNeural --text "${sanitized}" --write-media "${outPath}"`,
        { stdio: 'inherit', timeout: 60000 }
      )
      if (this.validateAudio(outPath)) {
        console.log('TTS via edge-tts:', outPath)
        return outPath
      }
      console.warn('edge-tts produced invalid audio, falling back to espeak')
    } catch (e) {
      console.warn('edge-tts failed:', e.message)
    }

    execSync(
      `espeak "${text.slice(0, 500)}" --stdout > "${outPath}"`,
      { stdio: 'inherit' }
    )
    console.log('TTS via espeak:', outPath)
    return outPath
  }

  getDuration(audioPath) {
    try {
      return parseFloat(
        execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
        ).toString()
      )
    } catch {
      return 15
    }
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
      let cmd = ''
      switch (type) {
        case 'impact':
          cmd = `ffmpeg -y -f lavfi -i "sine=f=80:r=48000,afade=t=out:st=0.2:d=0.1,volume=1.0" -c:a mp3 "${outPath}"`
          break
        case 'whoosh':
          cmd = `ffmpeg -y -f lavfi -i "anoisesrc=d=0.5:c=white:a=0.3,afade=t=in:st=0:d=0.05,afade=t=out:st=0.3:d=0.2,volume=0.3" -c:a mp3 "${outPath}"`
          break
        case 'suspense':
          cmd = `ffmpeg -y -f lavfi -i "sine=f=55:r=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=1.5:d=0.3,volume=0.2" -c:a mp3 "${outPath}"`
          break
        case 'reveal':
          cmd = `ffmpeg -y -f lavfi -i "sine=f=220:r=48000,afade=t=in:st=0:d=0.1,afade=t=out:st=0.8:d=0.2,volume=0.35" -c:a mp3 "${outPath}"`
          break
        default:
          return
      }
      execSync(cmd, { stdio: 'pipe', timeout: 10000 })
    } catch {}
  }

  generateIntroAudio(outPath) {
    try {
      const parts = [
        '-f lavfi -t 0.3 -i "sine=f=80:r=48000,afade=t=out:st=0.25:d=0.05,volume=1.0"',
        '-f lavfi -t 0.8 -i "sine=f=120:r=48000,afade=t=out:st=0.7:d=0.1,volume=0.5"',
        '-f lavfi -t 0.5 -i "sine=f=60:r=48000,afade=t=out:st=0.4:d=0.1,volume=0.8"',
        '-f lavfi -t 12 -i "anoisesrc=d=12:c=pink:a=0.06:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=11:d=1,volume=0.35"',
        '-f lavfi -t 12 -i "sine=f=55:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=11.5:d=0.5,volume=0.12"',
      ]

      const cmd = `ffmpeg -y ${parts.join(' ')} \
        -filter_complex "[0:a]adelay=0|0[hit1];[1:a]adelay=300|300[hit2];[2:a]adelay=2500|2500[hit3];[3:a][4:a]amix=inputs=2:duration=longest:normalize=0,volume=0.4[bed];[hit1][hit2][hit3][bed]amix=inputs=4:duration=longest:normalize=0,volume=0.65,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=11.5:d=0.5[a]" \
        -map "[a]" -c:a mp3 -b:a 192k "${outPath}"`

      execSync(cmd, { stdio: 'pipe', timeout: 15000 })
      console.log('Intro audio generated')
    } catch {}
  }
}
