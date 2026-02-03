// Background service worker for YouTube Summarizer Extension

// Cache for transcripts to avoid re-fetching
const transcriptCache = new Map();

// Default settings
const DEFAULT_SETTINGS = {
  localServerUrl: 'http://127.0.0.1:5000',
  useLocalServer: true
};

// Fetch transcript using multiple methods
async function fetchTranscript(videoId, tabId = null) {
  // Check cache first
  if (transcriptCache.has(videoId)) {
    return transcriptCache.get(videoId);
  }

  let transcript = null;

  // Method 0: Try content script extraction (most reliable - works within YouTube page)
  if (tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'getTranscript' });
      if (response && response.transcript) {
        transcript = response.transcript;
        console.log('Transcript extracted from page');
      }
    } catch (e) {
      console.log('Content script extraction failed:', e.message);
    }
  }

  // Method 1: Try local server (if available)
  if (!transcript) {
    const settings = await chrome.storage.local.get(['useLocalServer', 'localServerUrl']);
    const useLocalServer = settings.useLocalServer !== undefined ? settings.useLocalServer : true;
    const localServerUrl = settings.localServerUrl || DEFAULT_SETTINGS.localServerUrl;

    if (useLocalServer) {
      try {
        const response = await fetch(`${localServerUrl}/api/transcript`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ video_id: videoId })
        });

        if (response.ok) {
          const data = await response.json();
          if (data && data.transcript) {
            transcript = data.transcript;
            console.log('Transcript fetched from local server');
          }
        }
      } catch (e) {
        console.log('Local server not available, trying fallback methods:', e.message);
      }
    }
  }

  // Method 2: YouTube timedtext API (direct from YouTube)
  if (!transcript) {
    try {
      // Try to get transcript using YouTube's internal API
      const response = await fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.events) {
          transcript = data.events
            .filter(e => e.segs)
            .map(e => e.segs.map(s => s.utf8).join(''))
            .join(' ');
          console.log('Transcript fetched from YouTube timedtext API');
        }
      }
    } catch (e) {
      console.log('YouTube timedtext API failed:', e.message);
    }
  }

  // Method 3: Alternative method for YouTube captions
  if (!transcript) {
    try {
      // This method fetches the raw transcript data
      const response = await fetch(
        `https://youtubetranscript.com/?serverUrl=https://www.youtube.com/watch?v=${videoId}`
      );

      if (response.ok) {
        const text = await response.text();
        // Try to extract JSON data from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          if (data && data.transcript) {
            transcript = data.transcript.map(item => item.text).join(' ');
            console.log('Transcript fetched from youtubetranscript.com');
          }
        }
      }
    } catch (e) {
      console.log('youtubetranscript.com failed:', e.message);
    }
  }

  if (transcript) {
    transcriptCache.set(videoId, transcript);
  }

  return transcript;
}

// Extract video ID from various YouTube URL formats
function extractVideoId(url) {
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

// Get language name for prompt
function getLanguageName(code) {
  const languages = {
    'zh-TW': 'Traditional Chinese (繁體中文)',
    'zh-CN': 'Simplified Chinese (简体中文)',
    'en': 'English',
    'ja': 'Japanese (日本語)',
    'ko': 'Korean (한국어)'
  };
  return languages[code] || 'English';
}

// Generate JWT token for GLM API
async function generateGLMToken(apiKey) {
  // GLM API key format: id.secret
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid GLM API key format. Expected: id.secret');
  }

  const [id, secret] = parts;

  // Create JWT payload
  const now = Date.now();
  const payload = {
    api_key: id,
    exp: now + 3600 * 1000, // 1 hour expiration
    timestamp: now
  };

  // JWT header
  const header = {
    alg: 'HS256',
    sign_type: 'SIGN'
  };

  // Base64URL encode function (handles Unicode properly)
  function base64UrlEncode(str) {
    // Convert string to UTF-8 bytes
    const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
      return String.fromCharCode('0x' + p1);
    });
    return btoa(utf8Bytes)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  // Create signature data
  const data = `${encodedHeader}.${encodedPayload}`;

  // Generate HMAC-SHA256 signature using Web Crypto API
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);

  // Convert signature to base64url
  const signatureArray = Array.from(new Uint8Array(signature));
  const signatureString = btoa(String.fromCharCode.apply(null, signatureArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${data}.${signatureString}`;
}

// Generate summary using GLM API
async function generateSummaryGLM(transcript, videoId, apiKey, settings = {}) {
  if (!transcript) {
    throw new Error('Could not fetch transcript for this video');
  }

  // Truncate transcript if too long
  const maxChars = 100000;
  let trimmedTranscript = transcript;
  if (transcript.length > maxChars) {
    trimmedTranscript = transcript.substring(0, maxChars) + '...';
  }

  const language = settings.summaryLanguage || 'zh-TW';
  const languageName = getLanguageName(language);
  const includeTimestamps = settings.includeTimestamps !== undefined ? settings.includeTimestamps : true;

  let timestampInstruction = includeTimestamps ?
    '2. Key discussion points with approximate timestamps (use [MM:SS] or [HH:MM:SS] format)' :
    '2. Key discussion points in chronological order';

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

${trimmedTranscript}`;

  const model = settings.glmModel || 'glm-4-flash';

  try {
    // Generate JWT token
    const token = await generateGLMToken(apiKey);

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
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || error.message || 'GLM API request failed');
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    throw new Error(`GLM API error: ${error.message}`);
  }
}

// Generate summary using Anthropic Claude API
async function generateSummaryAnthropic(transcript, videoId, apiKey, settings = {}) {
  if (!transcript) {
    throw new Error('Could not fetch transcript for this video');
  }

  // Truncate transcript if too long (Claude has limits)
  const maxChars = 100000;
  let trimmedTranscript = transcript;
  if (transcript.length > maxChars) {
    trimmedTranscript = transcript.substring(0, maxChars) + '...';
  }

  const language = settings.summaryLanguage || 'zh-TW';
  const languageName = getLanguageName(language);
  const includeTimestamps = settings.includeTimestamps !== undefined ? settings.includeTimestamps : true;

  let timestampInstruction = includeTimestamps ?
    '2. Key discussion points with approximate timestamps (use [MM:SS] or [HH:MM:SS] format)' :
    '2. Key discussion points in chronological order';

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

${trimmedTranscript}`;

  const model = settings.anthropicModel || 'claude-sonnet-4-20250514';

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
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    throw new Error(`Summary generation failed: ${error.message}`);
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarize(request)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'clearCache') {
    transcriptCache.clear();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'testLocalServer') {
    testLocalServer(request.serverUrl)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Test if local server is available
async function testLocalServer(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/health`);
    return { success: response.ok };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Handle summarize action
async function handleSummarize(request) {
  const { videoId, tabId } = request;

  // Get all settings
  const settings = await chrome.storage.local.get([
    'apiProvider',
    'anthropicKey',
    'anthropicModel',
    'glmKey',
    'glmModel',
    'apiKey',  // legacy
    'model',   // legacy
    'summaryLanguage',
    'includeTimestamps',
    'useLocalServer',
    'localServerUrl'
  ]);

  // Determine API provider
  const provider = settings.apiProvider || 'anthropic';

  // Get API key based on provider (with legacy support)
  let apiKey = null;
  if (provider === 'glm') {
    apiKey = settings.glmKey;
    if (!apiKey) {
      throw new Error('Zhipu AI API key is required. Please set it in Options.');
    }
  } else {
    apiKey = settings.anthropicKey || settings.apiKey;
    if (!apiKey) {
      throw new Error('API key is required. Please set it in Options.');
    }
  }

  if (!videoId) {
    throw new Error('Could not extract video ID from the current page');
  }

  // Fetch transcript (pass tabId for content script extraction)
  const transcript = await fetchTranscript(videoId, tabId);

  if (!transcript) {
    throw new Error('Could not fetch transcript. The video may not have captions available, or the local server is not running.');
  }

  // Generate summary based on provider
  let summary;
  if (provider === 'glm') {
    summary = await generateSummaryGLM(transcript, videoId, apiKey, settings);
  } else {
    summary = await generateSummaryAnthropic(transcript, videoId, apiKey, settings);
  }

  // Get video title from storage or fetch it
  let title = 'YouTube Video Summary';
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'getVideoInfo' });
      if (response && response.title) {
        title = response.title;
      }
    }
  } catch (e) {
    console.log('Could not get video title:', e.message);
  }

  return {
    summary,
    title,
    videoId
  };
}

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }
});
