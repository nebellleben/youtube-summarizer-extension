// Background service worker for YouTube Summarizer Extension
// FIXED: Processing continues even when user clicks away from sidebar

const transcriptCache = new Map()
const interceptedCaptions = new Map()

const DEFAULT_SETTINGS = {
  localServerUrl: 'http://127.0.0.1:5000',
  useLocalServer: true
}

// Set up webRequest listener for intercepting caption requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return

    const url = details.url
    if (url.includes('youtube.com/api/timedtext') || url.includes('timedtext')) {
      console.log('[YouTube Summarizer] Intercepting caption request:', url.substring(0, 100))
    }
  },
  {
    urls: ['*://*.youtube.com/api/timedtext*']
  },
  ['requestBody']
)

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.tabId < 0) return

    const url = details.url
    if (url.includes('youtube.com/api/timedtext') || url.includes('timedtext')) {
      console.log('[YouTube Summarizer] Caption request completed:', url.substring(0, 100))

      try {
        const response = await fetch(url)
        if (response.ok) {
          const text = await response.text()
          if (text && text.trim().startsWith('{') && !text.includes('<')) {
            const data = JSON.parse(text)
            if (data.events && data.events.length > 0) {
              const transcript = data.events
                .filter(e => e.segs)
                .map(e => e.segs.map(s => s.utf8).join(''))
                .join(' ')

              if (transcript.length > 10) {
                const videoIdMatch = url.match(/[?&]v=([^&]+)/)
                if (videoIdMatch) {
                  const videoId = videoIdMatch[1]
                  const isAuto = url.includes('caps=asr') || url.includes('kind=asr')
                  const lang = url.match(/[?&]lang=([^&]+)/)?.[1] || 'unknown'

                  console.log(`[YouTube Summarizer] Captured transcript via webRequest: ${videoId}, length: ${transcript.length}, lang: ${lang}${isAuto ? ' [AUTO]' : ''}`)

                  transcriptCache.set(videoId, transcript)
                }
              }
            }
          }
        }
      } catch (e) {
        console.log('[YouTube Summarizer] Failed to capture caption response:', e.message)
      }
    }
  },
  {
    urls: ['*://*.youtube.com/api/timedtext*']
  },
  ['responseHeaders']
)

// NEW: Store processing state in session storage (survives page refresh!)
async function setProcessingState(videoId, state) {
  await chrome.storage.session.set({
    [`processing_${videoId}`]: {
      ...state,
      timestamp: Date.now()
    }
  })
}

async function getProcessingState(videoId) {
  const result = await chrome.storage.session.get([`processing_${videoId}`])
  return result[`processing_${videoId}`]
}

async function clearProcessingState(videoId) {
  await chrome.storage.session.remove([`processing_${videoId}`])
}

// NEW: Send progress updates to content script
async function sendProgressUpdate(tabId, videoId, stage, progress, message) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'updateProgress',
      videoId,
      stage,
      progress,
      message
    })
  } catch (e) {
    console.log('[YouTube Summarizer] Could not send progress update:', e.message)
  }
}

// Fetch transcript using multiple methods (with retry logic)
async function fetchTranscriptWithRetry(videoId, tabId, maxRetries = 2) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[YouTube Summarizer] Retry attempt ${attempt + 1}/${maxRetries}`)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
      
      const transcript = await fetchTranscript(videoId, tabId)
      if (transcript) return transcript
    } catch (e) {
      console.log(`[YouTube Summarizer] Attempt ${attempt + 1} failed:`, e.message)
      if (attempt === maxRetries - 1) throw e
    }
  }
  return null
}

async function fetchTranscript(videoId, tabId = null) {
  console.log('[YouTube Summarizer] ===== STARTING TRANSCRIPT FETCH =====')
  console.log('[YouTube Summarizer] Video ID:', videoId)
  console.log('[YouTube Summarizer] Tab ID:', tabId)

  // Check cache first
  if (transcriptCache.has(videoId)) {
    console.log('[YouTube Summarizer] Using cached transcript')
    return transcriptCache.get(videoId)
  }

  let transcript = null

  // Method 0: Try content script extraction (most reliable - works within YouTube page)
  if (tabId) {
    try {
      console.log('[YouTube Summarizer] ===== METHOD 0: Content Script Extraction =====')
      console.log('[YouTube Summarizer] Requesting transcript from content script, tabId:', tabId)

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Content script request timeout')), 15000)
      )

      const response = await Promise.race([
        chrome.tabs.sendMessage(tabId, { action: 'getTranscript' }),
        timeoutPromise
      ])

      console.log('[YouTube Summarizer] ===== Content script response received =====')
      if (response?.error) {
        console.log('[YouTube Summarizer] Content script error:', response.error)
      }
      if (response && response.transcript && response.transcript.length > 10) {
        transcript = response.transcript
        console.log('[YouTube Summarizer] ===== SUCCESS: Transcript extracted from page, length:', transcript.length)
      } else {
        console.log('[YouTube Summarizer] ===== FAILED: Content script returned no valid transcript =====')
      }
    } catch (e) {
      console.log('[YouTube Summarizer] ===== FAILED: Content script extraction failed:', e.message)
    }
  } else {
    console.log('[YouTube Summarizer] No tabId provided for content script extraction')
  }

  // Method 1: Try local server (if available)
  if (!transcript) {
    console.log('[YouTube Summarizer] ===== METHOD 1: Local Server =====')
    const settings = await chrome.storage.local.get(['useLocalServer', 'localServerUrl'])
    const useLocalServer = settings.useLocalServer !== undefined ? settings.useLocalServer : true
    const localServerUrl = settings.localServerUrl || DEFAULT_SETTINGS.localServerUrl

    console.log('[YouTube Summarizer] Local server enabled:', useLocalServer)
    console.log('[YouTube Summarizer] Local server URL:', localServerUrl)

    if (useLocalServer) {
      try {
        const serverUrl = `${localServerUrl}/api/transcript`
        console.log('[YouTube Summarizer] Trying local server:', serverUrl)
        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ video_id: videoId })
        })
        console.log('[YouTube Summarizer] Local server response:', response.status, response.statusText)

        if (response.ok) {
          const data = await response.json()
          if (data && data.transcript) {
            transcript = data.transcript
            console.log('[YouTube Summarizer] ===== SUCCESS: Transcript fetched from local server, length:', transcript.length)
          }
        }
      } catch (e) {
        console.log('[YouTube Summarizer] ===== METHOD 1 FAILED: Local server not available:', e.message)
      }
    } else {
      console.log('[YouTube Summarizer] ===== METHOD 1 SKIPPED: Local server disabled')
    }
  }

  // Method 2: YouTube timedtext API (direct from YouTube)
  if (!transcript) {
    console.log('[YouTube Summarizer] ===== METHOD 2: YouTube Timedtext API =====')
    const langs = ['en', 'en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi', 'id']

    for (const lang of langs) {
      try {
        const apiUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`
        console.log(`[YouTube Summarizer] Trying API for ${lang}: ${apiUrl}`)
        const response = await fetch(apiUrl)
        console.log(`[YouTube Summarizer] Response status for ${lang}:`, response.status, response.statusText)

        if (response.ok) {
          const data = await response.json()
          if (data && data.events) {
            transcript = data.events
              .filter(e => e.segs)
              .map(e => e.segs.map(s => s.utf8).join(''))
              .join(' ')
            console.log(`[YouTube Summarizer] ===== SUCCESS: Transcript fetched from YouTube timedtext API (${lang}), length:`, transcript.length)
            break
          }
        }
      } catch (e) {
        console.log(`[YouTube Summarizer] YouTube timedtext API failed for ${lang}:`, e.message)
      }
    }
    if (!transcript) {
      console.log('[YouTube Summarizer] ===== METHOD 2 FAILED: No transcript from regular captions')
    }
  }

  // Method 2.5: Try auto-generated captions specifically
  if (!transcript) {
    console.log('[YouTube Summarizer] ===== METHOD 2.5: Auto-Generated Captions =====')
    const autoLangs = ['en', 'en-US', 'en-GB', 'zh-CN', 'zh-TW', 'zh-HK', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi', 'id']
    for (const lang of autoLangs) {
      try {
        const autoUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3&caps=asr`
        console.log(`[YouTube Summarizer] Trying auto-caption API for ${lang}: ${autoUrl}`)
        const response = await fetch(autoUrl)
        console.log(`[YouTube Summarizer] Auto-caption response status for ${lang}:`, response.status, response.statusText)

        if (response.ok) {
          const text = await response.text()
          if (text && !text.includes('<') && text.trim().startsWith('{')) {
            const data = await response.json()
            if (data && data.events) {
              transcript = data.events
                .filter(e => e.segs)
                .map(e => e.segs.map(s => s.utf8).join(''))
                .join(' ')
              console.log(`[YouTube Summarizer] ===== SUCCESS: Transcript fetched from YouTube auto-generated captions (${lang}), length:`, transcript.length)
              break
            }
          }
        }
      } catch (e) {
        console.log(`[YouTube Summarizer] YouTube auto-caption API failed for ${lang}:`, e.message)
      }
    }
    if (!transcript) {
      console.log('[YouTube Summarizer] ===== METHOD 2.5 FAILED: No transcript from auto-captions')
    }
  }

  if (transcript) {
    transcriptCache.set(videoId, transcript)
    console.log('[YouTube Summarizer] ===== TRANSCRIPT FETCH SUCCESS =====')
    console.log('[YouTube Summarizer] Final transcript length:', transcript.length)
  } else {
    console.log('[YouTube Summarizer] ===== TRANSCRIPT FETCH FAILED =====')
  }
  console.log('[YouTube Summarizer] ===== ENDING TRANSCRIPT FETCH =====\n')

  return transcript
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

function getLanguageName(code) {
  const languages = {
    'zh-TW': 'Traditional Chinese (繁體中文)',
    'zh-CN': 'Simplified Chinese (简体中文)',
    'en': 'English',
    'ja': 'Japanese (日本語)',
    'ko': 'Korean (한국어)'
  }
  return languages[code] || 'English'
}

async function generateGLMToken(apiKey) {
  const parts = apiKey.split('.')
  if (parts.length !== 2) {
    throw new Error('Invalid GLM API key format. Expected: id.secret')
  }

  const [id, secret] = parts

  const now = Date.now()
  const payload = {
    api_key: id,
    exp: now + 3600 * 1000,
    timestamp: now
  }

  const header = {
    alg: 'HS256',
    sign_type: 'SIGN'
  }

  function base64UrlEncode(str) {
    const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
      return String.fromCharCode('0x' + p1)
    })
    return btoa(utf8Bytes)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))

  const data = `${encodedHeader}.${encodedPayload}`

  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(data)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)

    const signatureArray = Array.from(new Uint8Array(signature))
    let binaryString = ''
    const chunkSize = 0x8000
    for (let i = 0; i < signatureArray.length; i += chunkSize) {
      binaryString += String.fromCharCode.apply(null, signatureArray.slice(i, i + chunkSize))
    }
    const signatureString = btoa(binaryString)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    return `${data}.${signatureString}`
}

async function generateSummaryGLM(transcript, videoId, apiKey, settings = {}) {
  if (!transcript) {
    throw new Error('Could not fetch transcript for this video')
  }

  const maxChars = 100000
  let trimmedTranscript = transcript
  if (transcript.length > maxChars) {
    trimmedTranscript = transcript.substring(0, maxChars) + '...'
  }

  const language = settings.summaryLanguage || 'zh-TW'
  const languageName = getLanguageName(language)
  const includeTimestamps = settings.includeTimestamps !== undefined ? settings.includeTimestamps : true

  let timestampInstruction = includeTimestamps ?
    '2. Key discussion points with approximate timestamps (use [MM:SS] or [HH:MM:SS] format)' :
    '2. Key discussion points in chronological order'

  const prompt = `Please analyze this YouTube video transcript and provide a comprehensive summary in ${languageName}.

Your summary should include:
1. A title that reflects the main topic
${timestampInstruction}
3. Main ideas and conclusions
4. Around 600-800 words total

Format your response in markdown with:
- ## Headers for sections
- **Bold** for key terms
- - Bullet points for lists
${includeTimestamps ? '- [MM:SS] or [HH:MM:SS] format for timestamps when applicable' : ''}

Here is the transcript:

${trimmedTranscript}`

  const model = settings.glmModel || 'glm-4'

  try {
    const token = await generateGLMToken(apiKey)

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.7
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || error.message || 'GLM API request failed')
    }

    const data = await response.json()
    return data.choices[0].message.content
  } catch (error) {
    throw new Error(`GLM API error: ${error.message}`)
  }
}

async function generateSummaryAnthropic(transcript, videoId, apiKey, settings = {}) {
  if (!transcript) {
    throw new Error('Could not fetch transcript for this video')
  }

  const maxChars = 100000
  let trimmedTranscript = transcript
  if (transcript.length > maxChars) {
    trimmedTranscript = transcript.substring(0, maxChars) + '...'
  }

  const language = settings.summaryLanguage || 'zh-TW'
  const languageName = getLanguageName(language)
  const includeTimestamps = settings.includeTimestamps !== undefined ? settings.includeTimestamps : true

  let timestampInstruction = includeTimestamps ?
    '2. Key discussion points with approximate timestamps (use [MM:SS] or [HH:MM:SS] format)' :
    '2. Key discussion points in chronological order'

  const prompt = `Please analyze this YouTube video transcript and provide a comprehensive summary in ${languageName}.

Your summary should include:
1. A title that reflects the main topic
${timestampInstruction}
3. Main ideas and conclusions
4. Around 600-800 words total

Format your response in markdown with:
- ## Headers for sections
- **Bold** for key terms
- - Bullet points for lists
${includeTimestamps ? '- [MM:SS] or [HH:MM:SS] format for timestamps when applicable' : ''}

Here is the transcript:

${trimmedTranscript}`

  const model = settings.anthropicModel || 'claude-sonnet-4-20250514'

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'API request failed')
    }

    const data = await response.json()
    return data.content[0].text
  } catch (error) {
    throw new Error(`Summary generation failed: ${error.message}`)
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarize(request)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }))
    return true // Keep message channel open for async response
  }

  if (request.action === 'clearCache') {
    transcriptCache.clear()
    sendResponse({ success: true })
    return true
  }

  if (request.action === 'testLocalServer') {
    testLocalServer(request.serverUrl)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }))
    return true
  }
})

async function testLocalServer(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/health`)
    return { success: response.ok }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// NEW: Improved handleSummarize with progress tracking and state persistence
async function handleSummarize(request) {
  const { videoId, tabId } = request

  // Initialize processing state
  await setProcessingState(videoId, {
    status: 'starting',
    stage: 'initialization',
    progress: 0
  })

  // Wait a bit and verify content script is ready
  await new Promise(resolve => setTimeout(resolve, 500))

  // Send progress: Checking content script
  await sendProgressUpdate(tabId, videoId, 'checking_content_script', 5, 'Checking content script...')

  // Check if content script is responsive
  if (tabId) {
    console.log('[YouTube Summarizer] Checking if content script is ready for tab:', tabId)
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' })
      console.log('[YouTube Summarizer] Content script is responding')
    } catch (e) {
      console.log('[YouTube Summarizer] Content script not responding:', e.message, '- attempting injection...')

      try {
        // Try to inject content script
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        })
        console.log('[YouTube Summarizer] Content script injected successfully')
        // Wait for it to initialize
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (injectError) {
        console.log('[YouTube Summarizer] Could not inject content script:', injectError.message)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
  }

  // Get all settings
  const settings = await chrome.storage.local.get([
    'apiProvider',
    'anthropicKey',
    'anthropicModel',
    'glmKey',
    'glmModel',
    'apiKey',
    'model',
    'summaryLanguage',
    'includeTimestamps',
    'useLocalServer',
    'localServerUrl'
  ])

  // Determine API provider
  const provider = settings.apiProvider || 'anthropic'

  // Get API key based on provider (with legacy support)
  let apiKey = null
  if (provider === 'glm') {
    apiKey = settings.glmKey
    if (!apiKey) {
      await clearProcessingState(videoId)
      throw new Error('Zhipu AI API key is required. Please set it in Options.')
    }
  } else {
    apiKey = settings.anthropicKey || settings.apiKey
    if (!apiKey) {
      await clearProcessingState(videoId)
      throw new Error('API key is required. Please set it in Options.')
    }
  }

  if (!videoId) {
    await clearProcessingState(videoId)
    throw new Error('Could not extract video ID from the current page')
  }

  // Update progress: Fetching transcript
  await sendProgressUpdate(tabId, videoId, 'fetching_transcript', 15, 'Fetching video transcript...')
  await setProcessingState(videoId, {
    status: 'processing',
    stage: 'fetching_transcript',
    progress: 15
  })

  // Fetch transcript (with retry logic)
  const transcript = await fetchTranscriptWithRetry(videoId, tabId, 2)

  if (!transcript) {
    await clearProcessingState(videoId)
    throw new Error('Could not fetch transcript. The video may not have captions available.')
  }

  // Update progress: Generating summary
  await sendProgressUpdate(tabId, videoId, 'generating_summary', 50, 'Generating AI summary...')
  await setProcessingState(videoId, {
    status: 'processing',
    stage: 'generating_summary',
    progress: 50,
    transcriptLength: transcript.length
  })

  // Generate summary based on provider
  let summary
  if (provider === 'glm') {
    summary = await generateSummaryGLM(transcript, videoId, apiKey, settings)
  } else {
    summary = await generateSummaryAnthropic(transcript, videoId, apiKey, settings)
  }

  // Update progress: Finalizing
  await sendProgressUpdate(tabId, videoId, 'finalizing', 90, 'Finalizing summary...')
  await setProcessingState(videoId, {
    status: 'finalizing',
    stage: 'finalizing',
    progress: 90
  })

  // Get video title
  let title = 'YouTube Video Summary'
  console.log('[YouTube Summarizer] Fetching video title for summary display...')
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]) {
      console.log('[YouTube Summarizer] Sending getVideoInfo to tab:', tabs[0].id)
      const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'getVideoInfo' })
      console.log('[YouTube Summarizer] Video info response:', response ? 'received' : 'failed')
      if (response && response.title) {
        title = response.title
      }
    }
  } catch (e) {
    console.log('[YouTube Summarizer] Could not get video title:', e.message)
  }

  // Store final summary in session storage (survives page refresh!)
  await chrome.storage.session.set({
    [`summary_${videoId}`]: {
      summary,
      title,
      videoId,
      timestamp: Date.now()
    }
  })

  // Clear processing state
  await clearProcessingState(videoId)

  // Update progress: Complete
  await sendProgressUpdate(tabId, videoId, 'complete', 100, 'Summary complete!')

  return {
    summary,
    title,
    videoId
  }
}

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage()
  }
})
