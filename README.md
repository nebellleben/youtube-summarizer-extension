# YouTube Video Summarizer Chrome Extension

A Chrome extension that generates AI-powered summaries of YouTube videos using their transcripts. Get comprehensive summaries with timestamps in multiple languages.

![Extension Banner](https://img.shields.io/badge/Chrome-Extension-green?logo=google-chrome)
![Claude](https://img.shields.io/badge/AI-Claude-purple?logo=anthropic)

## Features

- **AI-Powered Summaries**: Uses Claude AI to generate comprehensive video summaries
- **Timestamps**: Includes timestamps for key discussion points
- **Multiple Languages**: Support for Traditional Chinese, Simplified Chinese, English, Japanese, and Korean
- **Sidebar Display**: View summaries in a clean, non-intrusive sidebar
- **Copy Function**: Easily copy the full summary to clipboard
- **Transcript Caching**: Cached transcripts for faster repeated access

## Installation

### Option 1: Install from Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/youtube-summarizer-extension.git
   cd youtube-summarizer-extension
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" in the top right corner

4. Click "Load unpacked" and select the extension folder

### Option 2: Install Local Server (Recommended for Better Transcript Support)

For more reliable transcript fetching, you can run a local Python server:

1. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Start the server:
   ```bash
   python server.py
   ```

3. The server will run on `http://127.0.0.1:5000`

4. The extension will automatically use the local server if available

## Setup

1. Click the extension icon in Chrome's toolbar

2. Click "Options" to open settings

3. Enter your **Anthropic API Key** (get one at [console.anthropic.com](https://console.anthropic.com/))

4. Configure your preferences:
   - Summary language
   - Include timestamps
   - Auto-open sidebar

## Usage

1. Navigate to any YouTube video with captions/subtitles

2. Click the extension icon

3. Click "Generate Summary"

4. View the summary in the sidebar that appears

5. Click "Copy Summary" to copy the full text to your clipboard

## File Structure

```
youtube-summarizer-extension/
├── manifest.json       # Extension configuration
├── popup.html          # Popup UI
├── popup.js            # Popup logic
├── content.js          # Content script for sidebar
├── content.css         # Sidebar styles
├── background.js       # Service worker for API calls
├── options.html        # Options page
├── options.js          # Options page logic
├── server.py           # Optional local server for transcripts
├── requirements.txt    # Python dependencies
├── icons/              # Extension icons
└── README.md           # This file
```

## How It Works

1. **Transcript Fetching**: The extension fetches video transcripts using multiple fallback methods:
   - Local server (if running)
   - YouTube's timedtext API
   - Alternative transcript services

2. **AI Processing**: The transcript is sent to Claude AI with a prompt to generate a comprehensive summary

3. **Display**: The summary is displayed in a sidebar with formatted markdown, timestamps, and copy functionality

## Requirements

- Google Chrome or Chromium-based browser (Edge, Brave, etc.)
- Anthropic API key
- Python 3.8+ (for local server, optional)
- YouTube video must have captions/subtitles available

## Privacy

- Your API key is stored locally in your browser's storage
- Transcripts are only sent to Anthropic's API for processing
- No data is collected or sent to any third-party servers except Anthropic

## Troubleshooting

### "Could not fetch transcript" Error

- Ensure the video has captions/subtitles enabled
- Try running the local server (`python server.py`) for better transcript support
- Some videos may not have publicly available transcripts

### API Key Errors

- Verify your API key is valid at [console.anthropic.com](https://console.anthropic.com/)
- Ensure you have sufficient credits in your Anthropic account

### Summary Not Appearing

- Check the browser console for errors (F12)
- Try refreshing the YouTube page
- Clear the extension cache in Options

## Development

To modify the extension:

1. Make changes to the source files

2. Go to `chrome://extensions/`

3. Click the refresh icon on the extension card

4. Test your changes on a YouTube video

## License

MIT License - feel free to use and modify as needed.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Acknowledgments

- Built with [Claude](https://www.anthropic.com/claude) by Anthropic
- Transcript fetching powered by [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)
