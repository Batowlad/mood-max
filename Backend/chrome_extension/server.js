const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

// Load .env from Backend/AI Agent or the project root so the same key file
// feeds both Python and Node. dotenv never overrides vars that are already set,
// so the AI Agent copy wins if both exist.
try {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(__dirname, '..', 'AI Agent', '.env') });
    dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
} catch (_) {
    // dotenv is optional; env vars can be exported in the shell instead
}

const app = express();
const PORT = 3000;

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const youtubeQueryCache = new Map();

async function searchYouTube(query) {
    if (!YOUTUBE_API_KEY) return null;
    if (!query || !query.trim()) return null;

    const cacheKey = query.trim().toLowerCase();
    if (youtubeQueryCache.has(cacheKey)) {
        return youtubeQueryCache.get(cacheKey);
    }

    const params = new URLSearchParams({
        part: 'snippet',
        q: query,
        type: 'video',
        videoEmbeddable: 'true',
        maxResults: '1',
        key: YOUTUBE_API_KEY
    });

    try {
        const response = await fetch(`${YOUTUBE_SEARCH_URL}?${params.toString()}`);
        if (!response.ok) {
            const body = await response.text();
            console.error(`YouTube search failed (${response.status}): ${body.substring(0, 200)}`);
            return null;
        }
        const data = await response.json();
        const videoId = data?.items?.[0]?.id?.videoId || null;
        youtubeQueryCache.set(cacheKey, videoId);
        return videoId;
    } catch (error) {
        console.error('YouTube search error:', error.message);
        return null;
    }
}

async function attachYouTubeIds(recommendations) {
    if (!Array.isArray(recommendations) || recommendations.length === 0) return recommendations;
    if (!YOUTUBE_API_KEY) {
        console.warn('⚠️  YOUTUBE_API_KEY not set — recommendations returned without youtube_id. Playback will be skipped.');
        return recommendations;
    }

    const enriched = await Promise.all(recommendations.map(async (rec) => {
        if (rec.youtube_id) return rec;
        const query = rec.search_query || `${rec.title || ''} ${rec.artist || ''}`.trim();
        const videoId = await searchYouTube(query);
        return videoId ? { ...rec, youtube_id: videoId } : rec;
    }));

    return enriched;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'scraped_data');
fs.ensureDirSync(dataDir);

// Configuration for automatic cleanup
const CLEANUP_CONFIG = {
    enabled: true,
    deleteAfterMinutes: 1, // Delete all files after 1 minute
    cleanupIntervalMinutes: 1 // Run cleanup every 1 minute
};

// Format a date as "YYYY-MM-DD_HH-mm-ss" in local time for use in filenames
function formatTimestampForFilename(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const timeStr = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    return `${dateStr}_${timeStr}`;
}

// List scraped JSON files in dataDir with their stats (excludes the summary file)
async function listScrapedFiles() {
    const files = await fs.readdir(dataDir);
    const jsonFiles = files.filter(file =>
        file.endsWith('.json') &&
        file !== 'scraping_summary.json'
    );

    return Promise.all(
        jsonFiles.map(async (file) => {
            const filePath = path.join(dataDir, file);
            const stats = await fs.stat(filePath);
            return {
                filename: file,
                filePath,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime
            };
        })
    );
}

// Resolve a client-supplied filename to a path inside dataDir.
// Returns null if the name would escape the directory (path traversal).
function resolveDataFile(filename) {
    const resolved = path.resolve(dataDir, filename);
    if (path.dirname(resolved) !== path.resolve(dataDir)) {
        return null;
    }
    return resolved;
}

// Automatic cleanup function - deletes all files after 1 minute
async function cleanupOldFiles() {
    if (!CLEANUP_CONFIG.enabled) return;

    try {
        console.log('🧹 Starting automatic cleanup...');

        const fileStats = await listScrapedFiles();

        if (fileStats.length === 0) {
            console.log('📁 No files to clean up');
            return;
        }

        const now = new Date();
        const maxAge = CLEANUP_CONFIG.deleteAfterMinutes * 60 * 1000; // Convert to milliseconds
        let deletedCount = 0;
        let deletedSize = 0;
        
        // Delete all files older than 1 minute
        for (const file of fileStats) {
            const age = now - file.created;
            if (age > maxAge) {
                await fs.remove(file.filePath);
                deletedCount++;
                deletedSize += file.size;
                console.log(`🗑️ Deleted file: ${file.filename} (${Math.round(age / 1000)}s old)`);
            }
        }
        
        if (deletedCount > 0) {
            console.log(`✅ Cleanup completed: Deleted ${deletedCount} files (${Math.round(deletedSize / 1024)}KB freed)`);
        } else {
            console.log('✅ Cleanup completed: No files needed deletion');
        }
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        message: 'Superior Reading Backend Server is running'
    });
});

// Main endpoint to receive scraped content
app.post('/api/scrape', async (req, res) => {
    try {
        const { url, title, content, timestamp, domain, wordCount } = req.body;
        
        // Validate required fields
        if (!url || !content) {
            return res.status(400).json({ 
                error: 'Missing required fields: url and content are required' 
            });
        }

        // Fall back to the URL's hostname when the client didn't send a domain
        let resolvedDomain;
        try {
            resolvedDomain = domain || new URL(url).hostname;
        } catch (_) {
            return res.status(400).json({
                error: 'Invalid url: could not determine domain'
            });
        }

        // Create filename based on domain and timestamp
        const safeDomain = resolvedDomain.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filename = `${safeDomain}_${formatTimestampForFilename()}.json`;

        // Prepare data to save
        const scrapedData = {
            url,
            title: title || 'Untitled',
            content,
            timestamp: timestamp || new Date().toISOString(),
            domain: resolvedDomain,
            wordCount: wordCount || content.split(/\s+/).length,
            scrapedAt: new Date().toISOString(),
            fileSize: JSON.stringify({ content }).length
        };

        // Save to file
        const filePath = path.join(dataDir, filename);
        await fs.writeJson(filePath, scrapedData, { spaces: 2 });

        // Also save a summary entry
        const summaryFile = path.join(dataDir, 'scraping_summary.json');
        let summary = [];
        
        if (await fs.pathExists(summaryFile)) {
            summary = await fs.readJson(summaryFile);
        }
        
        summary.push({
            filename,
            url,
            title: scrapedData.title,
            domain: scrapedData.domain,
            wordCount: scrapedData.wordCount,
            scrapedAt: scrapedData.scrapedAt,
            fileSize: scrapedData.fileSize
        });

        // Keep only last 100 entries in summary
        if (summary.length > 100) {
            summary = summary.slice(-100);
        }

        await fs.writeJson(summaryFile, summary, { spaces: 2 });

        console.log(`✅ Content scraped and saved: ${filename}`);
        console.log(`   URL: ${url}`);
        console.log(`   Title: ${title}`);
        console.log(`   Word Count: ${wordCount}`);
        console.log(`   Domain: ${domain}`);

        res.json({ 
            success: true, 
            message: 'Content saved successfully',
            filename,
            wordCount: scrapedData.wordCount
        });

    } catch (error) {
        console.error('❌ Error processing scraped content:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Get scraping summary
app.get('/api/summary', async (req, res) => {
    try {
        const summaryFile = path.join(dataDir, 'scraping_summary.json');
        
        if (await fs.pathExists(summaryFile)) {
            const summary = await fs.readJson(summaryFile);
            res.json({ 
                success: true, 
                summary,
                totalEntries: summary.length 
            });
        } else {
            res.json({ 
                success: true, 
                summary: [], 
                totalEntries: 0 
            });
        }
    } catch (error) {
        console.error('Error reading summary:', error);
        res.status(500).json({ 
            error: 'Failed to read summary',
            message: error.message 
        });
    }
});
// Get specific scraped content
app.get('/api/content/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = resolveDataFile(filename);

        if (!filePath) {
            return res.status(400).json({
                error: 'Invalid filename',
                filename
            });
        }

        if (await fs.pathExists(filePath)) {
            const content = await fs.readJson(filePath);
            res.json({ success: true, content });
        } else {
            res.status(404).json({ 
                error: 'File not found',
                filename 
            });
        }
    } catch (error) {
        console.error('Error reading content file:', error); 
        res.status(500).json({ 
            error: 'Failed to read content file',
            message: error.message 
        });
    }
});

// List all scraped files
app.get('/api/files', async (req, res) => {
    try {
        const fileList = await listScrapedFiles();

        res.json({
            success: true,
            files: fileList
                .map(({ filename, size, created, modified }) => ({ filename, size, created, modified }))
                .sort((a, b) => b.created - a.created)
        });
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ 
            error: 'Failed to list files',
            message: error.message 
        });
    }
});

// Delete specific file
app.delete('/api/content/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = resolveDataFile(filename);

        if (!filePath) {
            return res.status(400).json({
                error: 'Invalid filename',
                filename
            });
        }

        if (await fs.pathExists(filePath)) {
            await fs.remove(filePath);
            console.log(`🗑️ Deleted file: ${filename}`);
            res.json({ success: true, message: 'File deleted successfully' });
        } else {
            res.status(404).json({ 
                error: 'File not found',
                filename 
            });
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ 
            error: 'Failed to delete file',
            message: error.message 
        });
    }
});

// Manual cleanup endpoint
app.post('/api/cleanup', async (req, res) => {
    try {
        await cleanupOldFiles();
        res.json({ 
            success: true, 
            message: 'Cleanup completed successfully' 
        });
    } catch (error) {
        console.error('Error during manual cleanup:', error);
        res.status(500).json({ 
            error: 'Cleanup failed',
            message: error.message 
        });
    }
});

// Helper function to find the latest scraped file
async function findLatestScrapedFile() {
    try {
        const fileStats = await listScrapedFiles();

        if (fileStats.length === 0) {
            return null;
        }

        // Sort by modification time (most recent first)
        fileStats.sort((a, b) => b.modified - a.modified);

        return fileStats[0].filePath;
    } catch (error) {
        console.error('Error finding latest scraped file:', error);
        return null;
    }
}

// Locate a Python interpreter: prefer a venv next to the agent, then the
// project-root .venv, then whatever is on PATH.
function resolvePythonCommand() {
    const projectRoot = path.join(__dirname, '..', '..');
    const venvLocations = process.platform === 'win32'
        ? [
            path.join(__dirname, '..', 'AI Agent', 'venv', 'Scripts', 'python.exe'),
            path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
        ]
        : [
            path.join(__dirname, '..', 'AI Agent', 'venv', 'bin', 'python3'),
            path.join(projectRoot, '.venv', 'bin', 'python3')
        ];

    for (const venvPython of venvLocations) {
        if (fs.existsSync(venvPython)) {
            console.log(`Using venv Python: ${venvPython}`);
            return venvPython;
        }
    }

    const fallback = process.platform === 'win32' ? 'python' : 'python3';
    console.log(`Venv Python not found, using system ${fallback}`);
    console.log(`Checked locations: ${venvLocations.join(', ')}`);
    return fallback;
}

const PYTHON_AGENT_TIMEOUT_MS = 5 * 60 * 1000;

// Run the Python agent with the given content on stdin and return its parsed
// JSON output. Rejects on spawn failure, timeout, non-zero exit, or
// unparseable output; rejection errors carry a `details` object for the API
// response.
function runPythonAgent(content) {
    const pythonScriptDir = path.join(__dirname, '..', 'AI Agent');
    const pythonScriptPath = path.join(pythonScriptDir, 'run_agent_cli.py');
    const pythonCommand = resolvePythonCommand();

    return new Promise((resolve, reject) => {
        console.log('🚀 Starting Python agent process...');
        console.log(`   Command: ${pythonCommand}`);
        console.log(`   Script: ${pythonScriptPath}`);
        console.log(`   Content length: ${content.length} characters`);

        const pythonProcess = spawn(pythonCommand, [pythonScriptPath], {
            cwd: pythonScriptDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env, // Pass through all environment variables (including .env)
                PYTHONUNBUFFERED: '1' // Ensure Python output is not buffered
            }
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            console.error('⏱️ Python process timeout after 5 minutes');
            pythonProcess.kill('SIGTERM');
        }, PYTHON_AGENT_TIMEOUT_MS);

        // Send content to Python process via stdin
        pythonProcess.stdin.write(content, 'utf8');
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pythonProcess.on('error', (error) => {
            clearTimeout(timeout);
            console.error('Error spawning Python process:', error);
            const err = new Error(error.message);
            err.details = {
                hint: 'Make sure Python 3 is installed and accessible as "python3"'
            };
            reject(err);
        });

        pythonProcess.on('close', (code, signal) => {
            clearTimeout(timeout);

            if (timedOut) {
                const err = new Error('The Python agent process took too long to complete (>5 minutes)');
                err.details = { code, signal, hint: 'Process was terminated (timeout).' };
                reject(err);
                return;
            }

            if (code !== 0) {
                console.error(`❌ Python process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
                console.error('Python stderr:', stderr);
                console.error('Python stdout (if any):', stdout);

                // The CLI prints a JSON error object on failure when it can
                let message = stderr || 'Python agent process failed';
                try {
                    const errorJson = JSON.parse(stdout);
                    if (errorJson.error) {
                        message = errorJson.error;
                    }
                } catch (_) {
                    // Not JSON, use stderr or default message
                }

                const err = new Error(message);
                err.details = {
                    code,
                    signal,
                    stderr: stderr.substring(0, 500),
                    hint: code === 127 ? 'Python interpreter not found. Make sure Python 3 and dependencies are installed.' :
                          code === 1 ? 'Python script execution failed. Check dependencies and environment variables.' :
                          signal === 'SIGTERM' ? 'Process was terminated (likely timeout).' :
                          'Check Python script and dependencies.'
                };
                reject(err);
                return;
            }

            try {
                // Extract the JSON object in case the script printed extra text
                let cleanedStdout = stdout.trim();
                const firstBrace = cleanedStdout.indexOf('{');
                const lastBrace = cleanedStdout.lastIndexOf('}');

                if (firstBrace !== -1 && lastBrace > firstBrace) {
                    cleanedStdout = cleanedStdout.substring(firstBrace, lastBrace + 1);
                }

                resolve(JSON.parse(cleanedStdout));
            } catch (parseError) {
                console.error('❌ Error parsing Python output:', parseError);
                console.error('Python stdout:', stdout);
                console.error('Python stderr:', stderr);
                const err = new Error('Invalid JSON response from Python agent');
                err.details = {
                    details: parseError.message,
                    stdout: stdout.substring(0, 500),
                    stderr: stderr.substring(0, 500)
                };
                reject(err);
            }
        });
    });
}

// Get latest recommendations endpoint
app.get('/api/recommendations/latest', async (req, res) => {
    try {
        // Check if preset/test mode is requested
        if (req.query.preset === 'true' || req.query.test === 'true') {
            const presetFile = path.join(__dirname, 'preset_recommendations.json');
            
            if (await fs.pathExists(presetFile)) {
                const presetData = await fs.readJson(presetFile);
                if (presetData?.music_recommendations?.recommendations) {
                    presetData.music_recommendations.recommendations = await attachYouTubeIds(
                        presetData.music_recommendations.recommendations
                    );
                }
                console.log('✅ Serving preset recommendations (test mode)');
                return res.json({
                    success: true,
                    ...presetData,
                    sourceFile: 'preset_recommendations.json',
                    isPreset: true
                });
            } else {
                return res.status(404).json({
                    error: 'Preset recommendations file not found',
                    message: 'The preset_recommendations.json file does not exist'
                });
            }
        }
        
        // Find the latest scraped file
        const latestFile = await findLatestScrapedFile();
        
        if (!latestFile) {
            return res.status(404).json({ 
                error: 'No scraped content found',
                message: 'Please scrape some content first before requesting recommendations'
            });
        }
        
        // Read the scraped content
        const scrapedData = await fs.readJson(latestFile);
        const content = scrapedData.content;
        
        if (!content || !content.trim()) {
            return res.status(400).json({ 
                error: 'No content in scraped file',
                message: 'The scraped file does not contain any content to analyze'
            });
        }
        
        // Run the Python agent on the scraped content
        let result;
        try {
            result = await runPythonAgent(content);
        } catch (agentError) {
            return res.status(500).json({
                error: 'Failed to generate recommendations',
                message: agentError.message,
                ...(agentError.details || {})
            });
        }

        if (result?.music_recommendations?.recommendations) {
            result.music_recommendations.recommendations = await attachYouTubeIds(
                result.music_recommendations.recommendations
            );
        }

        console.log('✅ Successfully generated recommendations');
        res.json({
            success: true,
            ...result,
            sourceFile: path.basename(latestFile)
        });

    } catch (error) {
        console.error('Error in recommendations endpoint:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log('🚀 Superior Reading Backend Server started');
    console.log(`📡 Server running on http://localhost:${PORT}`);
    console.log(`📁 Data will be saved to: ${dataDir}`);
    console.log('🔧 Available endpoints:');
    console.log('   GET  /api/health - Health check');
    console.log('   POST /api/scrape - Receive scraped content');
    console.log('   GET  /api/summary - Get scraping summary');
    console.log('   GET  /api/files - List all scraped files');
    console.log('   GET  /api/content/:filename - Get specific content');
    console.log('   DELETE /api/content/:filename - Delete specific file');
    console.log('   POST /api/cleanup - Manual cleanup trigger');
    console.log('   GET  /api/recommendations/latest - Get latest music recommendations');
    console.log('   GET  /api/recommendations/latest?preset=true - Get preset recommendations (test mode, no OpenAI tokens)');
    console.log('');
    console.log('🧹 Automatic cleanup:');
    console.log(`   - Enabled: ${CLEANUP_CONFIG.enabled}`);
    console.log(`   - Delete after: ${CLEANUP_CONFIG.deleteAfterMinutes} minute(s)`);
    console.log(`   - Check interval: ${CLEANUP_CONFIG.cleanupIntervalMinutes} minute(s)`);
    console.log('');
    console.log('💡 Make sure to install dependencies: npm install');
    console.log('💡 Start the server: npm start');
    
    // Start automatic cleanup timer
    if (CLEANUP_CONFIG.enabled) {
        // Run cleanup immediately on startup
        setTimeout(cleanupOldFiles, 10000); // Wait 10 seconds after startup
        
        // Set up recurring cleanup every minute
        setInterval(cleanupOldFiles, CLEANUP_CONFIG.cleanupIntervalMinutes * 60 * 1000);
        console.log('⏰ Automatic cleanup timer started - files will be deleted after 1 minute');
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    process.exit(0);
});
