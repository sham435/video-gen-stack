import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'child_process'
import fs from 'fs'
import { UIStyleSelector } from '../ai/UIStyleSelector.mjs'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

const W = 1080, H = 1920, FPS = 30

export class IntroEngine {
  constructor() {
    this.uiStyle = new UIStyleSelector()
  }

  async generate({ brand = 'NEWS-MONSTER', duration = 12, category = 'technology', outDir = 'output' } = {}) {
    const style = this.uiStyle.getStyle(category)
    const totalFrames = duration * FPS
    const framesDir = `${outDir}/intro_frames`
    fs.mkdirSync(framesDir, { recursive: true })
    const pool = this.getCategoryPool(category)

    console.log(`Intro: ${duration}s, ${totalFrames}frames, category: ${category}`)
    for (let i = 0; i < totalFrames; i++) {
      const p = i / totalFrames
      this.drawFrame(p, pool, style, brand, `${framesDir}/f${String(i).padStart(4, '0')}.png`)
      if (i % 60 === 0) process.stdout.write(`  Intro ${i}/${totalFrames}\r`)
    }
    process.stdout.write(`  Intro ${totalFrames}/${totalFrames}\n`)

    const video = `${outDir}/intro_12s.mp4`
    const audio = `${outDir}/intro_audio.mp3`
    this.genAudio(audio, duration)
    execSync(`ffmpeg -y -framerate ${FPS} -i "${framesDir}/f%04d.png" -i "${audio}" -c:v libx264 -crf 20 -c:a aac -b:a 192k -shortest -t ${duration} "${video}"`, { stdio: 'inherit' })
    return { video, duration, fps: FPS, scenes: 4, category }
  }

  getCategoryPool(cat) {
    const m = {
      gaming: ['GAMING','TECH','AI','ESPORTS','RETRO','CONSOLES','FUTURE'],
      sports: ['SPORTS','STADIUM','ATHLETES','SCORES','CHAMPIONS','FANS','FUTURE'],
      politics: ['POLITICS','POLICY','GLOBAL','ELECTION','BREAKING','ANALYSIS','FUTURE'],
      science: ['SCIENCE','DISCOVERY','SPACE','BIOTECH','QUANTUM','CLIMATE','FUTURE'],
      space: ['SPACE','NASA','STARS','MARS','MOON','SATELLITE','FUTURE'],
    }
    return m[cat] || ['TECH','SCIENCE','AI','SPACE','GAMING','POLITICS','FUTURE']
  }

  drawFrame(p, pool, style, brand, path) {
    const c = createCanvas(W, H), ctx = c.getContext('2d')
    if (p < 2/12) this.signal(ctx, p/(2/12))
    else if (p < 4.5/12) this.hook(ctx, (p-2/12)/(2.5/12), style)
    else if (p < 7.5/12) this.scope(ctx, (p-4.5/12)/(3/12), pool)
    else this.lock(ctx, (p-7.5/12)/(4.5/12), brand)
    ctx.font = '500 28px Inter,sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(brand, 12, 12)
    fs.writeFileSync(path, c.toBuffer('image/png'))
  }

  signal(ctx, p) {
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H)
    const pp = Math.min(1, p*2)
    for (let i = 0; i < 30; i++) {
      const x = (i*37+pp*400)%W, y = (i*73)%H, len = 10+Math.sin(i+pp*20)*15
      ctx.fillStyle = i%2===0 ? `rgba(255,0,0,${0.05+Math.random()*0.15})` : `rgba(255,255,255,${0.05+Math.random()*0.1})`
      ctx.fillRect(x, y, 2, len)
    }
    for (let i = 0; i < 80; i++) {
      const sx = (i*47.5+pp*600)%W, sy = (i*31.7+pp*300)%H
      ctx.fillStyle = `rgba(255,255,255,${0.02+Math.random()*0.06})`
      ctx.beginPath(); ctx.arc(sx, sy, 1+Math.random()*2, 0, Math.PI*2); ctx.fill()
    }
  }

  hook(ctx, p, style) {
    const g = ctx.createRadialGradient(W/2, H*0.3, 0, W/2, H*0.3, W*0.8)
    g.addColorStop(0,'#0A0A0A'); g.addColorStop(1,'#000')
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H)
    const cx=W*0.78, cy=H*0.35, r=200
    ctx.strokeStyle = `rgba(0,255,255,${0.15+Math.sin(p*3)*0.05})`; ctx.lineWidth = 1
    for (let lat = 0; lat < 4; lat++) {
      const la = (lat/4)*Math.PI-Math.PI/2, rr = r*Math.cos(la), yy = cy+r*Math.sin(la)
      if (rr > 5) { ctx.beginPath(); ctx.ellipse(cx, yy, rr, rr*0.3, 0, 0, Math.PI*2); ctx.stroke() }
    }
    for (let lon = 0; lon < 5; lon++) {
      const lo = (lon/5)*Math.PI*2+p*0.3; ctx.beginPath()
      for (let t = 0; t <= 40; t++) {
        const a = (t/40)*Math.PI*2, px = cx+r*0.45*Math.cos(a+lo), py = cy+r*0.3*Math.sin(a)
        t===0?ctx.moveTo(px,py):ctx.lineTo(px,py)
      }; ctx.stroke()
    }
    const pp = Math.min(1, p*1.5), txt='UNFILTERED', ch=txt.split('')
    ctx.font = '900 100px Anton,Impact,sans-serif'
    const cw = ctx.measureText('W').width, tw = cw*ch.length, sx = W*0.38-tw/2
    ch.forEach((c,i) => {
      const cp = Math.max(0,Math.min(1,(pp*1.5)-i*0.1)), dir=i%2===0?1:-1
      ctx.save(); ctx.globalAlpha = cp
      ctx.translate(sx+i*cw+cw/2+(1-cp)*60*dir, H*0.35+(1-cp)*30)
      ctx.transform(1,0,-0.1*(1-cp),1,0,0)
      if (cp<0.7) { ctx.shadowColor=style.colors.primary; ctx.shadowBlur=25*(1-cp) }
      ctx.strokeStyle = style.colors.primary; ctx.lineWidth=2; ctx.strokeText(c,0,0)
      ctx.fillStyle = '#FFF'; ctx.fillText(c,0,0); ctx.restore()
    })
    const tp = Math.max(0,(p-0.15)/0.3)
    if (tp>0) {
      ctx.save(); ctx.globalAlpha=tp
      ctx.font='600 28px Inter,sans-serif'; ctx.fillStyle=`rgba(255,255,255,${tp*0.8})`
      ctx.textAlign='center'; ctx.textBaseline='middle'
      ctx.fillText('Real Tech, Real Trends, Real News.', W*0.38, H*0.52); ctx.restore()
    }
  }

  scope(ctx, p, pool) {
    ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H)
    const pulse = 0.3+Math.sin(p*30)*0.15
    ctx.fillStyle=`rgba(255,0,0,${pulse*0.08})`
    for(let i=0;i<H;i+=4) ctx.fillRect(0,i,W,1)
    ctx.strokeStyle=`rgba(255,0,0,${0.08+Math.sin(p*20)*0.05})`; ctx.lineWidth=2
    ctx.beginPath(); ctx.moveTo(0,H*0.5+Math.sin(p*30)*100); ctx.lineTo(W,H*0.5+Math.sin(p*30+1)*100); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0,H*0.5+Math.sin(p*30+2)*100); ctx.lineTo(W,H*0.5+Math.sin(p*30+3)*100); ctx.stroke()
    ctx.save(); ctx.shadowColor='#FF0000'; ctx.shadowBlur=40
    ctx.font='900 70px Anton,Impact,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'
    ctx.fillStyle='#FFF'; ctx.fillText('BREAKING',W/2,H*0.28)
    ctx.fillStyle='#FF0000'; ctx.fillText('NEWS',W/2,H*0.38); ctx.shadowBlur=0
    if(pool.length>0){
      const idx=Math.floor((p*pool.length*2)%pool.length), cp=(p*pool.length*2)%1
      ctx.globalAlpha=1-cp; ctx.font='800 40px Inter,sans-serif'; ctx.fillStyle='#00FFFF'
      ctx.fillText(pool[idx%pool.length],W/2,H*0.52)
      ctx.globalAlpha=cp; ctx.fillText(pool[(idx+1)%pool.length],W/2,H*0.52)
    }; ctx.restore()
  }

  lock(ctx, p, brand) {
    const pp=Math.min(1,p*1.5)
    const g=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W*0.7)
    g.addColorStop(0,'#0D0D0D'); g.addColorStop(1,'#000')
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H)
    ctx.strokeStyle='rgba(0,255,255,0.03)'; ctx.lineWidth=0.5
    for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
    for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
    const ls=100, lx=W/2-ls/2, ly=H*0.12, s=Math.min(1,pp*2)
    ctx.save(); ctx.translate(W/2,ly+ls/2); ctx.scale(s,s); ctx.translate(-W/2,-(ly+ls/2))
    ctx.fillStyle='#FFD700'; ctx.shadowColor='#FFD700'; ctx.shadowBlur=30*(1-pp*0.5)
    ctx.beginPath(); ctx.roundRect(lx,ly,ls,ls,14); ctx.fill(); ctx.shadowBlur=0
    ctx.font='900 60px Anton,Impact,sans-serif'; ctx.fillStyle='#000'
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('NM',W/2,ly+ls/2+4); ctx.restore()
    const np=Math.min(1,(pp-0.1)/0.3)
    ctx.save(); ctx.globalAlpha=np; ctx.font='900 42px Anton,Impact,sans-serif'; ctx.fillStyle='#FFF'
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(brand,W/2,H*0.40); ctx.restore()
    const tp=Math.min(1,(pp-0.2)/0.25)
    ctx.save(); ctx.globalAlpha=tp; ctx.font='600 32px Inter,sans-serif'
    ctx.fillStyle=`rgba(255,255,255,${tp*0.7})`; ctx.textAlign='center'; ctx.textBaseline='middle'
    ctx.fillText('Unfiltered Breaking News From The Future.',W/2,H*0.46); ctx.restore()
    const ap=Math.min(1,(pp-0.35)/0.25)
    ctx.save(); ctx.globalAlpha=ap; const d=0.4+Math.sin(pp*20)*0.3
    ctx.fillStyle=`rgba(255,0,0,${d})`; ctx.beginPath(); ctx.arc(W/2-120,H*0.55,7,0,Math.PI*2); ctx.fill()
    ctx.font='800 32px Inter,sans-serif'; ctx.fillStyle='#FFF'
    ctx.textAlign='left'; ctx.textBaseline='middle'
    ctx.fillText('sham435',W/2-100,H*0.55)
    ctx.font='500 28px Inter,sans-serif'; ctx.fillStyle=`rgba(255,255,255,${ap*0.4})`
    ctx.fillText('ANCHOR',W/2-100,H*0.55+30); ctx.restore()
    const tk=Math.min(1,(pp-0.5)/0.3)
    ctx.save(); ctx.globalAlpha=tk
    ctx.fillStyle='rgba(255,255,255,0.06)'
    ctx.beginPath(); ctx.roundRect(W*0.05,H*0.78,W*0.9,55,10); ctx.fill()
    const items=['AI','ROBOTICS','QUANTUM','CYBERSECURITY','BIOTECH','SPACE']
    const sc=(pp*4)%items.length; ctx.font='600 28px Inter,sans-serif'
    ctx.textAlign='center'; ctx.textBaseline='middle'
    for(let i=0;i<4;i++){
      const idx=Math.floor(sc+i)%items.length
      ctx.fillStyle=`rgba(255,255,255,${i===0?1-(sc%1):0.6})`
      ctx.fillText(items[idx],W*0.12+i*W*0.22,H*0.805)
    }; ctx.restore()
    ctx.fillStyle='#FF0000'; ctx.fillRect(W*0.05,H*0.94,W*0.9,2)
  }

  genAudio(outPath, duration) {
    try {
      execSync(`ffmpeg -y \
        -f lavfi -t 0.4 -i "sine=f=80:r=48000,afade=t=out:st=0.3:d=0.1,volume=1.0" \
        -f lavfi -t 0.6 -i "sine=f=120:r=48000,afade=t=out:st=0.5:d=0.1,volume=0.6" \
        -f lavfi -t 0.5 -i "sine=f=55:r=48000,afade=t=out:st=0.4:d=0.1,volume=0.9" \
        -f lavfi -t ${duration} -i "anoisesrc=d=${duration}:c=pink:a=0.06,afade=t=in:st=0:d=0.5,afade=t=out:st=${duration-1}:d=1,volume=0.3" \
        -f lavfi -t ${duration} -i "sine=f=60:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=${duration-0.5}:d=0.5,volume=0.12" \
        -f lavfi -t 2 -i "sine=f=880:r=48000,afade=t=in:st=0:d=0.02,afade=t=out:st=1.8:d=0.2,volume=0.15" \
        -f lavfi -t ${duration} -i "sine=f=220:r=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=${duration-0.5}:d=0.5,volume=0.06" \
        -filter_complex "[0:a]adelay=0|0[hit1];[1:a]adelay=2000|2000[whoosh];[2:a]adelay=4500|4500[alert];[3:a][4:a][5:a][6:a]amix=inputs=4:duration=longest:normalize=0,volume=0.35[bed];[hit1][whoosh][alert][bed]amix=inputs=4:duration=longest:normalize=0,volume=0.6[a]" \
        -map "[a]" -c:a mp3 -b:a 192k "${outPath}"`, { stdio: 'pipe', timeout: 15000 })
    } catch {}
  }
}
