import { execSync } from 'child_process'
import fs from 'fs'

export class SoundFX {
  constructor(sfxDir = 'output/sfx') {
    this.sfxDir = sfxDir
    fs.mkdirSync(sfxDir, { recursive: true })
  }

  generateBreakingImpact(outPath) {
    const cmd = `ffmpeg -y -f lavfi -i "sine=f=80:r=48000,d=0.4,afade=t=out:st=0.3:d=0.1,volume=1.2" \
      -f lavfi -i "anoisesrc=d=0.4:c=white:a=0.6,afade=t=in:st=0:d=0.01,afade=t=out:st=0.3:d=0.1,volume=0.4" \
      -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]" \
      -map "[a]" -c:a mp3 "${outPath}"`
    try { execSync(cmd, { stdio: 'pipe', timeout: 10000 }) } catch {}
    return outPath
  }

  generateTransitionWhoosh(outPath, type = 'fast') {
    const dur = type === 'fast' ? 0.3 : 0.6
    const cmd = `ffmpeg -y -f lavfi -i "anoisesrc=d=${dur}:c=brown:a=0.2:r=48000,afade=t=in:st=0:d=0.02,afade=t=out:st=${dur - 0.05}:d=${dur * 0.3},volume=0.25" \
      -c:a mp3 "${outPath}"`
    try { execSync(cmd, { stdio: 'pipe', timeout: 10000 }) } catch {}
    return outPath
  }

  generateAlertPing(outPath) {
    const cmd = `ffmpeg -y -f lavfi -i "sine=f=880:r=48000,d=0.15,afade=t=out:st=0.1:d=0.05,volume=0.5" \
      -f lavfi -i "sine=f=1320:r=48000,d=0.15,afade=t=in:st=0:d=0.01,afade=t=out:st=0.1:d=0.05,volume=0.3" \
      -filter_complex "[0:a]adelay=0|0[ping1];[1:a]adelay=180|180[ping2];[ping1][ping2]amix=inputs=2:duration=first:normalize=0[a]" \
      -map "[a]" -c:a mp3 "${outPath}"`
    try { execSync(cmd, { stdio: 'pipe', timeout: 10000 }) } catch {}
    return outPath
  }
}
