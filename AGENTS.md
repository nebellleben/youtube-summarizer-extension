# YouTube Summarizer Extension - Agent Guide

## Project Overview
Chrome extension (Manifest V3) that generates AI-powered summaries of YouTube videos using their transcripts. Supports Anthropic Claude and Zhipu GLM APIs.

## Build/Lint/Test Commands

### No Build System
This is a vanilla Chrome extension with no build step. Files are loaded directly by Chrome.

### Reloading the Extension
After making changes to background.js or manifest.json:
```bash
# Manual reload required:
# 1. Go to chrome://extensions/
# 2. Click refresh icon on the extension card
# 3. Refresh any open YouTube pages
```

### Local Server (Optional)
```bash
pip install -r requirements.txt
python server.py
# Runs on http://127.0.0.1:5000
```

### No Test Framework
No automated tests exist. Manual testing required:
1. Load extension in Chrome
2. Navigate to YouTube video with captions
3. Click extension icon → "Generate Summary"
4. Verify transcript extraction and summary generation

## File Structure
```
├── manifest.json       # Extension config (Manifest V3)
├── background.js       # Service worker - API calls, transcript fetching, message handling
├── content.js          # Content script - DOM manipulation, transcript extraction from page
├── popup.html/js       # Extension popup UI
├── options.html/js     # Settings page
├── content.css         # Sidebar styling
├── server.py           # Optional Python backend (Flask)
└── icons/              # Extension icons (16, 48, 128px)
```

## Code Style Guidelines

### JavaScript Style
- **No TypeScript** - vanilla JavaScript only
- **ES6+ features**: Use `const`/`let`, arrow functions, async/await, template literals
- **No semicolons** at end of statements (follow existing code)
- **2-space indentation**
- **Single quotes** for strings (except when double quotes avoid escaping)

### Console Logging
Always use the prefix `[YouTube Summarizer]`:
```javascript
console.log('[YouTube Summarizer] Message here');
console.error('[YouTube Summarizer] Error:', error);
```

### Async/Await Pattern
Prefer async/await over .then() chains:
```javascript
// Preferred
async function fetchData() {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (e) {
    console.log('[YouTube Summarizer] Error:', e.message);
    return null;
  }
}
```

### Error Handling
- Always wrap async operations in try-catch
- Log errors with context
- Return null or throw descriptive errors:
```javascript
try {
  // operation
} catch (e) {
  console.log('[YouTube Summarizer] Operation failed:', e.message);
  return null;
}

// For user-facing errors
throw new Error('API key is required. Please set it in Options.');
```

### Chrome Extension APIs
- Use `chrome.storage.local` for persistence
- Use `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` for messaging
- Return `true` from message listeners with async handlers:
```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'someAction') {
    handleAsync()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
});
```

### Message Format
Standard message structure:
```javascript
// Request
{ action: 'actionName', param1: value1 }

// Response (success)
{ data: result }

// Response (error)
{ error: 'Error message' }
```

### DOM Manipulation (content.js)
- Wait for elements with setTimeout polling
- Use querySelector with multiple selectors for robustness
- Clean up UI changes after operations:
```javascript
// Wait for element
await new Promise(resolve => setTimeout(resolve, 500));

// Multiple selector fallback
const btn = document.querySelector('.class1, .class2, [data-testid="btn"]');

// Clean up
if (panel) panel.remove();
```

### API Key Handling
- Never log or expose API keys
- Store in chrome.storage.local
- Validate before use:
```javascript
const settings = await chrome.storage.local.get(['anthropicKey']);
if (!settings.anthropicKey) {
  throw new Error('API key is required. Please set it in Options.');
}
```

### Transcript Extraction
- Use fallback chain: content script → local server → YouTube API → embed API
- Accept minimum 10 characters for transcript validity
- Check response is valid JSON before parsing:
```javascript
if (text && text.trim().startsWith('{') && !text.includes('<')) {
  const data = JSON.parse(text);
}
```

## Key Architecture Patterns

### Content Script ↔ Background Communication
1. Popup sends message to background: `chrome.runtime.sendMessage({ action: 'summarize', videoId, tabId })`
2. Background fetches transcript via content script: `chrome.tabs.sendMessage(tabId, { action: 'getTranscript' })`
3. Content script returns: `{ transcript: 'text' }` or `{ error: 'message' }`
4. Background calls AI API and returns summary

### Preventing Duplicate Script Execution
```javascript
if (window.ytSummarizerLoaded) {
  console.log('[YouTube Summarizer] Script already loaded, skipping');
} else {
  window.ytSummarizerLoaded = true;
  // ... rest of script
}
```

### Caching Pattern
```javascript
const cache = new Map();

// Check cache first
if (cache.has(key)) {
  return cache.get(key);
}

// Fetch and cache
const result = await fetchData();
cache.set(key, result);
return result;
```

## Common Tasks

### Adding a New Transcript Extraction Method
1. Add async function in content.js following existing pattern
2. Call it in `getTranscriptFromPage()` in the fallback chain
3. Log with `[YouTube Summarizer] ===== METHOD: Name =====` format
4. Return null on failure, transcript string on success

### Adding a New API Provider
1. Add settings fields in options.html
2. Add provider handling in options.js
3. Add API call function in background.js (follow `generateSummaryAnthropic` pattern)
4. Update `handleSummarize()` to route to correct provider
5. Add host_permissions in manifest.json

### Debugging
- Background script logs: chrome://extensions → Service Worker link
- Content script logs: YouTube page DevTools console
- Popup logs: Right-click extension icon → Inspect popup
