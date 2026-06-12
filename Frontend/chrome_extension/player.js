// Player page script for YouTube audio playback.
// Coordinates the sandbox iframe (which holds the YouTube IFrame Player) and
// any incoming recommendations from the background script or storage.

const statusEl = document.getElementById('status');
const trackInfo = document.getElementById('trackInfo');
const playPauseBtn = document.getElementById('playPauseBtn');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const sandboxFrame = document.getElementById('sandboxFrame');

// MESSAGE_TYPES comes from messages.js, loaded before this script

let isPlayerReady = false;
let isPlaying = false;
let pendingVideoIds = null;

function updateStatus(message, type = 'loading') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
}

function postToSandbox(type, data = {}) {
    if (!sandboxFrame.contentWindow) {
        sandboxFrame.addEventListener('load', () => {
            sandboxFrame.contentWindow.postMessage({ type, ...data }, '*');
        }, { once: true });
        return;
    }
    sandboxFrame.contentWindow.postMessage({ type, ...data }, '*');
}

function extractVideoIds(recommendations) {
    return (recommendations || [])
        .map(rec => rec.youtube_id)
        .filter(Boolean);
}

function playRecommendations(recommendations) {
    const videoIds = extractVideoIds(recommendations);

    if (videoIds.length === 0) {
        updateStatus('No playable tracks in recommendations', 'error');
        return;
    }

    if (!isPlayerReady) {
        pendingVideoIds = videoIds;
        postToSandbox(MESSAGE_TYPES.INIT_PLAYER);
        return;
    }

    updateStatus(`Playing ${videoIds.length} track(s)`, 'ready');
    postToSandbox(MESSAGE_TYPES.LOAD_QUEUE, { video_ids: videoIds });
}

window.addEventListener('message', (event) => {
    // Only accept messages from our own sandbox iframe
    if (event.source !== sandboxFrame.contentWindow) return;
    const message = event.data;
    if (!message || !message.type) return;
    if (!Object.values(MESSAGE_TYPES).includes(message.type)) return;

    switch (message.type) {
        case MESSAGE_TYPES.PLAYER_READY:
            isPlayerReady = true;
            playPauseBtn.disabled = false;
            nextBtn.disabled = false;
            prevBtn.disabled = false;
            updateStatus('Player ready', 'ready');

            if (pendingVideoIds) {
                const ids = pendingVideoIds;
                pendingVideoIds = null;
                postToSandbox(MESSAGE_TYPES.LOAD_QUEUE, { video_ids: ids });
            }
            break;

        case MESSAGE_TYPES.PLAYER_ERROR:
            updateStatus(message.error || 'Player error', 'error');
            break;

        case MESSAGE_TYPES.PLAYER_STATE:
            if (!message.state) break;
            isPlaying = !message.state.paused;
            playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
            const track = message.state.track;
            if (track) {
                trackInfo.innerHTML = `
                    <h3>${track.name}</h3>
                    <p>${track.artist || ''}</p>
                `;
            } else {
                trackInfo.innerHTML = '<p>No track playing</p>';
            }
            break;
    }
});

playPauseBtn.addEventListener('click', () => {
    postToSandbox(isPlaying ? MESSAGE_TYPES.PAUSE : MESSAGE_TYPES.PLAY);
});
nextBtn.addEventListener('click', () => postToSandbox(MESSAGE_TYPES.NEXT));
prevBtn.addEventListener('click', () => postToSandbox(MESSAGE_TYPES.PREV));

async function checkPendingRecommendations() {
    try {
        const result = await chrome.storage.local.get(['pendingRecommendations', 'recommendationsTimestamp']);

        if (!result.pendingRecommendations || !result.recommendationsTimestamp) return;

        const age = Date.now() - result.recommendationsTimestamp;
        if (age >= 5 * 60 * 1000) return;

        await chrome.storage.local.remove(['pendingRecommendations', 'recommendationsTimestamp']);
        playRecommendations(result.pendingRecommendations);
    } catch (error) {
        console.error('Error checking pending recommendations:', error);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'playRecommendations') {
        playRecommendations(request.recommendations);
        sendResponse({ success: true });
        return true;
    }
    return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.pendingRecommendations) {
        checkPendingRecommendations();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    postToSandbox(MESSAGE_TYPES.INIT_PLAYER);
    checkPendingRecommendations();
});
