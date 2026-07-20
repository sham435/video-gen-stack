import { execSync } from 'child_process'
import { writeFileSync, existsSync } from 'fs'

export function buildNarrationScript(article) {
  const title = article.title || ''
  const source = article.source || 'Tech News'
  return `${title}. According to ${source}.`
}

export async function generateTTS(script, outPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'

  if (apiKey) {
    try {
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: script,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.5 },
        }),
      })
      const buffer = await resp.arrayBuffer()
      writeFileSync(outPath, Buffer.from(buffer))
      console.log('✅ ElevenLabs TTS generated')
      return outPath
    } catch (e) {
      console.log('ElevenLabs failed, falling back to edge-tts:', e.message)
    }
  }

  // Fallback: edge-tts (free, no API key needed)
  try {
    execSync(`edge-tts --voice en-US-GuyNeural --text "${script.slice(0, 300)}" --write-media "${outPath}"`, { stdio: 'pipe', timeout: 30000 })
    console.log('✅ Edge TTS generated')
  } catch {
    // Final fallback: silent
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 5 "${outPath}"`, { stdio: 'pipe', timeout: 10000 })
  }
  return outPath
}
