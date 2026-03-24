// Content script for YouTube Summarizer Extension
// UPDATED: Pure display layer - all processing happens in background

// Prevent duplicate script execution
if (window.ytSummarizerLoaded) {
  console.log('[YouTube Summarizer] Script already loaded, skipping')
} else {
  window.ytSummarizerLoaded = true
  console.log('[YouTube Summarizer] Content script loaded')

  let sidebarContainer = null
  let isSidebarOpen = false

  // Get video info from page
  function getVideoInfoFromPage() {
    const urlParams = new URLSearchParams(window.location.search)
    const videoId = urlParams.get('v')

    if (!videoId) return null

    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.ytd-video-primary-info-renderer')
    const title = titleElement ? titleElement.textContent.trim() : ''

    return { videoId, title, thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` }
  }

  // Extract transcript using YouTube Player API
  async function getTranscriptFromPlayerAPI() {
    console.log('[YouTube Summarizer] ===== METHOD: Player API =====')

    try {
      await new Promise(resolve => setTimeout(resolve, 500))

      const playerElement = document.querySelector('#movie_player') || document.querySelector('.html5-video-player')
      if (!playerElement) {
        console.log('[YouTube Summarizer] Player element not found')
        return null
      }

      console.log('[YouTube Summarizer] Player element found')

      if (typeof playerElement.getOption === 'function') {
        console.log('[YouTube Summarizer] Player API accessible')

        try {
          const captionTracks = playerElement.getOption('captions', 'tracklist')
          console.log('[YouTube Summarizer] Found', captionTracks?.length || 0, 'caption tracks via Player API')

          if (captionTracks && captionTracks.length > 0) {
            const sortedTracks = [...captionTracks].sort((a, b) => {
              const aIsAuto = a.kind === 'asr' || a.languageCode?.includes('auto') || a.name?.toLowerCase().includes('auto')
              const bIsAuto = b.kind === 'asr' || b.languageCode?.includes('auto') || b.name?.toLowerCase().includes('auto')
              if (aIsAuto && !bIsAuto) return -1
              if (!aIsAuto && bIsAuto) return 1
              return 0
            })

            for (const track of sortedTracks) {
              const isAuto = track.kind === 'asr' || track.languageCode?.includes('auto') || track.name?.toLowerCase().includes('auto')
              const trackName = track.name?.simpleText || track.name?.runs?.[0]?.text || track.languageCode || 'unknown'

              console.log(`[YouTube Summarizer] Trying track: ${trackName}${isAuto ? ' [AUTO]' : ''}`)

              try {
                playerElement.setOption('captions', 'track', track)
                await new Promise(resolve => setTimeout(resolve, 1000))

                if (typeof playerElement.getOption === 'function') {
                  const currentTrack = playerElement.getOption('captions', 'track')
                  if (currentTrack && currentTrack.captionTracks) {
                    console.log('[YouTube Summarizer] Caption tracks data available')

                    for (const ct of currentTrack.captionTracks) {
                      if (ct.baseUrl) {
                        try {
                          const response = await fetch(ct.baseUrl + (ct.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3')
                          if (response.ok) {
                            const text = await response.text()
                            if (text && text.trim().startsWith('{')) {
                              const data = JSON.parse(text)
                              if (data.events && data.events.length > 0) {
                                const transcript = data.events
                                  .filter(e => e.segs)
                                  .map(e => e.segs.map(s => s.utf8).join(''))
                                  .join(' ')
                                if (transcript.length > 10) {
                                  console.log(`[YouTube Summarizer] ===== SUCCESS: Player API extracted transcript, length: ${transcript.length} =====`)
                                  return transcript
                                }
                              }
                            }
                          }
                        } catch (e) {
                          console.log('[YouTube Summarizer] Failed to fetch from track baseUrl:', e.message)
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.log('[YouTube Summarizer] Failed to set track:', e.message)
              }
            }
          }
        } catch (e) {
          console.log('[YouTube Summarizer] Player API getOption failed:', e.message)
        }

        try {
          const playerData = playerElement.getPlayerResponse?.() || playerElement.getVideoData?.()
          if (playerData) {
            console.log('[YouTube Summarizer] Player data available via getPlayerResponse')

            const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks
            if (captionTracks && captionTracks.length > 0) {
              console.log('[YouTube Summarizer] Found', captionTracks.length, 'caption tracks in player data')

              const sortedTracks = [...captionTracks].sort((a, b) => {
                const aIsAuto = a.kind === 'asr' || a.languageCode?.includes('auto') || a.name?.toLowerCase().includes('auto')
                const bIsAuto = b.kind === 'asr' || b.languageCode?.includes('auto') || b.name?.toLowerCase().includes('auto')
                if (aIsAuto && !bIsAuto) return -1
                if (!aIsAuto && bIsAuto) return 1
                return 0
              })

              for (const track of sortedTracks) {
                if (track.baseUrl) {
                  try {
                    const isAuto = track.kind === 'asr' || track.languageCode?.includes('auto')
                    console.log(`[YouTube Summarizer] Fetching from player data track${isAuto ? ' [AUTO]' : ''}`)

                    const response = await fetch(track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3')
                    if (response.ok) {
                      const text = await response.text()
                      if (text && text.trim().startsWith('{')) {
                        const data = JSON.parse(text)
                        if (data.events && data.events.length > 0) {
                          const transcript = data.events
                            .filter(e => e.segs)
                            .map(e => e.segs.map(s => s.utf8).join(''))
                            .join(' ')
                          if (transcript.length > 10) {
                            console.log(`[YouTube Summarizer] ===== SUCCESS: Player data API extracted transcript, length: ${transcript.length} =====`)
                            return transcript
                          }
                        }
                      }
                    }
                  } catch (e) {
                    console.log('[YouTube Summarizer] Failed to fetch from player data track:', e.message)
                  }
                }
              }
            }
          }
        } catch (e) {
          console.log('[YouTube Summarizer] Player getPlayerResponse failed:', e.message)
        }
      } else {
        console.log('[YouTube Summarizer] Player API not accessible (getOption not available)')
      }
    } catch (e) {
      console.log('[YouTube Summarizer] Player API method failed:', e.message)
    }

    return null
  }

  // Extract transcript by navigating caption settings menu
  async function getTranscriptViaCaptionMenu() {
    console.log('[YouTube Summarizer] ===== METHOD: Caption Settings Menu =====')

    try {
      await new Promise(resolve => setTimeout(resolve, 500))

      const settingsButton = document.querySelector('.ytp-settings-button, button[aria-label*="Settings"], button[aria-label*="settings"]')
      if (!settingsButton) {
        console.log('[YouTube Summarizer] Settings button not found')
        return null
      }

      console.log('[YouTube Summarizer] Settings button found, clicking...')
      settingsButton.click()
      await new Promise(resolve => setTimeout(resolve, 300))

      const menuItems = document.querySelectorAll('.ytp-menuitem, .ytp-menuitem-label, [role="menuitem"]')
      let subtitlesItem = null

      for (const item of menuItems) {
        const text = item.textContent.toLowerCase().trim()
        if (text.includes('subtitles') || text.includes('captions') || text.includes('cc') || text.includes('字幕')) {
          subtitlesItem = item
          console.log('[YouTube Summarizer] Found subtitles menu item:', text)
          break
        }
      }

      if (!subtitlesItem) {
        console.log('[YouTube Summarizer] Subtitles menu item not found')
        if (settingsButton) settingsButton.click()
        return null
      }

      subtitlesItem.click()
      await new Promise(resolve => setTimeout(resolve, 500))

      const captionMenuItems = document.querySelectorAll('.ytp-menuitem')
      let autoCaptionItem = null

      for (const item of captionMenuItems) {
        const text = item.textContent.toLowerCase().trim()
        if (text.includes('auto') || text.includes('auto-generated') || text.includes('自动生成') || text.includes('自動產生')) {
          autoCaptionItem = item
          console.log('[YouTube Summarizer] Found auto-caption item:', text)
          break
        }
      }

      if (autoCaptionItem) {
        console.log('[YouTube Summarizer] Clicking auto-caption option...')
        autoCaptionItem.click()
        await new Promise(resolve => setTimeout(resolve, 1000))

        const transcript = await getTranscriptFromPlayerAPI()
        if (transcript) {
          console.log('[YouTube Summarizer] ===== SUCCESS via Caption Menu + Player API =====\n')
          return transcript
        }
      } else {
        console.log('[YouTube Summarizer] Auto-caption option not found in menu')
      }

      document.body.click()
      await new Promise(resolve => setTimeout(resolve, 300))

    } catch (e) {
      console.log('[YouTube Summarizer] Caption menu navigation failed:', e.message)
    }

    return null
  }

  // Extract transcript using embed player API
  async function getTranscriptViaEmbedPlayer(videoId) {
    console.log('[YouTube Summarizer] ===== METHOD: Embed Player API =====')

    return new Promise((resolve) => {
      try {
        const iframe = document.createElement('iframe')
        iframe.style.display = 'none'
        iframe.style.position = 'fixed'
        iframe.style.top = '-9999px'
        iframe.style.left = '-9999px'
        iframe.setAttribute('allowfullscreen', 'true')
        iframe.setAttribute('allow', 'autoplay; encrypted-media')

        const embedUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&cc_load_policy=1`
        iframe.src = embedUrl

        console.log('[YouTube Summarizer] Creating embed iframe:', embedUrl)

        const timeout = setTimeout(() => {
          console.log('[YouTube Summarizer] Embed player timeout')
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe)
          }
          resolve(null)
        }, 15000)

        const messageListener = (event) => {
          if (!event.data) return

          if (event.data.event === 'infoDelivery' && event.data.info) {
            const info = event.data.info
            console.log('[YouTube Summarizer] Embed player info received')

            if (info.captionTracks && info.captionTracks.length > 0) {
              console.log('[YouTube Summarizer] Found', info.captionTracks.length, 'caption tracks in embed player')

              (async () => {
                for (const track of info.captionTracks) {
                  if (track.baseUrl) {
                    try {
                      const isAuto = track.kind === 'asr' || track.name?.toLowerCase().includes('auto')
                      console.log(`[YouTube Summarizer] Fetching from embed track${isAuto ? ' [AUTO]' : ''}`)

                      const response = await fetch(track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3')
                      if (response.ok) {
                        const text = await response.text()
                        if (text && text.trim().startsWith('{')) {
                          const data = JSON.parse(text)
                          if (data.events && data.events.length > 0) {
                            const transcript = data.events
                              .filter(e => e.segs)
                              .map(e => e.segs.map(s => s.utf8).join(''))
                              .join(' ')

                            if (transcript.length > 10) {
                              clearTimeout(timeout)
                              window.removeEventListener('message', messageListener)
                              if (iframe.parentNode) {
                                iframe.parentNode.removeChild(iframe)
                              }
                              console.log(`[YouTube Summarizer] ===== SUCCESS: Embed player extracted transcript, length: ${transcript.length} =====`)
                              resolve(transcript)
                              return
                            }
                          }
                        }
                      }
                    } catch (e) {
                      console.log('[YouTube Summarizer] Failed to fetch from embed track:', e.message)
                    }
                  }
                }
              })()
            }
          }
        }

        iframe.addEventListener('load', () => {
          console.log('[YouTube Summarizer] Embed iframe loaded')

          setTimeout(() => {
            try {
              const playerWindow = iframe.contentWindow
              if (playerWindow) {
                playerWindow.postMessage({ event: 'listening', id: 'ytsummarizer' }, '*')

                setTimeout(() => {
                  playerWindow.postMessage({ event: 'requestInfo', id: 'ytsummarizer' }, '*')
                }, 1000)
              }
            } catch (e) {
              console.log('[YouTube Summarizer] Failed to communicate with embed player:', e.message)
            }
          }, 2000)
        })

        iframe.addEventListener('error', () => {
          console.log('[YouTube Summarizer] Embed iframe error')
          clearTimeout(timeout)
          window.removeEventListener('message', messageListener)
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe)
          }
          resolve(null)
        })

        document.body.appendChild(iframe)
        window.addEventListener('message', messageListener)

      } catch (e) {
        console.log('[YouTube Summarizer] Embed player method failed:', e.message)
        resolve(null)
      }
    })
  }

  // Extract transcript directly from YouTube page using multiple methods
  async function getTranscriptFromPage() {
    console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: Starting transcript extraction =====')
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const videoId = urlParams.get('v')

      console.log('[YouTube Summarizer] Current URL:', window.location.href)
      console.log('[YouTube Summarizer] Extracted video ID:', videoId)

      if (!videoId) {
        console.log('[YouTube Summarizer] ===== ERROR: No video ID found')
        return null
      }

      // === NEW METHOD: YouTube Player API (most reliable for auto-captions) ===
      const playerAPITranscript = await getTranscriptFromPlayerAPI()
      if (playerAPITranscript) {
        console.log('[YouTube Summarizer] ===== SUCCESS via Player API =====\n')
        return playerAPITranscript
      }

      // === METHOD: Caption Settings Menu (for videos with auto-captions) ===
      const captionMenuTranscript = await getTranscriptViaCaptionMenu()
      if (captionMenuTranscript) {
        console.log('[YouTube Summarizer] ===== SUCCESS via Caption Menu =====\n')
        return captionMenuTranscript
      }

      // === METHOD: Embed Player API (fallback for blocked requests) ===
      const embedTranscript = await getTranscriptViaEmbedPlayer(videoId)
      if (embedTranscript) {
        console.log('[YouTube Summarizer] ===== SUCCESS via Embed Player =====\n')
        return embedTranscript
      }

      console.log('[YouTube Summarizer] All transcript extraction methods failed')
      console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: FAILED - No transcript found =====\n')
      return null
    } catch (error) {
      console.error('[YouTube Summarizer] ===== CONTENT SCRIPT: ERROR =====')
      console.error('[YouTube Summarizer] Error extracting transcript:', error)
      console.error('[YouTube Summarizer] Error stack:', error.stack)
      console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: FAILED due to error =====\n')
      return null
    }
  }

  // Create sidebar element
  function createSidebar() {
    if (sidebarContainer) return sidebarContainer

    sidebarContainer = document.createElement('div')
    sidebarContainer.id = 'yt-ai-summarizer-sidebar'
    sidebarContainer.innerHTML = `
      <div class="yt-ai-sidebar-overlay"></div>
      <div class="yt-ai-sidebar-panel">
        <div class="yt-ai-sidebar-header">
          <div class="yt-ai-sidebar-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"/>
            </svg>
            <span>Video Summary</span>
          </div>
          <button class="yt-ai-sidebar-close" title="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/>
            </svg>
          </button>
        </div>
        <div class="yt-ai-sidebar-content">
          <div class="yt-ai-loading">
            <div class="yt-ai-spinner"></div>
            <p>Ready to generate summary...</p>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(sidebarContainer)

    const overlay = sidebarContainer.querySelector('.yt-ai-sidebar-overlay')
    const closeBtn = sidebarContainer.querySelector('.yt-ai-sidebar-close')

    overlay.addEventListener('click', closeSidebar)
    closeBtn.addEventListener('click', closeSidebar)

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isSidebarOpen) closeSidebar()
    })

    return sidebarContainer
  }

  function showSidebar(summary, title = '') {
    const sidebar = createSidebar()

    if (!sidebar || !sidebar.isConnected) {
      console.error('[YouTube Summarizer] Sidebar container not found in DOM')
      return
    }

    const content = sidebar.querySelector('.yt-ai-sidebar-content')
    if (!content) {
      console.error('[YouTube Summarizer] Sidebar content area not found')
      return
    }

    if (title) {
      const titleEl = sidebar.querySelector('.yt-ai-sidebar-title span')
      if (titleEl) titleEl.textContent = title.length > 30 ? title.substring(0, 30) + '...' : title
    }

    content.innerHTML = `<div class="yt-ai-summary-content">${formatSummary(summary)}</div>`
    sidebar.classList.add('yt-ai-sidebar-open')
    isSidebarOpen = true
    addCopyButtons()
  }

  // NEW: Update progress in sidebar
  function updateProgress(videoId, stage, progress, message) {
    const sidebar = createSidebar()
    if (!sidebar) return

    const content = sidebar.querySelector('.yt-ai-sidebar-content')
    if (!content) return

    // Show sidebar if not already open
    if (!isSidebarOpen) {
      sidebar.classList.add('yt-ai-sidebar-open')
      isSidebarOpen = true
    }

    // Update loading state with progress
    const loadingDiv = content.querySelector('.yt-ai-loading')
    if (loadingDiv) {
      const progressBar = loadingDiv.querySelector('.yt-ai-progress-bar')
      const progressFill = progressBar?.querySelector('.yt-ai-progress-fill')
      const messageP = loadingDiv.querySelector('p')

      if (progressFill) {
        progressFill.style.width = `${progress}%`
      }

      if (messageP && message) {
        messageP.textContent = message
      }
    } else {
      // Create progress UI if it doesn't exist
      content.innerHTML = `
        <div class="yt-ai-loading">
          <div class="yt-ai-spinner"></div>
          <div class="yt-ai-progress">
            <div class="yt-ai-progress-bar">
              <div class="yt-ai-progress-fill" style="width: ${progress}%"></div>
            </div>
          </div>
          <p>${message}</p>
        </div>
      `
    }
  }

  function closeSidebar() {
    if (sidebarContainer) {
      sidebarContainer.classList.remove('yt-ai-sidebar-open')
      isSidebarOpen = false
    }
  }

  function formatSummary(summary) {
    if (!summary) return '<p>No summary available.</p>'

    let html = summary
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/^\- (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/^\[\s?(\d+):(\d+)\]\s?(.*$)/gm, '<div class="yt-ai-timestamp"><span class="time">[$1:$2]</span> <span class="text">$3</span></div>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')

    return `<div class="yt-ai-summary-text">${html}</div>`
  }

  function addCopyButtons() {
    const content = document.querySelector('.yt-ai-summary-content')
    if (!content) return

    const copyBtn = document.createElement('button')
    copyBtn.className = 'yt-ai-copy-all'
    copyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/>
      </svg>
      Copy Summary
    `

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content.innerText).then(() => {
        copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#4CAF50">
            <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z"/>
          </svg>
          Copied!
        `
        setTimeout(() => copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/>
          </svg>
          Copy Summary
        `, 2000)
      })
    })

    content.insertBefore(copyBtn, content.firstChild)
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[YouTube Summarizer] Received message:', request.action)

    if (request.action === 'ping') {
      console.log('[YouTube Summarizer] Responding to ping')
      sendResponse({ pong: true })
      return true
    }

    if (request.action === 'getVideoInfo') {
      sendResponse(getVideoInfoFromPage())
      return true
    }

    if (request.action === 'getTranscript') {
      console.log('[YouTube Summarizer] Processing getTranscript request...')
      getTranscriptFromPage()
        .then(transcript => {
          console.log('[YouTube Summarizer] Transcript extracted, sending response. Length:', transcript?.length)
          sendResponse({ transcript })
        })
        .catch(error => {
          console.error('[YouTube Summarizer] Error in getTranscript:', error)
          sendResponse({ transcript: null, error: error.message })
        })
      return true
    }

    if (request.action === 'updateProgress') {
      console.log('[YouTube Summarizer] Progress update:', request.stage, request.progress + '%')
      updateProgress(request.videoId, request.stage, request.progress, request.message)
      sendResponse({ success: true })
      return true
    }

    if (request.action === 'showSidebar') {
      showSidebar(request.summary, request.title)
      sendResponse({ success: true })
      return true
    }

    if (request.action === 'closeSidebar') {
      closeSidebar()
      sendResponse({ success: true })
      return true
    }
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => createSidebar())
  } else {
    createSidebar()
  }

} // End of ytSummarizerLoaded check
