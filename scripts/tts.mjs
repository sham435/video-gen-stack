
import fs from 'fs'
import { execSync } from 'child_process'

export async function generateTTS(text, outPath='output/voice.mp3'){
  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM' // Rachel default

  if(!apiKey){
    console.log('No ELEVENLABS_API_KEY, using edge-tts fallback')
    // fallback free: edge-tts
    try{
      execSync(`pip install edge-tts -q && edge-tts --voice en-US-AriaNeural --text "${text.replace(/"/g,'\"').slice(0,800)}" --write-media ${outPath}`, {stdio:'inherit'})
      return outPath
    }catch{
      // ultimate fallback: espeak
      execSync(`espeak "${text.slice(0,500)}" --stdout > ${outPath}`, {stdio:'inherit'})
      return outPath
    }
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method:'POST',
    headers:{'xi-api-key': apiKey, 'Content-Type':'application/json'},
    body: JSON.stringify({
      text: text.slice(0, 2500),
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true }
    })
  })
  if(!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(outPath, buf)
  console.log('✅ TTS generated', outPath, buf.length)
  return outPath
}

export function buildNarrationScript(article){
  // YouTube friendly ~20 sec script
  return `${article.title}. According to ${article.source}, ${article.summary||article.title}. Latest tech update. Follow for more.`
}
