
import fs from 'fs'
import { execSync } from 'child_process'

let edgeTtsChecked = false

function ensureEdgeTts() {
  if (edgeTtsChecked) return
  try {
    execSync('edge-tts --list-voices 2>/dev/null', { stdio: 'pipe', timeout: 5000 })
  } catch {
    console.log('Installing edge-tts...')
    execSync('pip install edge-tts -q', { stdio: 'pipe', timeout: 30000 })
  }
  edgeTtsChecked = true
}

export async function generateTTS(text, outPath='output/voice.mp3'){
  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'N2lVS1w4EtoT3F4G4C2d'

  if (apiKey) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method:'POST',
        headers:{'xi-api-key': apiKey, 'Content-Type':'application/json'},
        body: JSON.stringify({
          text: text.slice(0, 2500),
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true }
        })
      })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        fs.mkdirSync('output', { recursive: true })
        fs.writeFileSync(outPath, buf)
        console.log('TTS (ElevenLabs):', outPath, `(${(buf.length / 1024).toFixed(0)}KB)`)
        return outPath
      }
      console.log(`ElevenLabs ${res.status}, falling back to edge-tts`)
    } catch(e) { console.log('ElevenLabs error:', e.message) }
  }

  ensureEdgeTts()
  const escaped = text.replace(/"/g, '\"').replace(/'/g, "'\\''").slice(0, 800)
  try {
    execSync(`edge-tts --voice en-US-AriaNeural --text "${escaped}" --write-media ${outPath}`, { stdio: 'inherit', timeout: 30000 })
    console.log('TTS (edge-tts):', outPath)
    return outPath
  } catch {
    console.log('edge-tts failed, using espeak fallback')
    execSync(`espeak "${text.slice(0, 500).replace(/"/g, '\\"')}" --stdout > ${outPath}`, { stdio: 'inherit' })
    return outPath
  }
}

export function buildNarrationScript(article){
  const parts = [article.title]
  if (article.summary) parts.push(article.summary)
  if (article.description) parts.push(article.description?.split('.')?.[0])
  parts.push('Follow for more tech news.')
  return parts.join('. ').slice(0, 2500)
}
