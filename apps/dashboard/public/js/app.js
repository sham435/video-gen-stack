const state = {
  models: [],
  messages: [],
  generating: false,
  selectedModel: 'gemini-2.0-flash',
  selectedProvider: 'gemini',
  duration: 5,
  aspectRatio: '16:9',
  providers: [],
  conversationId: crypto.randomUUID(),
}

const conversationEl = document.getElementById('conversation')
const inputEl = document.getElementById('prompt-input')
const sendBtn = document.getElementById('send-btn')
const modelSelect = document.getElementById('model-select')
const providerSelect = document.getElementById('provider-select')
const durationSelect = document.getElementById('duration-select')
const ratioSelect = document.getElementById('ratio-select')
const newChatBtn = document.getElementById('new-chat-btn')
const modelBadge = document.getElementById('model-badge')
const freeHint = document.getElementById('free-hint')

async function loadProviders() {
  const res = await fetch('/api/providers')
  const data = await res.json()
  state.providers = data.providers

  providerSelect.innerHTML = ''
  data.providers.forEach(p => {
    const opt = document.createElement('option')
    opt.value = p.id
    const icon = p.free ? '🆓' : '💸'
    const status = p.configured ? '✅' : '❌'
    opt.textContent = `${status} ${icon} ${p.name}`
    if (!p.configured) {
      opt.style.color = '#999'
    }
    providerSelect.appendChild(opt)
  })

  // Auto-select best free configured provider
  const best = data.providers.find(p => p.configured && p.free)
    || data.providers.find(p => p.configured)
    || data.providers.find(p => p.free)
  if (best) {
    state.selectedProvider = best.id
    providerSelect.value = best.id
  }
  updateFreeHint()
  await loadModels()
}

function updateFreeHint() {
  const hints = {
    'gemini': '🆓 Get FREE Gemini key at aistudio.google.com (no credit card)',
    'colab': '🆓 Run colab/wan_colab_api.ipynb on free T4 GPU',
    'replicate': '💸 $5 free on signup then pay-as-you-go',
    'fal.ai': '💸 Needs credits at fal.ai/dashboard/billing',
    'huggingface': '🆓 Free but no video gen via API',
  }
  freeHint.textContent = hints[state.selectedProvider] || ''
}

providerSelect.addEventListener('change', async () => {
  state.selectedProvider = providerSelect.value
  updateFreeHint()
  await loadModels()
})

async function loadModels() {
  try {
    const res = await fetch(`/api/models?provider=${state.selectedProvider}`)
    const data = await res.json()
    state.models = data.models
    renderModelSelect()
    updateModelBadge()
  } catch (e) {
    addMessage('assistant', `Error: ${e.message}`)
  }
}

function renderModelSelect() {
  modelSelect.innerHTML = ''
  const available = state.models.filter(m => m.availableOnProvider)
  if (available.length === 0) {
    const opt = document.createElement('option')
    opt.textContent = 'No models — configure a provider key'
    opt.disabled = true
    modelSelect.appendChild(opt)
    return
  }
  available.forEach(m => {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = `${m.name}${m.freeTier ? ' 🆓' : ''}`
    modelSelect.appendChild(opt)
  })
  if (available.find(m => m.id === state.selectedModel)) {
    modelSelect.value = state.selectedModel
  } else {
    state.selectedModel = available[0].id
    modelSelect.value = available[0].id
  }
}

function updateModelBadge() {
  const model = state.models.find(m => m.id === state.selectedModel)
  if (!model) return
  if (model.freeTier) {
    modelBadge.textContent = '🆓 Free'
    modelBadge.className = 'model-badge foss'
  } else if (model.openSource) {
    modelBadge.textContent = 'FOSS'
    modelBadge.className = 'model-badge foss'
  } else {
    modelBadge.textContent = 'Paid'
    modelBadge.className = 'model-badge proprietary'
  }
}

modelSelect.addEventListener('change', () => {
  state.selectedModel = modelSelect.value
  updateModelBadge()
})

durationSelect.addEventListener('change', () => {
  state.duration = parseInt(durationSelect.value)
})

ratioSelect.addEventListener('change', () => {
  state.aspectRatio = ratioSelect.value
})

newChatBtn.addEventListener('click', () => {
  state.messages = []
  state.conversationId = crypto.randomUUID()
  renderMessages()
  inputEl.value = ''
  inputEl.focus()
})

function addMessage(role, content, extra = {}) {
  state.messages.push({ role, content, ...extra })
  renderMessages()
}

function renderMessages() {
  if (state.messages.length === 0) {
    conversationEl.innerHTML = `
      <div class="empty-state">
        <h2>🎬 Free AI Video Generation</h2>
        <p>Select <strong>Gemini (Free)</strong> above, add your free API key to <code>.env</code>, and start generating.</p>
        <div style="margin-top:16px;padding:12px 20px;background:#f0f7ff;border-radius:12px;text-align:left;font-size:13px;max-width:440px;">
          <strong>📋 How to get a free Gemini key:</strong><br>
          1. Go to <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a><br>
          2. Click "Create API Key" (no credit card)<br>
          3. Add to <code>.env</code>: <code>GEMINI_API_KEY=your_key</code><br>
          4. Restart the server and reload this page
        </div>
      </div>
    `
    return
  }

  conversationEl.innerHTML = state.messages.map((msg) => {
    const isUser = msg.role === 'user'
    const avatar = isUser ? 'U' : 'A'

    let extraHtml = ''
    if (msg.toolCall) {
      extraHtml += `<div class="tool-call">
        <span class="icon">🎬</span>
        <span>${msg.toolCall}</span>
      </div>`
    }

    if (msg.videoUrl) {
      extraHtml += `<div class="video-result"><video controls autoplay loop playsinline style="max-width:360px;border-radius:12px;"><source src="${msg.videoUrl}" type="video/mp4"></video></div>`
    }

    if (msg.loading) {
      extraHtml = `<div class="loading-spinner"><div class="spinner"></div> Generating video...</div>`
    }

    const content = isUser ? `<pre>${escapeHtml(msg.content)}</pre>` : `<div>${escapeHtml(msg.content)}</div>`

    return `<div class="message ${isUser ? 'user' : 'assistant'}">
      <div class="avatar ${isUser ? 'user' : 'assistant'}">${avatar}</div>
      <div>
        <div class="bubble">${content}</div>
        ${extraHtml}
      </div>
    </div>`
  }).join('')

  conversationEl.scrollTop = conversationEl.scrollHeight
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function autoResize(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

inputEl.addEventListener('input', () => autoResize(inputEl))

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

sendBtn.addEventListener('click', sendMessage)

async function sendMessage() {
  const prompt = inputEl.value.trim()
  if (!prompt || state.generating) return

  state.generating = true
  sendBtn.disabled = true
  inputEl.value = ''
  autoResize(inputEl)

  addMessage('user', prompt)

  const model = state.models.find(m => m.id === state.selectedModel)
  const providerName = state.selectedProvider
  addMessage('assistant', '', {
    toolCall: `${providerName} · ${model ? model.name : state.selectedModel}`,
    loading: true,
  })

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: state.selectedModel,
        prompt,
        duration: state.duration,
        aspectRatio: state.aspectRatio,
        provider: state.selectedProvider,
      }),
    })

    const data = await res.json()
    state.messages.pop()

    if (!res.ok) {
      addMessage('assistant', data.error)
      state.generating = false
      sendBtn.disabled = false
      return
    }

    if (!data.jobId) {
      addMessage('assistant', 'Error: no jobId returned')
      state.generating = false
      sendBtn.disabled = false
      return
    }

    addMessage('assistant', `⏳ Queued (${data.jobId}) — rendering...`, { toolCall: `${providerName} · ${model ? model.name : state.selectedModel}`, loading: true })

    const job = await pollJob(data.jobId)
    state.messages.pop()

    if (job.status === 'failed') {
      addMessage('assistant', `❌ Render failed: ${job.error}`)
      state.generating = false
      sendBtn.disabled = false
      return
    }

    const first = job.result?.videos?.[0] || {}
    const videoUrl = first.url || first.video_url || first

    addMessage('assistant', '✅ Video generated!', {
      toolCall: `${providerName} · ${model ? model.name : state.selectedModel}`,
      videoUrl: typeof videoUrl === 'string' ? videoUrl : null,
    })
  } catch (e) {
    state.messages.pop()
    addMessage('assistant', `Error: ${e.message}`)
  }

  state.generating = false
  sendBtn.disabled = false
}

async function pollJob(jobId, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`/api/jobs/${jobId}`)
    if (res.ok) {
      const job = await res.json()
      if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  return { status: 'failed', error: 'poll timeout' }
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
    item.classList.add('active')
  })
})

loadProviders()
