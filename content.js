// Content script for YouTube Summarizer Extension

// Prevent duplicate script execution
if (window.ytSummarizerLoaded) {
  console.log('[YouTube Summarizer] Script already loaded, skipping');
} else {
  window.ytSummarizerLoaded = true;
  console.log('[YouTube Summarizer] Content script loaded');

  let sidebarContainer = null;
  let isSidebarOpen = false;

  // Get video info from page
  function getVideoInfoFromPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');

    if (!videoId) return null;

    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.ytd-video-primary-info-renderer');
    const title = titleElement ? titleElement.textContent.trim() : '';

    return { videoId, title, thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` };
  }

  // Extract transcript directly from YouTube page using multiple methods
  async function getTranscriptFromPage() {
    try {
      console.log('[YouTube Summarizer] Attempting to extract transcript...');

      // Try to find ytInitialPlayerResponse in different locations
      let playerData = null;

      // Method 1: Check window.ytInitialPlayerResponse (direct)
      if (window.ytInitialPlayerResponse) {
        console.log('[YouTube Summarizer] Found ytInitialPlayerResponse on window');
        playerData = window.ytInitialPlayerResponse;
      }

      // Method 2: Check in ytcfg.data
      if (!playerData && window.ytcfg && window.ytcfg.data) {
        const ytData = window.ytcfg.data;
        console.log('[YouTube Summarizer] Found ytcfg.data');
        // The player response might be embedded here
        const playerId = Object.keys(ytData).find(k => k.startsWith('PLAYER'));
        if (playerId) {
          playerData = ytData[playerId];
          console.log('[YouTube Summarizer] Found player data in ytcfg');
        }
      }

      // Method 3: Parse from all script tags to find ytInitialPlayerResponse
      if (!playerData) {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const content = script.textContent;
          if (content && content.includes('ytInitialPlayerResponse')) {
            try {
              // Extract the JSON - it's usually: var ytInitialPlayerResponse = {...};
              const match = content.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
              if (match) {
                playerData = JSON.parse(match[1]);
                console.log('[YouTube Summarizer] Found ytInitialPlayerResponse in script tag');
                break;
              }
            } catch (e) {
              // Continue searching
            }
          }
        }
      }

      // Method 4: Parse from script tags looking for captionTracks directly
      if (playerData) {
        const tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('[YouTube Summarizer] Found caption tracks:', tracks.map(t => t.languageCode || 'unknown'));

          // Use the first available track
          const track = tracks[0];
          const baseUrl = track.baseUrl;

          if (baseUrl) {
            console.log('[YouTube Summarizer] Fetching transcript...');

            const response = await fetch(baseUrl + '&fmt=json3');
            const data = await response.json();

            if (data.events) {
              const transcript = data.events
                .filter(e => e.segs)
                .map(e => e.segs.map(s => s.utf8).join(''))
                .join(' ');

              console.log('[YouTube Summarizer] Successfully extracted transcript, length:', transcript.length);
              return transcript;
            }
          }
        } else {
          console.log('[YouTube Summarizer] No caption tracks found in player data');
        }
      }

      // Method 5: Try to extract baseUrl directly from HTML
      if (!playerData) {
        console.log('[YouTube Summarizer] Trying to extract from HTML...');
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const content = script.textContent;
          if (content && content.includes('"baseUrl"') && content.includes('"kind"')) {
            try {
              // Find all baseUrls in caption tracks
              const baseUrlMatches = content.matchAll(/"baseUrl":\s*"([^"]+)"/g);
              for (const match of baseUrlMatches) {
                const baseUrl = match[1].replace(/\\u0026/g, '&');
                if (baseUrl.includes('timedtext') || baseUrl.includes('caption')) {
                  console.log('[YouTube Summarizer] Found caption URL, trying...');

                  try {
                    const response = await fetch(baseUrl + '&fmt=json3');
                    const data = await response.json();

                    if (data.events && data.events.length > 0) {
                      const transcript = data.events
                        .filter(e => e.segs)
                        .map(e => e.segs.map(s => s.utf8).join(''))
                        .join(' ');

                      console.log('[YouTube Summarizer] Successfully extracted transcript from URL, length:', transcript.length);
                      return transcript;
                    }
                  } catch (e) {
                    // Try next URL
                  }
                }
              }
            } catch (e) {
              // Continue searching
            }
          }
        }
      }

      // Method 6: Try transcript button
      const transcriptButton = Array.from(document.querySelectorAll('button, yt-button-shape, tp-yt-paper-button')).find(el => {
        const text = el.textContent.toLowerCase();
        return text.includes('transcript') || text.includes('show transcript') || text.includes('字幕');
      });

      if (transcriptButton) {
        console.log('[YouTube Summarizer] Found transcript button, clicking...');
        transcriptButton.click();

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Try to extract from panel
        const segments = document.querySelectorAll('ytd-transcript-section-renderer, .caption-line, .caption-visual-line');
        if (segments.length > 0) {
          let transcript = '';
          segments.forEach(seg => {
            const text = seg.textContent || seg.innerText;
            if (text && text.length > 2 && !text.includes('Ads')) {
              transcript += text + ' ';
            }
          });

          // Close panel
          const closeBtn = document.querySelector('button[aria-label*="Close"], button[title*="Close"], .yt-spec-button-shape-next--tonal');
          if (closeBtn) closeBtn.click();

          if (transcript.length > 200) {
            console.log('[YouTube Summarizer] Extracted from transcript panel, length:', transcript.length);
            return transcript;
          }
        }

        // Close panel
        const closeBtn = document.querySelector('button[aria-label*="Close"], button[title*="Close"]');
        if (closeBtn) closeBtn.click();
      }

      console.log('[YouTube Summarizer] All transcript extraction methods failed');
      return null;
    } catch (error) {
      console.error('[YouTube Summarizer] Error extracting transcript:', error);
      return null;
    }
  }

  // Create sidebar element
  function createSidebar() {
    if (sidebarContainer) return sidebarContainer;

    sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'yt-ai-summarizer-sidebar';
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
            <p>Generating summary...</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(sidebarContainer);

    const overlay = sidebarContainer.querySelector('.yt-ai-sidebar-overlay');
    const closeBtn = sidebarContainer.querySelector('.yt-ai-sidebar-close');

    overlay.addEventListener('click', closeSidebar);
    closeBtn.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isSidebarOpen) closeSidebar();
    });

    return sidebarContainer;
  }

  function showSidebar(summary, title = '') {
    const sidebar = createSidebar();
    const content = sidebar.querySelector('.yt-ai-sidebar-content');

    if (title) {
      const titleEl = sidebar.querySelector('.yt-ai-sidebar-title span');
      if (titleEl) titleEl.textContent = title.length > 30 ? title.substring(0, 30) + '...' : title;
    }

    content.innerHTML = `<div class="yt-ai-summary-content">${formatSummary(summary)}</div>`;
    sidebar.classList.add('yt-ai-sidebar-open');
    isSidebarOpen = true;
    addCopyButtons();
  }

  function closeSidebar() {
    if (sidebarContainer) {
      sidebarContainer.classList.remove('yt-ai-sidebar-open');
      isSidebarOpen = false;
    }
  }

  function formatSummary(summary) {
    if (!summary) return '<p>No summary available.</p>';

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
      .replace(/\n/g, '<br>');

    return `<div class="yt-ai-summary-text">${html}</div>`;
  }

  function addCopyButtons() {
    const content = document.querySelector('.yt-ai-summary-content');
    if (!content) return;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'yt-ai-copy-all';
    copyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/>
      </svg>
      Copy Summary
    `;

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content.innerText).then(() => {
        copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#4CAF50">
            <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z"/>
          </svg>
          Copied!
        `;
        setTimeout(() => copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/>
          </svg>
          Copy Summary
        `, 2000);
      });
    });

    content.insertBefore(copyBtn, content.firstChild);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ pong: true });
      return true;
    }

    if (request.action === 'getVideoInfo') {
      sendResponse(getVideoInfoFromPage());
      return true;
    }

    if (request.action === 'getTranscript') {
      getTranscriptFromPage().then(transcript => {
        sendResponse({ transcript });
      });
      return true;
    }

    if (request.action === 'showSidebar') {
      showSidebar(request.summary, request.title);
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'closeSidebar') {
      closeSidebar();
      sendResponse({ success: true });
      return true;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => createSidebar());
  } else {
    createSidebar();
  }

} // End of ytSummarizerLoaded check
