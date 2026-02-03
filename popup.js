// Popup script for YouTube Summarizer Extension

document.addEventListener('DOMContentLoaded', async () => {
  const summarizeBtn = document.getElementById('summarizeBtn');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  const apiKeySection = document.getElementById('apiKeySection');
  const apiKeyInput = document.getElementById('apiKey');
  const saveApiKeyBtn = document.getElementById('saveApiKey');
  const openOptionsLink = document.getElementById('openOptions');

  // Get current tab
  let currentTab = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
  } catch (e) {
    console.error('Error getting current tab:', e);
  }

  // Check if API key is stored for current provider
  async function hasApiKey() {
    const settings = await chrome.storage.local.get(['apiProvider', 'anthropicKey', 'glmKey', 'apiKey']);
    const provider = settings.apiProvider || 'anthropic';

    if (provider === 'glm') {
      return !!settings.glmKey;
    } else {
      // Check for legacy apiKey or new anthropicKey
      return !!(settings.anthropicKey || settings.apiKey);
    }
  }

  // Show API key section if not configured
  if (!(await hasApiKey())) {
    apiKeySection.classList.remove('hidden');
  }

  // Extract video ID from URL
  function getVideoId(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // Update video info display
  function updateVideoInfo(videoId, title = null, thumbnail = null) {
    document.getElementById('videoId').textContent = videoId ? `Video ID: ${videoId}` : 'No YouTube video detected';
    document.getElementById('videoTitle').textContent = title || 'YouTube Video';

    if (thumbnail) {
      document.getElementById('videoThumb').innerHTML = `<img src="${thumbnail}" alt="Video thumbnail">`;
    }
  }

  // Show error message
  function showError(message) {
    errorMessage.querySelector('.message-text').textContent = message;
    errorMessage.classList.remove('hidden');
    successMessage.classList.add('hidden');
    setTimeout(() => errorMessage.classList.add('hidden'), 5000);
  }

  // Show success message
  function showSuccess(message) {
    successMessage.querySelector('.message-text').textContent = message;
    successMessage.classList.remove('hidden');
    errorMessage.classList.add('hidden');
  }

  // Set loading state
  function setLoading(loading) {
    if (loading) {
      summarizeBtn.disabled = true;
      summarizeBtn.innerHTML = '<div class="spinner"></div><span>Processing...</span>';
    } else {
      summarizeBtn.disabled = false;
      summarizeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2ZM16 18H8V16H16V18ZM16 14H8V12H16V14ZM13 9V3.5L18.5 9H13Z" fill="white"/>
        </svg>
        <span>Generate Summary</span>
      `;
    }
  }

  // Check current page for YouTube video
  if (currentTab) {
    const videoId = getVideoId(currentTab.url);

    if (videoId) {
      // Get video info from content script
      try {
        const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getVideoInfo' });
        if (response && response.title) {
          updateVideoInfo(videoId, response.title, response.thumbnail);
        } else {
          updateVideoInfo(videoId, 'YouTube Video', `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
        }
      } catch (e) {
        // Content script not loaded yet, use fallback
        updateVideoInfo(videoId, 'YouTube Video', `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
      }
    } else {
      updateVideoInfo(null);
      summarizeBtn.disabled = true;
      showError('Please navigate to a YouTube video page');
    }
  }

  // Summarize button click handler
  summarizeBtn.addEventListener('click', async () => {
    if (!currentTab) {
      showError('Unable to access current tab');
      return;
    }

    const videoId = getVideoId(currentTab.url);
    if (!videoId) {
      showError('No YouTube video detected on this page');
      return;
    }

    // Check for API key
    if (!(await hasApiKey())) {
      showError('Please set your API key first in Options');
      return;
    }

    setLoading(true);
    errorMessage.classList.add('hidden');
    successMessage.classList.add('hidden');

    try {
      // Send message to background script to fetch transcript and generate summary
      const response = await chrome.runtime.sendMessage({
        action: 'summarize',
        videoId: videoId,
        tabId: currentTab.id,
        url: currentTab.url
      });

      if (response.error) {
        showError(`Error: ${response.error}`);
      } else if (response.summary) {
        showSuccess('Summary generated! Opening sidebar...');
        openSidebarBtn.classList.remove('hidden');

        // Store summary and open sidebar
        await chrome.storage.local.set({
          currentSummary: response.summary,
          currentVideoTitle: response.title || '',
          currentVideoId: videoId
        });

        // Inject sidebar into current page
        await chrome.tabs.sendMessage(currentTab.id, {
          action: 'showSidebar',
          summary: response.summary,
          title: response.title || ''
        });
      }
    } catch (e) {
      console.error('Error:', e);
      showError('Failed to generate summary. Please try again.');
    } finally {
      setLoading(false);
    }
  });

  // Open sidebar button
  openSidebarBtn.addEventListener('click', async () => {
    if (!currentTab) return;

    const stored = await chrome.storage.local.get(['currentSummary', 'currentVideoTitle']);
    if (stored.currentSummary) {
      await chrome.tabs.sendMessage(currentTab.id, {
        action: 'showSidebar',
        summary: stored.currentSummary,
        title: stored.currentVideoTitle || ''
      });
    }
  });

  // Save API key (legacy - now redirects to options)
  saveApiKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      // Save as legacy key for backward compatibility
      await chrome.storage.local.set({ apiKey: key });
      showSuccess('API key saved! For full configuration, visit Options.');
      apiKeySection.classList.add('hidden');
    } else {
      showError('Please enter a valid API key');
    }
  });

  // Open options link
  openOptionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Check for existing summary on open
  const stored = await chrome.storage.local.get(['currentSummary', 'currentVideoId']);
  if (stored.currentSummary && stored.currentVideoId === getVideoId(currentTab?.url)) {
    openSidebarBtn.classList.remove('hidden');
  }
});
