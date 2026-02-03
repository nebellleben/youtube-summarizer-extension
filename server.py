#!/usr/bin/env python3
"""
Simple backend server for YouTube Summarizer Extension.
This server handles transcript fetching using youtube-transcript-api.
Run this locally and configure the extension to use it.
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import re

app = Flask(__name__)
CORS(app)

# Try to import youtube_transcript_api
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    YOUTUBE_TRANSCRIPT_AVAILABLE = True
except ImportError:
    YOUTUBE_TRANSCRIPT_AVAILABLE = False
    print("Warning: youtube-transcript-api not available. Install with: pip install youtube-transcript-api")


def extract_video_id(url):
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)',
        r'youtube\.com\/shorts\/([^&\n?#]+)'
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def get_transcript(video_id):
    """Fetch transcript for a video."""
    if not YOUTUBE_TRANSCRIPT_AVAILABLE:
        return None, "youtube-transcript-api not installed on server"

    try:
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id, languages=('en', 'zh-CN', 'zh-Hans', 'zh-TW', 'ja', 'ko'))

        # Combine all text with timestamps
        full_text = ' '.join([entry.text for entry in transcript])

        # Also return segments with timestamps for reference
        segments = [
            {'start': entry.start, 'duration': entry.duration, 'text': entry.text}
            for entry in transcript
        ]

        return {'text': full_text, 'segments': segments}, None

    except Exception as e:
        return None, str(e)


@app.route('/')
def index():
    """Serve a simple status page."""
    return jsonify({
        'service': 'YouTube Summarizer Backend',
        'version': '1.0.0',
        'youtube_transcript_available': YOUTUBE_TRANSCRIPT_AVAILABLE
    })


@app.route('/api/transcript', methods=['GET', 'POST'])
def transcript():
    """Get transcript for a YouTube video."""
    if request.method == 'POST':
        data = request.get_json() or {}
        url = data.get('url') or data.get('video_id')
    else:
        url = request.args.get('url') or request.args.get('video_id')

    if not url:
        return jsonify({'error': 'URL or video_id is required'}), 400

    # Extract video ID if full URL was provided
    video_id = extract_video_id(url) if 'youtube' in url or 'youtu.be' in url else url

    if not video_id:
        return jsonify({'error': 'Invalid YouTube URL or video ID'}), 400

    transcript_data, error = get_transcript(video_id)

    if error:
        return jsonify({'error': error}), 500

    return jsonify({
        'video_id': video_id,
        'transcript': transcript_data['text'],
        'segments': transcript_data['segments'],
        'duration': transcript_data['segments'][-1]['start'] + transcript_data['segments'][-1]['duration'] if transcript_data['segments'] else 0
    })


@app.route('/health')
def health():
    """Health check endpoint."""
    return jsonify({'status': 'healthy'})


if __name__ == '__main__':
    print("=" * 50)
    print("YouTube Summarizer Backend Server")
    print("=" * 50)
    print(f"YouTube Transcript API Available: {YOUTUBE_TRANSCRIPT_AVAILABLE}")
    if not YOUTUBE_TRANSCRIPT_AVAILABLE:
        print("\nTo enable transcript fetching, install:")
        print("  pip install youtube-transcript-api flask flask-cors")
    print("\nServer starting on http://localhost:5000")
    print("=" * 50)

    app.run(host='127.0.0.1', port=5000, debug=True)
