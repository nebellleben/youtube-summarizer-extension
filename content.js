// Content script for YouTube Summarizer Extension

let sidebarContainer = null;
let isSidebarOpen = false;

// Get video info from page
function getVideoInfoFromPage() {
  // Try to get video ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');

  if (!videoId) return null;

  // Get video title from page
  const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.ytd-video-primary-info-renderer');
  const title = titleElement ? titleElement.textContent.trim() : '';

  // Get thumbnail
  const thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  return { videoId, title, thumbnail };
}

// Extract transcript directly from YouTube page
async function getTranscriptFromPage() {
  try {
    // Method 1: Check if transcript button exists and click it
    const showTranscriptButton = Array.from(document.querySelectorAll('button')).find(btn =>
      btn.textContent.includes('Show transcript') || btn.textContent.includes('Show transcript')
    );

    if (showTranscriptButton) {
      // Click to open transcript panel
      showTranscriptButton.click();

      // Wait for transcript to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Extract transcript text from the panel
      const transcriptSegments = document.querySelectorAll('#segments-container ytd-transcript-section-renderer');
      if (transcriptSegments.length > 0) {
        let transcript = '';
        transcriptSegments.forEach(segment => {
          const textElement = segment.querySelector('.segment-text');
          if (textElement) {
            transcript += textElement.textContent + ' ';
          }
        });

        // Close transcript panel
        const closeBtn = document.querySelector('button[aria-label="Close"], button.yt-spec-button-shape-next--tonal');
        if (closeBtn) closeBtn.click();

        if (transcript.length > 100) {
          return transcript;
        }
      }
    }

    // Method 2: Parse from ytInitialPlayerResponse
    const playerResponse = document.getElementById('initial-data')?.textContent;
    if (playerResponse) {
      const data = JSON.parse(playerResponse);
      const captions = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer?.captionTracks;

      if (captions && captions.renderer) {
        // Find the baseUrl for captions
        const baseUrl = captions.renderer?.baseUrl;
        if (baseUrl) {
          // Fetch the transcript using the baseUrl (this works because we're on the same domain)
          const response = await fetch(baseUrl + '&fmt=json3');
          const data = await response.json();

          if (data.events) {
            return data.events
              .filter(e => e.segs)
              .map(e => e.segs.map(s => s.utf8).join(''))
              .join(' ');
          }
        }
      }
    }

    // Method 3: Try to get from ytInitialPlayerResponse global variable
    if (window.ytInitialPlayerResponse) {
      const tracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        const baseUrl = tracks[0].baseUrl;
        const response = await fetch(baseUrl + '&fmt=json3');
        const data = await response.json();

        if (data.events) {
          return data.events
            .filter(e => e.segs)
            .map(e => e.segs.map(s => s.utf8).join(''))
            .join(' ');
        }
      }
    }

    // Method 4: Try to extract from the page using the hidden ytm-player-response
    const playerResponseTag = document.querySelector('ytm-player-response, #player-response');
    if (playerResponseTag) {
      const scriptContent = playerResponseTag.textContent || playerResponseTag.innerText;
      // Try to extract transcript from the JSON
      const match = scriptContent.match(/\"captions\":\{[^}]*\"captionTracks\":\[[^\]]*\]/);
      if (match) {
        // This would need more parsing, return null for now
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting transcript:', error);
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

  // Add event listeners
  const overlay = sidebarContainer.querySelector('.yt-ai-sidebar-overlay');
  const closeBtn = sidebarContainer.querySelector('.yt-ai-sidebar-close');

  overlay.addEventListener('click', closeSidebar);
  closeBtn.addEventListener('click', closeSidebar);

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSidebarOpen) {
      closeSidebar();
    }
  });

  return sidebarContainer;
}

// Show sidebar with content
function showSidebar(summary, title = '') {
  const sidebar = createSidebar();
  const content = sidebar.querySelector('.yt-ai-sidebar-content');

  // Update header title if available
  if (title) {
    const titleEl = sidebar.querySelector('.yt-ai-sidebar-title span');
    if (titleEl) titleEl.textContent = title.length > 30 ? title.substring(0, 30) + '...' : title;
  }

  // Set content
  content.innerHTML = `
    <div class="yt-ai-summary-content">
      ${formatSummary(summary)}
    </div>
  `;

  sidebar.classList.add('yt-ai-sidebar-open');
  isSidebarOpen = true;

  // Add copy buttons to code blocks if any
  addCopyButtons();
}

// Close sidebar
function closeSidebar() {
  if (sidebarContainer) {
    sidebarContainer.classList.remove('yt-ai-sidebar-open');
    isSidebarOpen = false;
  }
}

// Format summary content
function formatSummary(summary) {
  if (!summary) return '<p>No summary available.</p>';

  // Convert markdown-like formatting to HTML
  let html = summary

    // Headers
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')

    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')

    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

    // Unordered lists
    .replace(/^\- (.*$)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')

    // Ordered lists with timestamps
    .replace(/^\[\s?(\d+):(\d+)\]\s?(.*$)/gm, '<div class="yt-ai-timestamp"><span class="time">[$1:$2]</span> <span class="text">$3</span></div>')

    // Line breaks and paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<div class="yt-ai-summary-text">${html}</div>`;
}

// Add copy buttons to content
function addCopyButtons() {
  const content = document.querySelector('.yt-ai-summary-content');
  if (!content) return;

  // Add copy all button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'yt-ai-copy-all';
  copyBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/>
    </svg>
    Copy Summary
  `;

  copyBtn.addEventListener('click', () => {
    const text = content.innerText;
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#4CAF50">
          <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z"/>
        </svg>
        Copied!
      `;
      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/>
          </svg>
          Copy Summary
        `;
      }, 2000);
    });
  });

  content.insertBefore(copyBtn, content.firstChild);
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') {
    const info = getVideoInfoFromPage();
    sendResponse(info);
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

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Pre-initialize sidebar element but keep hidden
    createSidebar();
  });
} else {
  createSidebar();
}
