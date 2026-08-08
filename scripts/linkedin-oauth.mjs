#!/usr/bin/env node
// LinkedIn OAuth helper. Two modes:
//
//   RECOMMENDED (works with the redirect URI already registered in the portal):
//     node scripts/linkedin-oauth.mjs
//     → prints an auth URL using LINKEDIN_REDIRECT_URI from .env (the Railway
//       callback that LinkedIn has registered). Approve in the browser; the
//       browser lands on the Railway callback URL which shows an error, BUT the
//       URL contains ?code=... — copy that code and run:
//
//     node scripts/linkedin-oauth.mjs --code <code>
//     → exchanges the code for tokens and writes them to .env
//
//   LOCAL SERVER MODE (only if localhost:PORT is registered in the portal):
//     node scripts/linkedin-oauth.mjs --local [port]
//     → starts a local callback server, opens the browser, auto-saves tokens.
import { createServer } from 'node:http'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const OAUTH = 'https://www.linkedin.com/oauth/v2'

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

const CLIENT_ID = env('LINKEDIN_CLIENT_ID')
const CLIENT_SECRET = env('LINKEDIN_CLIENT_SECRET')
const REDIRECT_URI = env('LINKEDIN_REDIRECT_URI', 'https://video-gen-stack-production.up.railway.app/api/auth/linkedin/callback')

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET missing from .env')
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
  console.log('\n🔑 Exchanging authorization code for access token…')
  const tokenRes = await fetch(`${OAUTH}/accessToken`, {
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
  const tok = await tokenRes.json()
  if (!tok.access_token) {
    console.error('❌ Token exchange failed:', JSON.stringify(tok).slice(0, 300))
    process.exit(1)
  }
  const infoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  })
  const info = await infoRes.json().catch(() => ({}))
  const memberUrn = info.sub ? `urn:li:person:${info.sub}` : ''
  saveEnv({
    LINKEDIN_ACCESS_TOKEN: tok.access_token,
    LINKEDIN_REFRESH_TOKEN: tok.refresh_token || '',
    LINKEDIN_MEMBER_URN: memberUrn,
    LINKEDIN_TOKEN_EXPIRES_AT: String(Date.now() + (tok.expires_in || 5184000) * 1000),
  })
  console.log(`✅ Tokens saved to .env (expires_in=${tok.expires_in}s)`)
  console.log(`👤 Member: ${memberUrn || info.name || 'unknown'}`)
  console.log('You can now close the browser tab.')
}

const args = process.argv.slice(2)
async function main() {
  const codeIdx = args.indexOf('--code')
  if (codeIdx >= 0) {
    await exchangeCode(args[codeIdx + 1])
    return
  }

  // Local server mode
  if (args.includes('--local')) {
    const portArg = args[args.indexOf('--local') + 1]
    const PORT = parseInt(portArg || '4567')
    const LOCAL_URI = `http://localhost:${PORT}/api/auth/linkedin/callback`
    const state = randomBytes(24).toString('hex')
    const authUrl =
      `${OAUTH}/authorization?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(LOCAL_URI)}&scope=${encodeURIComponent('openid profile email w_member_social')}` +
      `&state=${encodeURIComponent(state)}`

    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`)
      if (url.pathname === '/oauth/callback') {
        const { code, state: st, error } = url.searchParams
        if (error) return respond(res, 400, `OAuth error: ${error}`)
        if (!code) return respond(res, 400, 'No code in callback')
        if (st !== state) return respond(res, 403, 'State mismatch — possible CSRF')
        server.close()
        await exchangeCode(code)
        return respond(res, 200, '<h3>✅ LinkedIn connected!</h3><p>Access token saved to <code>.env</code>. Close this tab.</p>')
      }
      respond(res, 404, 'Not found — expected /oauth/callback')
    })
    function respond(res, status, text) {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<body style="font-family:system-ui;background:#0b0b0f;color:#fff;display:grid;place-items:center;min-height:100vh"><div><h2>NEWS-MONSTER · LinkedIn OAuth</h2><p>${text}</p></div></body>`)
    }
    server.listen(PORT, () => {
      console.log(`🌐 Callback server listening on http://localhost:${PORT}`)
      console.log(`🔗 Open this URL in your browser to authorize:\n\n  ${authUrl}\n`)
      console.log('If your browser does not open automatically, copy the URL above.\n')
      try { execSync(`open "${authUrl}"`) } catch {}
    })
    process.stdin.resume()
    return
  }

  // Default: print an auth URL using the registered redirect URI; the code
  // appears in the browser's address bar after redirect, then run --code.
  const state = randomBytes(24).toString('hex')
  const authUrl =
    `${OAUTH}/authorization?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent('openid profile email w_member_social')}` +
    `&state=${encodeURIComponent(state)}`
  console.log('🔗 Open this URL, approve, then copy the `code` param from the redirect URL and run:\n')
  console.log('    node scripts/linkedin-oauth.mjs --code <the-code>')
  console.log(`\n  ${authUrl}\n`)
  try { execSync(`open "${authUrl}"`) } catch {}
}

main()