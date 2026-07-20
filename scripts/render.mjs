
import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'

const W=1920, H=1080

function wrapText(ctx, text, maxWidth){
  const words=text.split(' '); let lines=[], line=''
  for(const w of words){
    if(ctx.measureText(line+w+' ').width < maxWidth) line+=w+' '
    else { lines.push(line.trim()); line=w+' ' }
  }
  lines.push(line.trim())
  return lines.slice(0,3)
}

function themeFor(title){
  const t=title.toLowerCase()
  if(t.includes('apple')||t.includes('ios')||t.includes('siri')) return {bg:['#0A0A23','#2A2A6A'], accent:'#5E5CFF'}
  if(t.includes('samsung')||t.includes('galaxy')||t.includes('snapdragon')) return {bg:['#0A1A2A','#104A7A'], accent:'#00A8FF'}
  if(t.includes('ps1')||t.includes('game')||t.includes('bts')) return {bg:['#230A14','#6A1A3A'], accent:'#FF2D7B'}
  return {bg:['#0B1020','#1A2A5A'], accent:'#FF3A5E'}
}

export async function renderFrame(article, outPath){
  const canvas=createCanvas(W,H)
  const ctx=canvas.getContext('2d')
  const theme=themeFor(article.title)

  const grad=ctx.createLinearGradient(0,0,0,H)
  grad.addColorStop(0, theme.bg[0]); grad.addColorStop(1, theme.bg[1])
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H)

  if(article.imageUrl){
    try{
      const img=await loadImage(article.imageUrl)
      ctx.save(); ctx.globalAlpha=0.32; ctx.filter='blur(40px)'
      ctx.drawImage(img,0,0,W,H); ctx.restore()
      ctx.drawImage(img, 160, 80, 1600, 620)
      ctx.strokeStyle=theme.accent; ctx.lineWidth=4; ctx.strokeRect(160,80,1600,620)
    }catch(e){ console.log('image load failed', e.message) }
  }

  ctx.font='700 52px Inter, sans-serif'
  ctx.textAlign='center'
  const lines=wrapText(ctx, article.title, 1500)
  lines.forEach((line,i)=>{
    const y = article.imageUrl? 780 + i*70 : 480 + i*70
    const m = ctx.measureText(line).width
    ctx.fillStyle='rgba(0,0,0,0.62)'
    ctx.fillRect(W/2-m/2-24, y-52, m+48, 68)
    ctx.fillStyle='#FFFFFF'
    ctx.fillText(line, W/2, y)
  })

  ctx.font='400 26px Inter, sans-serif'
  ctx.fillStyle='rgba(255,255,255,0.7)'
  ctx.fillText(`Source: ${article.source||'Tech'}`, W/2, 1000)

  const buf = canvas.toBuffer('image/png')
  fs.writeFileSync(outPath, buf)
  return outPath
}
