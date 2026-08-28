#!/usr/bin/env node
// YouTube OAuth helper. Mode 1 (--code): prints an auth URL using the registered
// redirect URI; after approving, copy `code` from the Railway callback URL and run
//   node scripts/youtube-oauth.mjs --code <code>
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const BASE = 'https://accounts.google.com/o/oauth2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

function readEnv(key) {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith(`${key}=`))
    return line?.split('=').slice(1).join('=') ?? ''
  } catch { return '' }
}
function env(key, fallback = '') {
  return process.env[key] !== undefined && process.env[key] !== ''
    ? process.env[key]
    : readEnv(key) || fallback
}

const CLIENT_ID = env('YOUTUBE_CLIENT_ID')
const CLIENT_SECRET = env('YOUTUBE_CLIENT_SECRET')
const REDIRECT_URI = env('YOUTUBE_REDIRECT_URI', 'https://video-gen-stack-production.up.railway.app/api/auth/youtube/callback')

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET missing from .env')
  process.exit(1)
}

function saveEnv(entries) {
  let content = ''
  try { content = readFileSync('.env', 'utf-8') } catch {}
  const lines = content.split('\n')
  for (const [key, value] of Object.entries(entries)) {
    if (!value) continue
    const idx = lines.findIndex(l => l.startsWith(`${key}=`))
    if (idx >= 0) lines[idx] = `${key}=${value}`
    else lines.push(`${key}=${value}`)
  }
  writeFileSync('.env', lines.join('\n').replace(/\n+$/, '') + '\n')
}

async function exchangeCode(code) {
  console.log('\n🔑 Exchanging authorization code for refresh token…')
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  })
  const data = await res.json()
  if (!data.refresh_token) {
    console.error('❌ Token exchange failed:', JSON.stringify(data).slice(0, 300))
    process.exit(1)
  }
  saveEnv({ YOUTUBE_REFRESH_TOKEN: data.refresh_token })
  console.log('✅ New YOUTUBE_REFRESH_TOKEN saved to .env')
  console.log(`   expires_in=${data.expires_in}s | scope=${data.scope}`)
  console.log('\n👉 Next: push to GitHub secrets so CI can upload:\n')
  console.log(`   gh secret set YOUTUBE_REFRESH_TOKEN --repo sham435/video-gen-stack < <(grep '^YOUTUBE_REFRESH_TOKEN=' .env | cut -d= -f2)`)
}

const args = process.argv.slice(2)
async function main() {
  const codeIdx = args.indexOf('--code')
  if (codeIdx >= 0) {
    await exchangeCode(args[codeIdx + 1])
    return
  }
  const state = randomBytes(24).toString('hex')
  const authUrl =
    `${BASE}?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl')}` +
    `&response_type=code&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`
  console.log('🔗 Open this URL, pick the channel, approve ALL screens, then copy the `code` param from the Railway URL and run:\n')
  console.log('    node scripts/youtube-oauth.mjs --code <the-code>')
  console.log(`\n  ${authUrl}\n`)
  try { const { execSync } = await import('node:child_process'); execSync(`open "${authUrl}"`) } catch {}
}
main()
