# Superior Reading - Chrome Extension

A Chrome extension that automatically scrapes the main content of any web page, analyzes it with AI, and plays matching background music via YouTube — audio only, no video, no sign-in required for end users. The extension extracts the article, sends it to your local backend, uses AI to generate music recommendations based on theme and mood, then resolves each recommendation to a YouTube video and plays it through a hidden iframe in the extension popup.

## Features

- 🤖 **Automatic Content Scraping**: Automatically extracts main content from any webpage
- 📡 **Real-time Data Transfer**: Sends scraped content to your local server instantly
- 🎯 **Smart Content Detection**: Uses multiple strategies to identify the main content area
- 🚫 **No Human Interaction**: Fully automated operation
- 📊 **Content Analytics**: Tracks word count, domain, and scraping statistics
- 💾 **Local Storage**: Saves all scraped content to your PC
- 🎨 **Modern UI**: Clean and intuitive popup interface
- 🎵 **YouTube Audio Playback**: AI picks tracks, the backend resolves them via the YouTube Data API, and audio plays through a hidden player — no Spotify Premium, no per-user OAuth setup

## Getting Started

### Clone the Repository

To get started with Superior Reading, clone the repository to your local machine:

```bash
git clone https://github.com/Batowlad/Superior-Reading.git
cd Superior-Reading
```

## Project Structure

```
Superior Reading/
├── Frontend/
│   └── chrome_extension/
│       ├── manifest.json              # Extension manifest
│       ├── content.js                 # Content scraping script
│       ├── background.js              # Background service worker
│       ├── popup.html                 # Extension popup UI
│       ├── popup.js                   # Popup functionality
│       ├── player.html                # Standalone player page
│       ├── player.js                  # Standalone player logic
│       ├── youtube_sandbox.html       # Sandboxed YouTube IFrame Player host
│       ├── youtube_sandbox.js         # YouTube IFrame Player wiring
│       └── icons/
│           └── book_icon.png          # Extension icons
├── Backend/
│   ├── chrome_extension/
│   │   ├── package.json               # Node.js dependencies
│   │   ├── server.js                  # Express server + YouTube Data API proxy
│   │   ├── preset_recommendations.json  # Preset music recommendations for testing
│   │   └── scraped_data/              # Directory for saved content (auto-created)
│   └── AI Agent/
│       ├── ai_agent.py                # AI agent for content analysis
│       ├── run_agent_cli.py           # CLI interface for AI agent
│       └── requirements.txt           # Python dependencies
└── README.md
```

## Prerequisites

Before setting up the application, you'll need to obtain the following API keys and credentials:

### Required API Keys

#### OpenAI API Key

- **Purpose**: Required for AI content analysis and music recommendations
- **How to obtain**:
  1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
  2. Sign in or create an account
  3. Navigate to API Keys section
  4. Click "Create new secret key"
  5. Copy the API key (you won't be able to see it again)
- **Where to set**: 
  - Set as an environment variable: `export OPENAI_API_KEY='your-key-here'`
  - Or create a `.env` file in the `Backend/AI Agent/` directory with: `OPENAI_API_KEY=your-key-here`
- **Usage**: Used by `ai_agent.py` for analyzing scraped content and generating music recommendations

#### YouTube Data API Key

- **Purpose**: Required for resolving AI recommendations to playable YouTube videos
- **How to obtain**:
  1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  2. Create (or select) a project
  3. Enable the **YouTube Data API v3** under "APIs & Services → Library"
  4. Create an API key under "APIs & Services → Credentials → Create credentials → API key"
  5. (Optional but recommended) Restrict the key to the YouTube Data API v3
- **Where to set**:
  - Add to `.env` file in `Backend/AI Agent/` directory: `YOUTUBE_API_KEY=your-key-here`
  - Or export as an environment variable before starting the backend: `export YOUTUBE_API_KEY='your-key-here'`
- **Usage**: Used by `Backend/chrome_extension/server.js` to search YouTube for each AI recommendation and attach a `youtube_id` so the extension can play it
- **Quota**: The free tier is 10,000 units/day. A search costs 100 units, so you get ~100 fresh recommendation fetches per day. Results are cached in-memory per server run.
- **Note**: If the key is not set, recommendations are still generated but won't have `youtube_id`s, and the extension will show "no playable tracks."

## Setup Instructions

### Prerequisites: Python Virtual Environment (for AI Agent)

If you plan to use the AI Agent component, it's recommended to use a Python virtual environment to manage dependencies.

#### Creating a Virtual Environment

**On macOS/Linux:**
```bash
cd "Backend/AI Agent"
python3 -m venv venv
```

**On Windows:**
```bash
cd "Backend\AI Agent"
python -m venv venv
```

#### Activating a Virtual Environment

**On macOS/Linux:**
```bash
source venv/bin/activate
```

**On Windows:**
```bash
venv\Scripts\activate
```

After activation, you'll see `(venv)` at the beginning of your command prompt.

#### Installing Dependencies

Once the virtual environment is activated:
```bash
pip install -r requirements.txt
```

#### Deactivating a Virtual Environment

To exit the virtual environment when you're done:
```bash
deactivate
```

### 1. Backend Server Setup

1. **Navigate to the backend directory:**
   ```bash
   cd "Backend\chrome_extension"
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```
   
   The server will start on `http://localhost:3000`

### 2. Chrome Extension Setup

1. **Open Chrome and go to Extensions:**
   - Open Chrome browser
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)

2. **Load the extension:**
   - Click "Load unpacked"
   - Navigate to and select the `Frontend\chrome_extension` folder
   - The extension should now appear in your extensions list

3. **Pin the extension (optional):**
   - Click the puzzle piece icon in Chrome toolbar
   - Find "Superior Reading - Content Scraper"
   - Click the pin icon to pin it to your toolbar

### 3. Usage

1. **Automatic Mode (Default):**
   - The extension automatically scrapes content from any webpage you visit
   - Content is sent to your local server without any interaction needed
   - Check the backend console to see scraped content being received

2. **Manual Mode:**
   - Click the extension icon in your toolbar
   - Click "Scrape Current Page" to manually scrape the current page
   - Click "Test Connection" to verify the backend server is running

3. **View Scraped Data:**
   - All scraped content is saved in `Backend\chrome_extension\scraped_data\`
   - Files are named by domain, date, and time
   - A summary file tracks all scraping activity

## API Endpoints

The backend server provides several endpoints:

- `GET /api/health` - Health check
- `POST /api/scrape` - Receive scraped content (used by extension)
- `GET /api/summary` - Get scraping summary
- `GET /api/files` - List all scraped files
- `GET /api/content/:filename` - Get specific content
- `DELETE /api/content/:filename` - Delete specific file
- `GET /api/recommendations/latest` - Get music recommendations for latest scraped content
- `GET /api/recommendations/latest?preset=true` - Get preset recommendations (test mode, no OpenAI tokens)

## Configuration

### Content Scraping Settings

The extension uses smart content detection with multiple strategies:

1. **Main Content Selectors**: Looks for common main content areas
2. **Body Filtering**: Removes navigation, ads, and sidebar content
3. **Content Cleaning**: Removes extra whitespace and formatting

### Auto-scrape Settings

- **Default**: Automatically scrapes content 2 seconds after page load
- **Manual Override**: Can be disabled in the popup interface
- **Smart Detection**: Only scrapes pages with meaningful content

## Troubleshooting

### Extension Not Working
1. Check that the backend server is running on `http://localhost:3000`
2. Verify the extension is loaded and enabled
3. Check browser console for any error messages
4. Try the "Test Connection" button in the popup

### Backend Server Issues
1. Ensure Node.js is installed
2. Run `npm install` in the backend directory
3. Check that port 3000 is not being used by another application
4. Verify all dependencies are installed correctly

### Content Not Being Scraped
1. Some websites may block content scraping
2. Check if the website has anti-bot protection
3. Try refreshing the page and waiting a few seconds
4. Use the manual scrape button as a test

## Data Storage

All scraped content is stored locally in JSON format with the following structure:

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "content": "Main article content...",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "domain": "example.com",
  "wordCount": 1500,
  "scrapedAt": "2024-01-01T12:00:00.000Z",
  "fileSize": 50000
}
```
### Using the AI Agent to read the latest scraped content

The Python module at `Backend/AI Agent/ai_agent.py` exposes a variable `text` that automatically loads the `content` from the most recently modified scraped JSON file in `Backend/chrome_extension/scraped_data/` whose filename matches `_YYYY-MM-DD_HH-MM-SS.json` (optionally prefixed with `@`).

Usage example:

```python
from pathlib import Path
from Backend.AI Agent.ai_agent import text

print(text)  # Prints the latest scraped page content or an empty string if none
```

Notes:
- The agent only reads local files and does not modify them.
- If the directory does not exist or no matching files are found, `text` will be an empty string.

### YouTube Audio Playback

The extension plays AI-recommended music through a hidden YouTube IFrame Player embedded in the extension popup. There is no per-user setup — once the backend has a `YOUTUBE_API_KEY` configured, anyone using the extension just clicks "Play Recommendations" and audio starts.

#### How it works

1. The Python AI agent analyzes scraped content and produces a list of recommendations, each with a YouTube-friendly `search_query`.
2. The Node backend (`server.js`) calls the YouTube Data API v3 once per recommendation, filters to embeddable videos, and attaches a `youtube_id` to each rec.
3. The Chrome extension receives the recs, filters to those with a `youtube_id`, and posts them to a sandboxed iframe (`youtube_sandbox.html`).
4. The sandbox loads the YouTube IFrame Player API, plays the first video, and auto-advances to the next when each ends.
5. The iframe is sized to 1×1 px and positioned off-screen — only audio is heard.

#### Using Music Recommendations

1. **Scrape Content:** Navigate to any webpage. The extension scrapes automatically, or click "Scrape Current Page".
2. **Play Recommendations:** Open the popup and click "Play Recommendations". The backend generates recs and resolves them to YouTube IDs. Playback starts in the popup (or via the dedicated player page if you keep it open).
3. **Controls:** Play/pause, next, and previous buttons live in the popup.

#### Test Mode (Preset Recommendations)

To test without spending OpenAI tokens:

1. **Enable Test Mode:** Toggle "Test Mode (Preset)" in the popup.
2. **What it does:** The extension fetches from `Backend/chrome_extension/preset_recommendations.json` — five classic tracks (Bohemian Rhapsody, Stairway to Heaven, Hotel California, Comfortably Numb, The Sound of Silence). The backend still resolves their `search_query` strings to YouTube IDs (cached after the first call).
3. **Customizing presets:** Edit `Backend/chrome_extension/preset_recommendations.json`. Each entry needs at minimum `title`, `artist`, `match_reason`, and a `search_query`. If you want to skip the YouTube search entirely, you can pre-populate `youtube_id` directly — the server skips lookup for any entry that already has one.

#### Troubleshooting

- **"No playable tracks"**: The backend couldn't attach `youtube_id`s. Check that `YOUTUBE_API_KEY` is set in `Backend/AI Agent/.env` and that the YouTube Data API v3 is enabled in your Google Cloud project.
- **"YouTube error code 101/150"**: The video found doesn't allow embedding. The sandbox auto-advances; if it keeps happening, the AI search query is too narrow — re-scrape different content.
- **Quota exceeded**: Free tier is 10k units/day. The in-memory cache deduplicates repeated queries within a single server run but resets on restart.
- **No audio**: Check that you're not muted at the system or browser tab level. The player runs hidden, so there's nothing to click to confirm it's loaded — open the popup and watch the player status text.

## Security Notes

- The extension only runs on web pages (not chrome:// pages)
- All data is stored locally on your PC
- No data is sent to external servers
- The backend server only accepts connections from localhost

## Development

### Running in Development Mode

1. **Backend with auto-restart:**
   ```bash
   cd "Backend\chrome_extension"
   npm run dev
   ```

2. **Extension reload:**
   - Make changes to extension files
   - Go to `chrome://extensions/`
   - Click the refresh icon on the extension

### Adding New Features

- **Content Script**: Modify `Frontend\chrome_extension\content.js`
- **Background Script**: Modify `Frontend\chrome_extension\background.js`
- **Popup UI**: Modify `Frontend\chrome_extension\popup.html` and `popup.js`
- **Backend API**: Modify `Backend\chrome_extension\server.js`

## License

MIT License - Feel free to modify and distribute as needed.

## Support

If you encounter any issues:
1. Check the browser console for error messages
2. Verify the backend server is running
3. Test the connection using the popup interface
4. Check the scraped_data directory for saved content
