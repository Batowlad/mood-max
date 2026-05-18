// Popup script for Chrome extension.
// Drives the YouTube IFrame player hosted in the sandbox iframe.

document.addEventListener('DOMContentLoaded', function() {
    const testBtn = document.getElementById('testBtn');
    const testModeToggle = document.getElementById('testModeToggle');
    const autoFetchToggle = document.getElementById('autoFetchToggle');
    const status = document.getElementById('status');
    const serverStatus = document.getElementById('serverStatus');
    const playRecommendationsBtn = document.getElementById('playRecommendationsBtn');

    // Player elements
    const playerStatus = document.getElementById('playerStatus');
    const trackName = document.getElementById('trackName');
    const trackArtist = document.getElementById('trackArtist');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const nextBtn = document.getElementById('nextBtn');
    const prevBtn = document.getElementById('prevBtn');
    const sandboxFrame = document.getElementById('sandboxFrame');

    const MESSAGE_TYPES = {
        INIT_PLAYER: 'init_player',
        LOAD_QUEUE: 'load_queue',
        PLAY: 'play',
        PAUSE: 'pause',
        NEXT: 'next',
        PREV: 'prev',
        PLAYER_READY: 'player_ready',
        PLAYER_ERROR: 'player_error',
        PLAYER_STATE: 'player_state'
    };

    let isPlayerReady = false;
    let isPlaying = false;
    let pendingVideoIds = null;

    function updateStatus(message, type = 'info') {
        status.textContent = message;
        if (type === 'success') {
            status.style.background = '#7bf1a8';
            status.style.color = '#000000';
        } else if (type === 'error') {
            status.style.background = '#ff006e';
            status.style.color = '#ffffff';
        } else if (type === 'processing') {
            status.style.background = '#00f0ff';
            status.style.color = '#000000';
        } else {
            status.style.background = '#ffd60a';
            status.style.color = '#000000';
        }
    }

    function updatePlayerStatus(message, type = 'default') {
        playerStatus.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;
        playerStatus.className = `player-status ${type}`;
    }

    function postToSandbox(type, data = {}) {
        if (sandboxFrame.contentWindow) {
            sandboxFrame.contentWindow.postMessage({ type, ...data }, '*');
            return;
        }
        sandboxFrame.addEventListener('load', () => {
            sandboxFrame.contentWindow.postMessage({ type, ...data }, '*');
        }, { once: true });
    }

    async function testConnection() {
        testBtn.disabled = true;
        updateStatus('TESTING CONNECTION...', 'processing');

        try {
            const response = await fetch('http://localhost:3000/api/health');
            if (response.ok) {
                serverStatus.textContent = 'Online';
                serverStatus.className = 'status-indicator connected';
                updateStatus('SERVER ONLINE!', 'success');
            } else {
                throw new Error('Server not responding');
            }
        } catch (error) {
            serverStatus.textContent = 'Offline';
            serverStatus.className = 'status-indicator disconnected';
            updateStatus('SERVER OFFLINE', 'error');
        } finally {
            testBtn.disabled = false;
        }
    }

    function toggleTestMode() {
        testModeToggle.classList.toggle('active');
        const isActive = testModeToggle.classList.contains('active');
        chrome.storage.sync.set({ testMode: isActive }, () => {
            updateStatus(isActive ? 'TEST MODE ON (Preset)' : 'TEST MODE OFF (AI)', 'info');
        });
    }

    function toggleAutoFetch() {
        autoFetchToggle.classList.toggle('active');
        const isActive = autoFetchToggle.classList.contains('active');
        chrome.storage.sync.set({ autoFetchRecommendations: isActive }, () => {
            updateStatus(isActive ? 'AUTO-FETCH ON' : 'AUTO-FETCH OFF', 'info');
        });
    }

    chrome.storage.sync.get(['testMode', 'autoFetchRecommendations'], (result) => {
        if (result.testMode) testModeToggle.classList.add('active');
        if (result.autoFetchRecommendations) autoFetchToggle.classList.add('active');
    });

    async function playRecommendationsFromBackend() {
        playRecommendationsBtn.disabled = true;
        playRecommendationsBtn.textContent = 'LOADING...';

        const isTestMode = testModeToggle.classList.contains('active');
        updateStatus(isTestMode ? 'FETCHING PRESET RECOMMENDATIONS...' : 'FETCHING RECOMMENDATIONS...', 'processing');

        try {
            const url = isTestMode
                ? 'http://localhost:3000/api/recommendations/latest?preset=true'
                : 'http://localhost:3000/api/recommendations/latest';

            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('No scraped content found. Please scrape a page first.');
                }
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Server error: ${response.status}`);
            }

            const data = await response.json();
            const recommendations = data?.music_recommendations?.recommendations || [];
            const playable = recommendations.filter(rec => rec.youtube_id);

            if (playable.length === 0) {
                updateStatus('NO PLAYABLE TRACKS (check YOUTUBE_API_KEY)', 'error');
                playRecommendationsBtn.disabled = false;
                playRecommendationsBtn.textContent = 'Play Recommendations';
                return;
            }

            updateStatus(`FOUND ${playable.length} TRACK(S)`, 'success');

            const videoIds = playable.map(rec => rec.youtube_id);

            if (isPlayerReady) {
                postToSandbox(MESSAGE_TYPES.LOAD_QUEUE, { video_ids: videoIds });
                updateStatus('PLAYBACK STARTED!', 'success');
            } else {
                pendingVideoIds = videoIds;
                postToSandbox(MESSAGE_TYPES.INIT_PLAYER);
                updateStatus('STARTING PLAYER...', 'processing');
            }

            // Also stash for player.html / background-driven flows
            chrome.runtime.sendMessage({
                action: 'startPlayback',
                recommendations: playable
            });

            setTimeout(() => {
                playRecommendationsBtn.disabled = false;
                playRecommendationsBtn.textContent = 'Play Recommendations';
            }, 1500);

        } catch (error) {
            console.error('Error fetching recommendations:', error);
            updateStatus(`ERROR: ${error.message}`, 'error');
            playRecommendationsBtn.disabled = false;
            playRecommendationsBtn.textContent = 'Play Recommendations';
        }
    }

    testBtn.addEventListener('click', testConnection);
    testModeToggle.addEventListener('click', toggleTestMode);
    autoFetchToggle.addEventListener('click', toggleAutoFetch);
    playRecommendationsBtn.addEventListener('click', playRecommendationsFromBackend);

    playPauseBtn.addEventListener('click', () => {
        postToSandbox(isPlaying ? MESSAGE_TYPES.PAUSE : MESSAGE_TYPES.PLAY);
    });
    nextBtn.addEventListener('click', () => postToSandbox(MESSAGE_TYPES.NEXT));
    prevBtn.addEventListener('click', () => postToSandbox(MESSAGE_TYPES.PREV));

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || !message.type) return;
        if (!Object.values(MESSAGE_TYPES).includes(message.type)) return;

        switch (message.type) {
            case MESSAGE_TYPES.PLAYER_READY:
                isPlayerReady = true;
                playPauseBtn.disabled = false;
                nextBtn.disabled = false;
                prevBtn.disabled = false;
                updatePlayerStatus('Ready', 'ready');

                if (pendingVideoIds) {
                    const ids = pendingVideoIds;
                    pendingVideoIds = null;
                    postToSandbox(MESSAGE_TYPES.LOAD_QUEUE, { video_ids: ids });
                }
                break;

            case MESSAGE_TYPES.PLAYER_ERROR:
                updatePlayerStatus(message.error || 'Player error', 'error');
                break;

            case MESSAGE_TYPES.PLAYER_STATE:
                if (!message.state) break;
                isPlaying = !message.state.paused;
                playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
                if (message.state.track) {
                    trackName.textContent = message.state.track.name || 'Unknown Track';
                    trackArtist.textContent = message.state.track.artist || '';
                } else {
                    trackName.textContent = 'No track playing';
                    trackArtist.textContent = '';
                }
                break;
        }
    });

    async function checkPendingRecommendations() {
        try {
            const result = await chrome.storage.local.get(['pendingRecommendations', 'recommendationsTimestamp']);
            if (!result.pendingRecommendations || !result.recommendationsTimestamp) return;

            const age = Date.now() - result.recommendationsTimestamp;
            if (age >= 5 * 60 * 1000) return;

            const recs = result.pendingRecommendations.filter(r => r.youtube_id);
            await chrome.storage.local.remove(['pendingRecommendations', 'recommendationsTimestamp']);

            if (recs.length === 0) return;

            const videoIds = recs.map(r => r.youtube_id);
            if (isPlayerReady) {
                postToSandbox(MESSAGE_TYPES.LOAD_QUEUE, { video_ids: videoIds });
            } else {
                pendingVideoIds = videoIds;
                postToSandbox(MESSAGE_TYPES.INIT_PLAYER);
            }
        } catch (error) {
            console.error('Error checking pending recommendations:', error);
        }
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.pendingRecommendations) {
            checkPendingRecommendations();
        }
    });

    updateStatus('READY', 'info');
    testConnection();

    // Kick off the sandbox player so it's ready by the time the user clicks play
    postToSandbox(MESSAGE_TYPES.INIT_PLAYER);
    checkPendingRecommendations();
});
