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

  // Extract transcript using YouTube Player API
  async function getTranscriptFromPlayerAPI() {
    console.log('[YouTube Summarizer] ===== METHOD: Player API =====');

    try {
      // Wait for player to be available
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get player element
      const playerElement = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      if (!playerElement) {
        console.log('[YouTube Summarizer] Player element not found');
        return null;
      }

      console.log('[YouTube Summarizer] Player element found');

      // Try to access player API
      if (typeof playerElement.getOption === 'function') {
        console.log('[YouTube Summarizer] Player API accessible');

        // Get caption track list
        try {
          const captionTracks = playerElement.getOption('captions', 'tracklist');
          console.log('[YouTube Summarizer] Found', captionTracks?.length || 0, 'caption tracks via Player API');

          if (captionTracks && captionTracks.length > 0) {
            // Prioritize auto-generated captions
            const sortedTracks = [...captionTracks].sort((a, b) => {
              const aIsAuto = a.kind === 'asr' || a.languageCode?.includes('auto') || a.name?.toLowerCase().includes('auto');
              const bIsAuto = b.kind === 'asr' || b.languageCode?.includes('auto') || b.name?.toLowerCase().includes('auto');
              if (aIsAuto && !bIsAuto) return -1;
              if (!aIsAuto && bIsAuto) return 1;
              return 0;
            });

            // Try to set the first track and extract its data
            for (const track of sortedTracks) {
              const isAuto = track.kind === 'asr' || track.languageCode?.includes('auto') || track.name?.toLowerCase().includes('auto');
              const trackName = track.name?.simpleText || track.name?.runs?.[0]?.text || track.languageCode || 'unknown';

              console.log(`[YouTube Summarizer] Trying track: ${trackName}${isAuto ? ' [AUTO]' : ''}`);

              try {
                // Set the caption track
                playerElement.setOption('captions', 'track', track);

                // Wait for captions to load
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Get the current caption data
                if (typeof playerElement.getOption === 'function') {
                  const currentTrack = playerElement.getOption('captions', 'track');
                  if (currentTrack && currentTrack.captionTracks) {
                    console.log('[YouTube Summarizer] Caption tracks data available');

                    // Try to extract from the caption tracks
                    for (const ct of currentTrack.captionTracks) {
                      if (ct.baseUrl) {
                        try {
                          const response = await fetch(ct.baseUrl + (ct.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3');
                          if (response.ok) {
                            const text = await response.text();
                            if (text && text.trim().startsWith('{')) {
                              const data = JSON.parse(text);
                              if (data.events && data.events.length > 0) {
                                const transcript = data.events
                                  .filter(e => e.segs)
                                  .map(e => e.segs.map(s => s.utf8).join(''))
                                  .join(' ');
                                if (transcript.length > 10) {
                                  console.log(`[YouTube Summarizer] ===== SUCCESS: Player API extracted transcript, length: ${transcript.length} =====`);
                                  return transcript;
                                }
                              }
                            }
                          }
                        } catch (e) {
                          console.log('[YouTube Summarizer] Failed to fetch from track baseUrl:', e.message);
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.log('[YouTube Summarizer] Failed to set track:', e.message);
              }
            }
          }
        } catch (e) {
          console.log('[YouTube Summarizer] Player API getOption failed:', e.message);
        }

        // Alternative: Try to access player data directly
        try {
          const playerData = playerElement.getPlayerResponse?.() || playerElement.getVideoData?.();
          if (playerData) {
            console.log('[YouTube Summarizer] Player data available via getPlayerResponse');

            const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (captionTracks && captionTracks.length > 0) {
              console.log('[YouTube Summarizer] Found', captionTracks.length, 'caption tracks in player data');

              // Sort to prioritize auto-generated
              const sortedTracks = [...captionTracks].sort((a, b) => {
                const aIsAuto = a.kind === 'asr' || a.languageCode?.includes('auto') || a.name?.toLowerCase().includes('auto');
                const bIsAuto = b.kind === 'asr' || b.languageCode?.includes('auto') || b.name?.toLowerCase().includes('auto');
                if (aIsAuto && !bIsAuto) return -1;
                if (!aIsAuto && bIsAuto) return 1;
                return 0;
              });

              for (const track of sortedTracks) {
                if (track.baseUrl) {
                  try {
                    const isAuto = track.kind === 'asr' || track.languageCode?.includes('auto');
                    console.log(`[YouTube Summarizer] Fetching from player data track${isAuto ? ' [AUTO]' : ''}`);

                    const response = await fetch(track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3');
                    if (response.ok) {
                      const text = await response.text();
                      if (text && text.trim().startsWith('{')) {
                        const data = JSON.parse(text);
                        if (data.events && data.events.length > 0) {
                          const transcript = data.events
                            .filter(e => e.segs)
                            .map(e => e.segs.map(s => s.utf8).join(''))
                            .join(' ');
                          if (transcript.length > 10) {
                            console.log(`[YouTube Summarizer] ===== SUCCESS: Player data API extracted transcript, length: ${transcript.length} =====`);
                            return transcript;
                          }
                        }
                      }
                    }
                  } catch (e) {
                    console.log('[YouTube Summarizer] Failed to fetch from player data track:', e.message);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.log('[YouTube Summarizer] Player getPlayerResponse failed:', e.message);
        }
      } else {
        console.log('[YouTube Summarizer] Player API not accessible (getOption not available)');
      }
    } catch (e) {
      console.log('[YouTube Summarizer] Player API method failed:', e.message);
    }

    return null;
  }

  // Extract transcript by navigating caption settings menu
  async function getTranscriptViaCaptionMenu() {
    console.log('[YouTube Summarizer] ===== METHOD: Caption Settings Menu =====');

    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find the settings (gear) button in player controls
      const settingsButton = document.querySelector('.ytp-settings-button, button[aria-label*="Settings"], button[aria-label*="settings"]');
      if (!settingsButton) {
        console.log('[YouTube Summarizer] Settings button not found');
        return null;
      }

      console.log('[YouTube Summarizer] Settings button found, clicking...');

      // Click settings button
      settingsButton.click();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Look for "Subtitles/CC" option in the settings menu
      const menuItems = document.querySelectorAll('.ytp-menuitem, .ytp-menuitem-label, [role="menuitem"]');
      let subtitlesItem = null;

      for (const item of menuItems) {
        const text = item.textContent.toLowerCase().trim();
        if (text.includes('subtitles') || text.includes('captions') || text.includes('cc') || text.includes('字幕')) {
          subtitlesItem = item;
          console.log('[YouTube Summarizer] Found subtitles menu item:', text);
          break;
        }
      }

      if (!subtitlesItem) {
        console.log('[YouTube Summarizer] Subtitles menu item not found');
        // Close settings menu
        if (settingsButton) settingsButton.click();
        return null;
      }

      // Click subtitles/CC option
      subtitlesItem.click();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Look for auto-generated caption option
      const captionMenuItems = document.querySelectorAll('.ytp-menuitem');
      let autoCaptionItem = null;

      for (const item of captionMenuItems) {
        const text = item.textContent.toLowerCase().trim();
        if (text.includes('auto') || text.includes('auto-generated') || text.includes('自动生成') || text.includes('自動產生')) {
          autoCaptionItem = item;
          console.log('[YouTube Summarizer] Found auto-caption item:', text);
          break;
        }
      }

      if (autoCaptionItem) {
        console.log('[YouTube Summarizer] Clicking auto-caption option...');

        // Click auto-generated captions
        autoCaptionItem.click();
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Now try to extract using Player API again
        const transcript = await getTranscriptFromPlayerAPI();
        if (transcript) {
          console.log('[YouTube Summarizer] ===== SUCCESS via Caption Menu + Player API =====\n');
          return transcript;
        }
      } else {
        console.log('[YouTube Summarizer] Auto-caption option not found in menu');
      }

      // Close settings menu by clicking elsewhere
      document.body.click();
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (e) {
      console.log('[YouTube Summarizer] Caption menu navigation failed:', e.message);
    }

    return null;
  }

  // Extract transcript using embed player API
  async function getTranscriptViaEmbedPlayer(videoId) {
    console.log('[YouTube Summarizer] ===== METHOD: Embed Player API =====');

    return new Promise((resolve) => {
      try {
        // Create a hidden iframe
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.style.position = 'fixed';
        iframe.style.top = '-9999px';
        iframe.style.left = '-9999px';
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.setAttribute('allow', 'autoplay; encrypted-media');

        const embedUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&cc_load_policy=1`;
        iframe.src = embedUrl;

        console.log('[YouTube Summarizer] Creating embed iframe:', embedUrl);

        // Timeout after 15 seconds
        const timeout = setTimeout(() => {
          console.log('[YouTube Summarizer] Embed player timeout');
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
          resolve(null);
        }, 15000);

        // Listen for messages from the embed player
        const messageListener = (event) => {
          if (!event.data) return;

          // YouTube player API sends messages with structure like { event: "infoDelivery", info: {...} }
          if (event.data.event === 'infoDelivery' && event.data.info) {
            const info = event.data.info;
            console.log('[YouTube Summarizer] Embed player info received');

            if (info.captionTracks && info.captionTracks.length > 0) {
              console.log('[YouTube Summarizer] Found', info.captionTracks.length, 'caption tracks in embed player');

              // Try to fetch from each track
              (async () => {
                for (const track of info.captionTracks) {
                  if (track.baseUrl) {
                    try {
                      const isAuto = track.kind === 'asr' || track.name?.toLowerCase().includes('auto');
                      console.log(`[YouTube Summarizer] Fetching from embed track${isAuto ? ' [AUTO]' : ''}`);

                      const response = await fetch(track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3');
                      if (response.ok) {
                        const text = await response.text();
                        if (text && text.trim().startsWith('{')) {
                          const data = JSON.parse(text);
                          if (data.events && data.events.length > 0) {
                            const transcript = data.events
                              .filter(e => e.segs)
                              .map(e => e.segs.map(s => s.utf8).join(''))
                              .join(' ');

                            if (transcript.length > 10) {
                              clearTimeout(timeout);
                              window.removeEventListener('message', messageListener);
                              if (iframe.parentNode) {
                                iframe.parentNode.removeChild(iframe);
                              }
                              console.log(`[YouTube Summarizer] ===== SUCCESS: Embed player extracted transcript, length: ${transcript.length} =====`);
                              resolve(transcript);
                              return;
                            }
                          }
                        }
                      }
                    } catch (e) {
                      console.log('[YouTube Summarizer] Failed to fetch from embed track:', e.message);
                    }
                  }
                }
              })();
            }
          }
        };

        // Listen for iframe load
        iframe.addEventListener('load', () => {
          console.log('[YouTube Summarizer] Embed iframe loaded');

          // Try to post message to get player info
          setTimeout(() => {
            try {
              const playerWindow = iframe.contentWindow;
              if (playerWindow) {
                // Send a message to get player info
                playerWindow.postMessage({ event: 'listening', id: 'ytsummarizer' }, '*');

                // Request caption tracks
                setTimeout(() => {
                  playerWindow.postMessage({ event: 'requestInfo', id: 'ytsummarizer' }, '*');
                }, 1000);
              }
            } catch (e) {
              console.log('[YouTube Summarizer] Failed to communicate with embed player:', e.message);
            }
          }, 2000);
        });

        iframe.addEventListener('error', () => {
          console.log('[YouTube Summarizer] Embed iframe error');
          clearTimeout(timeout);
          window.removeEventListener('message', messageListener);
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
          resolve(null);
        });

        // Add iframe to DOM
        document.body.appendChild(iframe);
        window.addEventListener('message', messageListener);

      } catch (e) {
        console.log('[YouTube Summarizer] Embed player method failed:', e.message);
        resolve(null);
      }
    });
  }

  // Extract transcript directly from YouTube page using multiple methods
  async function getTranscriptFromPage() {
    console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: Starting transcript extraction =====');
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const videoId = urlParams.get('v');

      console.log('[YouTube Summarizer] Current URL:', window.location.href);
      console.log('[YouTube Summarizer] Extracted video ID:', videoId);

      if (!videoId) {
        console.log('[YouTube Summarizer] ===== ERROR: No video ID found');
        return null;
      }

      // === NEW METHOD: YouTube Player API (most reliable for auto-captions) ===
      const playerAPITranscript = await getTranscriptFromPlayerAPI();
      if (playerAPITranscript) {
        console.log('[YouTube Summarizer] ===== SUCCESS via Player API =====\n');
        return playerAPITranscript;
      }

      // === METHOD: Caption Settings Menu (for videos with auto-captions) ===
      const captionMenuTranscript = await getTranscriptViaCaptionMenu();
      if (captionMenuTranscript) {
        console.log('[YouTube Summarizer] ===== SUCCESS via Caption Menu =====\n');
        return captionMenuTranscript;
      }

      // === METHOD: Embed Player API (fallback for blocked requests) ===
      const embedTranscript = await getTranscriptViaEmbedPlayer(videoId);
      if (embedTranscript) {
        console.log('[YouTube Summarizer] ===== SUCCESS via Embed Player =====\n');
        return embedTranscript;
      }

      // === PRIMARY METHOD: DOM-based transcript extraction ===
      // This method clicks YouTube's transcript button and reads from the DOM
      // It's the most reliable because YouTube handles authentication
      console.log('[YouTube Summarizer] Using DOM-based transcript extraction...');

      // Wait a bit for page to fully load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Find and click the transcript button
      // YouTube has multiple button types/locations, so we search thoroughly
      let transcriptButton = null;

      // Method 1: Look for button with "Show transcript" text
      const allButtons = Array.from(document.querySelectorAll('button, yt-button-shape, tp-yt-paper-button, [role="button"]'));
      transcriptButton = allButtons.find(el => {
        const text = el.textContent.toLowerCase().trim();
        return text === 'show transcript' || text === 'transcript' || text === '字幕' || text === '顯示字幕' ||
               text === 'show transcript (' || text.includes('show transcript');
      });

      // Method 2: Look for the target button with yt-attributed-string
      if (!transcriptButton) {
        const targetButtons = document.querySelectorAll('button[target-id], yt-button-shape');
        for (const btn of targetButtons) {
          const text = btn.textContent.toLowerCase().trim();
          if (text.includes('transcript') || text.includes('字幕')) {
            transcriptButton = btn;
            break;
          }
        }
      }

      // Method 3: Look in the description/panels area for transcript
      if (!transcriptButton) {
        // YouTube's transcript button is often in the "more options" menu (three dots)
        // or in the description panel. Let's try to find it in the panels.
        const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer, ytd-expander, ytd-text-inline-expander');
        for (const panel of panels) {
          const buttons = panel.querySelectorAll('button, [role="button"]');
          for (const btn of buttons) {
            const text = btn.textContent.toLowerCase().trim();
            if (text.includes('transcript') || text.includes('字幕')) {
              transcriptButton = btn;
              break;
            }
          }
          if (transcriptButton) break;
        }
      }

      // Method 4: Try clicking the "more options" (three dots) button and look for transcript there
      if (!transcriptButton) {
        // Find the three dots button near the video
        const moreButton = Array.from(document.querySelectorAll('button, yt-icon-button, yt-button-shape')).find(el => {
          // Check for aria-label or tooltip containing "more"
          const aria = el.getAttribute('aria-label') || '';
          const tooltip = el.getAttribute('title') || '';
          return aria.toLowerCase().includes('more') || tooltip.toLowerCase().includes('more');
        });

        if (moreButton) {
          console.log('[YouTube Summarizer] Found more options button, clicking to look for transcript...');
          moreButton.click();
          await new Promise(resolve => setTimeout(resolve, 500));

          // Look for transcript in the opened menu
          const menuItems = document.querySelectorAll('tp-yt-paper-item, [role="menuitem"], yt-menu-item');
          for (const item of menuItems) {
            const text = item.textContent.toLowerCase().trim();
            if (text.includes('transcript') || text.includes('字幕') || text.includes('show transcript')) {
              transcriptButton = item;
              console.log('[YouTube Summarizer] Found transcript in menu');
              break;
            }
          }

          // If not found in menu, click elsewhere to close it
          if (!transcriptButton) {
            document.body.click();
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }

      if (transcriptButton) {
        console.log('[YouTube Summarizer] Found transcript button, clicking...');

        // Scroll button into view to ensure it's clickable
        transcriptButton.scrollIntoView({ behavior: 'instant', block: 'center' });

        // Click the button
        transcriptButton.click();

        // Wait for the transcript panel to load and render
        // Use a polling mechanism to wait for actual transcript content
        let transcriptReady = false;
        let attempts = 0;
        const maxAttempts = 20;

        while (!transcriptReady && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 300));
          attempts++;

          // Check if transcript segments are loaded
          const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
          if (segments.length >= 50) {
            // We have a reasonable number of segments, consider it ready
            transcriptReady = true;
          }
        }

        console.log(`[YouTube Summarizer] Waited ${attempts * 300}ms for transcript panel, found ${document.querySelectorAll('ytd-transcript-segment-renderer').length} segments`);

        // Try to extract transcript from the panel
        // YouTube uses ytd-transcript-section-renderer or similar elements
        let transcript = '';

        // Method 1: Look for transcript segment lines
        const segmentSelectors = [
          'ytd-transcript-segment-renderer',
          'ytd-transcript-section-renderer ytd-transcript-segment-renderer',
          '.caption-line',
          '.caption-visual-line'
        ];

        for (const selector of segmentSelectors) {
          const segments = document.querySelectorAll(selector);
          if (segments.length >= 10) {
            console.log(`[YouTube Summarizer] Found ${segments.length} segments with selector: ${selector}`);

            // Debug: Log structure of first segment
            if (segments.length > 0) {
              const firstSeg = segments[0];
              console.log('[YouTube Summarizer] First segment tagName:', firstSeg.tagName);
              console.log('[YouTube Summarizer] First segment outerHTML (first 500 chars):', firstSeg.outerHTML?.substring(0, 500));
              console.log('[YouTube Summarizer] First segment innerHTML (first 300 chars):', firstSeg.innerHTML?.substring(0, 300));
              console.log('[YouTube Summarizer] First segment textContent (first 300 chars):', firstSeg.textContent?.substring(0, 300));
              console.log('[YouTube Summarizer] First segment children count:', firstSeg.children?.length || 0);
              console.log('[YouTube Summarizer] First segment classList:', firstSeg.classList?.toString() || 'none');
            }

            let segmentCount = 0;
            for (const seg of segments) {
              // Try ALL possible ways to extract text
              let text = '';

              // Method A: Try .caption-visual-line class
              const textElementA = seg.querySelector('.caption-visual-line');
              if (textElementA && textElementA.textContent) {
                text = textElementA.textContent.trim();
              }

              // Method B: Try yt-attributed-string (new YouTube structure)
              if (!text) {
                const attributedString = seg.querySelector('yt-attributed-string');
                if (attributedString && attributedString.textContent) {
                  text = attributedString.textContent.trim();
                }
              }

              // Method C: Try direct textContent if method A failed
              if (!text) {
                text = seg.textContent.trim();
              }

              // Method D: Try children elements recursively
              if (!text && seg.children.length > 0) {
                for (const child of seg.children) {
                  const childText = child.textContent.trim();
                  if (childText.length > 2) {
                    text = childText;
                    break;
                  }
                }
              }

              // Method E: Try aria-label attribute
              if (!text) {
                const ariaLabel = seg.getAttribute('aria-label');
                if (ariaLabel) {
                  text = ariaLabel.trim();
                }
              }

              // Method F: Try any element with text
              if (!text) {
                const textElements = seg.querySelectorAll('*');
                for (const el of textElements) {
                  const elText = el.textContent.trim();
                  if (elText && elText.length > 2 && elText.length < 500) {
                    text = elText;
                    break;
                  }
                }
              }

              // Count segments with text
              if (text) {
                segmentCount++;
              }

              // Filter out non-content text
              // Real transcript text should:
              // - Be longer than 1 character (reduced from 3)
              // - Not be just numbers/timestamps
              // - Not contain common UI text
              const isUIText = /^(Home|Shorts|Subscriptions|Library|History|Watch later|Liked|Search|Sign in|Settings|Help|Report|Privacy|Terms)/i.test(text);
              const isTimestamp = /^[\d:\[\]\s\-]+$/.test(text);
              const isNumber = /^\d+$/.test(text);

              if (text && text.length > 1 && !isUIText && !isTimestamp && !isNumber) {
                transcript += text + ' ';
              }
            }

            console.log(`[YouTube Summarizer] Processed ${segmentCount}/${segments.length} segments with text`);
            console.log(`[YouTube Summarizer] Extracted ${transcript.length} characters from ${segments.length} segments`);

            if (transcript.length > 10) {
              console.log(`[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via DOM extraction, length: ${transcript.length} =====\n`);
              return transcript.trim();
            } else {
              console.log('[YouTube Summarizer] DOM extraction returned too little text:', transcript.length, '- Transcript panel may not have loaded properly');
              console.log('[YouTube Summarizer] Trying brute force text extraction from transcript panel...');

              // FINAL FALLBACK: Get ALL text from transcript panel regardless of structure
              const transcriptPanel = document.querySelector('ytd-transcript-section-renderer, #engagement-panel-transcript');
              if (transcriptPanel) {
                console.log('[YouTube Summarizer] Found transcript panel, attempting brute force extraction');

                // Use TreeWalker to get all text nodes
                const walker = document.createTreeWalker(
                  transcriptPanel,
                  NodeFilter.SHOW_TEXT,
                  {
                    acceptNode: (node) => {
                      const text = node.textContent.trim();
                      // Filter out very short text and common UI elements
                      if (text.length < 2) return NodeFilter.FILTER_REJECT;
                      if (/^(Home|Shorts|Subscriptions|Library|History|Watch later|Liked|Search|Sign in|Settings|Help|Report|Privacy|Terms|\d+:\d+|\d+:\d+:\d+)/i.test(text)) {
                        return NodeFilter.FILTER_REJECT;
                      }
                      return NodeFilter.FILTER_ACCEPT;
                    }
                  }
                );

                let node;
                let allText = '';
                while (node = walker.nextNode()) {
                  const text = node.textContent.trim();
                  if (text && text.length > 2) {
                    allText += text + ' ';
                  }
                }

                console.log('[YouTube Summarizer] Brute force extracted:', allText.length, 'characters');
                if (allText.length > 10) {
                  console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via brute force, length:', allText.length, '=====\n');
                  return allText.trim();
                }
              } else {
                console.log('[YouTube Summarizer] Transcript panel not found for brute force extraction');
              }
            }
          }
        }

        // Method 2: If that didn't work, try a broader search
        if (transcript.length < 100) {
          console.log('[YouTube Summarizer] Trying broader DOM search...');
          const transcriptPanel = document.querySelector('ytd-transcript-section-renderer, ytd-transcript-search-panel-renderer, #sections');
          if (transcriptPanel) {
            // Get all text nodes within the panel
            const walker = document.createTreeWalker(
              transcriptPanel,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (node) => {
                  const text = node.textContent.trim();
                  // Filter out timestamps, UI elements
                  if (text.length < 2 || /^\d+:\d+$/.test(text) || /^\[\d+:\d+\]$/.test(text)) {
                    return NodeFilter.FILTER_REJECT;
                  }
                  return NodeFilter.FILTER_ACCEPT;
                }
              }
            );

            let node;
            while (node = walker.nextNode()) {
              const text = node.textContent.trim();
              if (text && text.length > 2 && !text.includes('Continue') && !text.includes('Close')) {
                transcript += text + ' ';
              }
            }
          }
        }

        // Close the transcript panel
        console.log('[YouTube Summarizer] Closing transcript panel...');
        const closeSelectors = [
          'button[aria-label*="Close"]',
          'button[aria-label*="close"]',
          'button[title*="Close"]',
          'yt-icon-button#close-button',
          '.yt-spec-button-shape-next--tonal[aria-label*="close"]'
        ];

        for (const selector of closeSelectors) {
          const closeBtn = document.querySelector(selector);
          if (closeBtn) {
            closeBtn.click();
            await new Promise(resolve => setTimeout(resolve, 500));
            break;
          }
        }

        // Also try clicking the transcript button again to toggle it off
        try {
          transcriptButton.click();
        } catch (e) {
          // Ignore
        }

        if (transcript.length > 10) {
          console.log(`[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via DOM extraction, length: ${transcript.length} =====\n`);
          console.log('[YouTube Summarizer] About to return transcript from getTranscriptFromPage...');
          const result = transcript.trim();
          console.log('[YouTube Summarizer] Transcript trimmed, length:', result.length);
          return result;
        } else {
          console.log('[YouTube Summarizer] DOM extraction returned too little text:', transcript.length, '- Transcript panel may not have loaded properly');
        }
      } else {
        console.log('[YouTube Summarizer] Transcript button not found - checking page data for captions...');

        // Check if captions exist in the page data
        let hasCaptions = false;
        let playerData = null;

        // First check window directly
        if (window.ytInitialPlayerResponse) {
          playerData = window.ytInitialPlayerResponse;
        }

        // If not on window, search in scripts
        if (!playerData) {
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent;
            if (content && content.includes('ytInitialPlayerResponse')) {
              try {
                let match = content.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
                if (!match) match = content.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
                if (!match) match = content.match(/"ytInitialPlayerResponse":({.+?})(,"|})/s);
                if (match) {
                  playerData = JSON.parse(match[1]);
                  break;
                }
              } catch (e) {
                // Continue
              }
            }
          }
        }

        // Check for caption tracks
        if (playerData) {
          const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
                                playerData.playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (captionTracks && captionTracks.length > 0) {
            hasCaptions = true;
            console.log(`[YouTube Summarizer] Video has ${captionTracks.length} caption track(s) but transcript button not accessible`);
          }
        }

        if (!hasCaptions) {
          console.log('[YouTube Summarizer] This video does not have any captions/subtitles available');
        }
      }

      // === FALLBACK: Try direct API (limited success) ===
      console.log('[YouTube Summarizer] Trying direct API as fallback...');
      const langs = ['en', 'en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi', 'id'];

      for (const lang of langs) {
        try {
          const directUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
          const response = await fetch(directUrl, {
            method: 'GET',
            headers: { 'Referer': 'https://www.youtube.com/' }
          });

          if (response.ok) {
            const text = await response.text();
            if (text && text.trim() !== '' && !text.includes('<')) {
              const data = JSON.parse(text);
              if (data.events && data.events.length > 0) {
                const transcript = data.events
                  .filter(e => e.segs)
                  .map(e => e.segs.map(s => s.utf8).join(''))
                  .join(' ');
                if (transcript.length > 10) {
                  console.log(`[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via direct API (${lang}), length: ${transcript.length} =====\n`);
                  return transcript;
                }
              }
            }
          }
        } catch (e) {
          console.log(`[YouTube Summarizer] Direct API failed for ${lang}:`, e.message);
          // Continue to next language
        }
      }

      // Try with type=caption parameter
      for (const lang of langs) {
        try {
          const directUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3&type=caption`;
          const response = await fetch(directUrl);

          if (response.ok) {
            const text = await response.text();
            if (text && text.trim() !== '' && !text.includes('<')) {
              const data = JSON.parse(text);
              if (data.events && data.events.length > 0) {
                const transcript = data.events
                  .filter(e => e.segs)
                  .map(e => e.segs.map(s => s.utf8).join(''))
                  .join(' ');
                if (transcript.length > 10) {
                  console.log(`[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via direct API with type=caption (${lang}), length: ${transcript.length} =====\n`);
                  return transcript;
                }
              }
            }
          }
        } catch (e) {
          console.log(`[YouTube Summarizer] Direct API with type=caption failed for ${lang}:`, e.message);
          // Continue
        }
      }

      // === AUTO-GENERATED CAPTIONS ===
      // YouTube stores auto-generated captions differently - try to access them
      console.log('[YouTube Summarizer] Trying auto-generated captions...');
      console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: Method - Direct API Auto-Captions =====');

      // Method 1: Try direct API with caps=asr parameter
      const autoLangs = ['en', 'en-US', 'en-GB', 'zh-CN', 'zh-TW', 'zh-HK', 'ja', 'ko', 'es', 'fr', 'de'];
      for (const lang of autoLangs) {
        try {
          // Auto-generated captions use caps=asr parameter
          const autoUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3&caps=asr`;
          const response = await fetch(autoUrl);

          if (response.ok) {
            const text = await response.text();
            if (text && text.trim() !== '' && !text.includes('<')) {
              const data = JSON.parse(text);
              if (data.events && data.events.length > 0) {
                const transcript = data.events
                  .filter(e => e.segs)
                  .map(e => e.segs.map(s => s.utf8).join(''))
                  .join(' ');
                if (transcript.length > 10) {
                  console.log(`[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via auto-generated captions (${lang}), length: ${transcript.length} =====\n`);
                  return transcript;
                }
              }
            }
          }
        } catch (e) {
          console.log(`[YouTube Summarizer] Auto-caption API failed for ${lang}:`, e.message);
          // Continue to next language
        }
      }

      // Method 2: Try to find auto-generated caption tracks in page data
      // YouTube often stores auto caption info with different language codes
      console.log('[YouTube Summarizer] Searching for auto-caption data in page...');

      // First check window.ytInitialPlayerResponse directly
      let playerData = null;

      if (window.ytInitialPlayerResponse) {
        console.log('[YouTube Summarizer] Found ytInitialPlayerResponse on window');
        playerData = window.ytInitialPlayerResponse;
      }

      // If not on window, search in script tags
      if (!playerData) {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const content = script.textContent;
          if (content && content.includes('ytInitialPlayerResponse')) {
            try {
              // Try multiple regex patterns
              let match = content.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
              if (!match) {
                match = content.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
              }
              if (!match) {
                match = content.match(/"ytInitialPlayerResponse":({.+?})(,"|})/s);
              }

              if (match) {
                console.log('[YouTube Summarizer] Found ytInitialPlayerResponse in script');
                playerData = JSON.parse(match[1]);
                break;
              }
            } catch (e) {
              console.log('[YouTube Summarizer] Error parsing script:', e.message);
            }
          }
        }
      }

      if (playerData) {
        console.log('[YouTube Summarizer] Player data found, checking for captions...');

        // Navigate the captions structure - it can be in different places
        let captionTracks = null;

        if (playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
          captionTracks = playerData.captions.playerCaptionsTracklistRenderer.captionTracks;
        } else if (playerData.playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
          captionTracks = playerData.playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        }

        if (captionTracks && captionTracks.length > 0) {
          console.log(`[YouTube Summarizer] Found ${captionTracks.length} caption tracks in page data`);

          // Sort tracks: try auto-generated first, then by language
          const sortedTracks = [...captionTracks].sort((a, b) => {
            const aIsAuto = a.kind === 'asr' || a.languageCode?.includes('auto') || a.name?.toLowerCase().includes('auto');
            const bIsAuto = b.kind === 'asr' || b.languageCode?.includes('auto') || b.name?.toLowerCase().includes('auto');
            if (aIsAuto && !bIsAuto) return -1;
            if (!aIsAuto && bIsAuto) return 1;
            return 0;
          });

          for (const track of sortedTracks) {
            const isAutoGenerated = track.kind === 'asr' ||
                                   track.languageCode?.includes('auto') ||
                                   track.name?.toLowerCase().includes('auto');

            if (track.baseUrl) {
              try {
                const langName = track.languageCode?.name || track.languageCode || 'unknown';
                const trackName = track.name?.simpleText || track.name?.runs?.[0]?.text || 'unknown';
                console.log(`[YouTube Summarizer] Trying caption track: ${langName} (${trackName})${isAutoGenerated ? ' [AUTO]' : ''}`);

                // Try with the baseUrl as-is first (it has valid signature from YouTube)
                let fetchUrl = track.baseUrl;
                // Add format parameter if not present
                if (!fetchUrl.includes('fmt=')) {
                  fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'fmt=json3';
                }

                console.log(`[YouTube Summarizer] Fetching from: ${fetchUrl.substring(0, 100)}...`);
                const response = await fetch(fetchUrl);
                console.log(`[YouTube Summarizer] Response status: ${response.status}, type: ${response.headers.get('content-type')}`);

                if (response.ok) {
                  const text = await response.text();
                  console.log(`[YouTube Summarizer] Response text length: ${text.length}`);
                  console.log(`[YouTube Summarizer] Response starts with: ${text?.substring(0, 100)}`);

                  // Validate it's JSON before parsing
                  if (text && text.trim().length > 0) {
                    // Check if it's JSON (not HTML error)
                    if (text.trim().startsWith('{')) {
                      try {
                        const data = JSON.parse(text);
                        console.log(`[YouTube Summarizer] Parsed JSON, has events: ${!!data?.events}`);

                        if (data.events && data.events.length > 0) {
                          const transcript = data.events
                            .filter(e => e.segs)
                            .map(e => e.segs.map(s => s.utf8).join(''))
                            .join(' ');

                          // Accept transcripts of any reasonable length (reduced from 100 chars minimum)
                          if (transcript.length > 10) {
                            console.log(`[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via caption track (${track.languageCode}${isAutoGenerated ? ' auto' : ''}), length: ${transcript.length} =====\n`);
                            return transcript;
                          } else {
                            console.log(`[YouTube Summarizer] Caption track returned short transcript (${transcript.length} chars), trying next...`);
                          }
                        } else {
                          console.log(`[YouTube Summarizer] No events in JSON response, trying next track...`);
                        }
                      } catch (jsonError) {
                        console.log(`[YouTube Summarizer] JSON parsing failed: ${jsonError.message}`);
                        console.log(`[YouTube Summarizer] Response text (first 500 chars): ${text.substring(0, 500)}`);
                      }
                    } else if (text.includes('<')) {
                      // Got HTML instead of JSON - YouTube error page
                      console.log(`[YouTube Summarizer] Got HTML error page instead of JSON, trying next track...`);
                    } else {
                      console.log(`[YouTube Summarizer] Response is not JSON or HTML, starts with: ${text.substring(0, 50)}, trying next track...`);
                    }
                  } else {
                    console.log(`[YouTube Summarizer] Empty response from caption track, trying next...`);
                  }
                } else {
                  console.log(`[YouTube Summarizer] Caption track fetch failed with status: ${response.status}`);
                }
              } catch (e) {
                console.log(`[YouTube Summarizer] Error fetching caption: ${e.message}`);
                console.log(`[YouTube Summarizer] Error stack:`, e.stack);
                // Try next track
              }
            }
          }
        } else {
          console.log('[YouTube Summarizer] No caption tracks found in player data');
        }
      } else {
        console.log('[YouTube Summarizer] Could not find player data');
      }

      // Method 3: Trigger the CC button in the player to enable auto-captions, then extract
      console.log('[YouTube Summarizer] Trying to enable auto-captions via player...');
      const ccButton = document.querySelector('.ytp-subtitles-button, button[aria-label*="subtitles"], button[aria-label*="captions"], button[title*="CC"]');
      if (ccButton) {
        // Click to turn on captions if they're off
        const isPressed = ccButton.getAttribute('aria-pressed') === 'true';
        if (!isPressed) {
          ccButton.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Now try the transcript button again - it may appear after enabling CC
        await new Promise(resolve => setTimeout(resolve, 500));
        const allButtons = Array.from(document.querySelectorAll('button, yt-button-shape'));
        const transcriptButton = allButtons.find(el => {
          const text = el.textContent.toLowerCase().trim();
          return text.includes('transcript') || text.includes('字幕');
        });

        if (transcriptButton) {
          console.log('[YouTube Summarizer] Found transcript button after enabling CC!');
          transcriptButton.click();

          // Wait for transcript segments to load
          let transcriptReady = false;
          let attempts = 0;
          const maxAttempts = 15;

          while (!transcriptReady && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 300));
            attempts++;

            const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
            if (segments.length >= 50) {
              transcriptReady = true;
            }
          }

          console.log(`[YouTube Summarizer] CC method: Waited for transcript, found ${document.querySelectorAll('ytd-transcript-segment-renderer').length} segments`);

          // Extract from panel (same logic as above)
          const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
          if (segments.length >= 10) {
            let transcript = '';
            for (const seg of segments) {
              const textElement = seg.querySelector('.caption-visual-line');
              if (textElement) {
                let text = textElement.textContent.trim();

                // Filter UI text and timestamps
                const isUIText = /^(Home|Shorts|Subscriptions|Library|History|Watch later|Liked|Search|Sign in|Settings|Help|Report|Privacy|Terms)/i.test(text);
                const isTimestamp = /^[\d:\[\]\s\-]+$/.test(text);
                const isNumber = /^\d+$/.test(text);

                if (text && text.length > 3 && !isUIText && !isTimestamp && !isNumber) {
                  transcript += text + ' ';
                }
              }
            }

            // Close panel
            const closeBtn = document.querySelector('button[aria-label*="Close"]');
            if (closeBtn) closeBtn.click();

            if (transcript.length > 10) {
              console.log(`[YouTube Summarizer] ===== CONTENT SCRIPT: SUCCESS via CC-triggered transcript, length: ${transcript.length} =====\n`);
              return transcript.trim();
            } else {
              console.log(`[YouTube Summarizer] CC-triggered transcript too short (${transcript.length} chars), might have failed to extract`);
            }
          }
        }
      }

      console.log('[YouTube Summarizer] All transcript extraction methods failed');
      console.log('[YouTube Summarizer] This video may not have any captions (manual or auto-generated) available.');
      console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: FAILED - No transcript found =====\n');
      return null;
    } catch (error) {
      console.error('[YouTube Summarizer] ===== CONTENT SCRIPT: ERROR =====');
      console.error('[YouTube Summarizer] Error extracting transcript:', error);
      console.error('[YouTube Summarizer] Error stack:', error.stack);
      console.log('[YouTube Summarizer] ===== CONTENT SCRIPT: FAILED due to error =====\n');
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

    // Validate sidebar was created and inserted into DOM
    if (!sidebar || !sidebar.isConnected) {
      console.error('[YouTube Summarizer] Sidebar container not found in DOM');
      return;
    }

    const content = sidebar.querySelector('.yt-ai-sidebar-content');
    if (!content) {
      console.error('[YouTube Summarizer] Sidebar content area not found');
      return;
    }

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
    console.log('[YouTube Summarizer] Received message:', request.action);

    if (request.action === 'ping') {
      console.log('[YouTube Summarizer] Responding to ping');
      sendResponse({ pong: true });
      return true;
    }

    if (request.action === 'getVideoInfo') {
      sendResponse(getVideoInfoFromPage());
      return true;
    }

    if (request.action === 'getTranscript') {
      console.log('[YouTube Summarizer] Processing getTranscript request...');
      getTranscriptFromPage()
        .then(transcript => {
          console.log('[YouTube Summarizer] Transcript extracted, sending response. Length:', transcript?.length);
          sendResponse({ transcript });
        })
        .catch(error => {
          console.error('[YouTube Summarizer] Error in getTranscript:', error);
          sendResponse({ transcript: null, error: error.message });
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
