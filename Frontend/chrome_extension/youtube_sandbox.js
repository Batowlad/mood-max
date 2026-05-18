// YouTube IFrame Player sandbox.
// Loaded inside a sandboxed extension page. Communicates with the parent via postMessage.

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

let player = null;
let apiReady = false;
let queue = [];
let queueIndex = 0;

function sendToParent(type, data = {}) {
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type, ...data }, '*');
    }
}

function loadIframeApi() {
    return new Promise((resolve, reject) => {
        if (window.YT && window.YT.Player) {
            resolve();
            return;
        }
        window.onYouTubeIframeAPIReady = () => resolve();
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => reject(new Error('Failed to load YouTube IFrame API'));
        document.head.appendChild(script);
    });
}

function buildPlayer() {
    return new Promise((resolve) => {
        player = new YT.Player('player', {
            height: '1',
            width: '1',
            playerVars: {
                autoplay: 0,
                controls: 0,
                disablekb: 1,
                fs: 0,
                modestbranding: 1,
                playsinline: 1
            },
            events: {
                onReady: () => resolve(),
                onStateChange: handleStateChange,
                onError: (event) => {
                    console.error('[YT Sandbox] Player error code:', event.data);
                    sendToParent(MESSAGE_TYPES.PLAYER_ERROR, {
                        error: `YouTube error code ${event.data}. Skipping track.`
                    });
                    // Auto-advance on unplayable video
                    setTimeout(playNext, 500);
                }
            }
        });
    });
}

function postCurrentTrack(paused) {
    if (!player || typeof player.getVideoData !== 'function') return;
    const data = player.getVideoData() || {};
    sendToParent(MESSAGE_TYPES.PLAYER_STATE, {
        state: {
            paused,
            track: data.video_id ? {
                id: data.video_id,
                name: data.title || 'Unknown Track',
                artist: data.author || ''
            } : null
        }
    });
}

function handleStateChange(event) {
    const state = event.data;
    if (state === YT.PlayerState.PLAYING) {
        postCurrentTrack(false);
    } else if (state === YT.PlayerState.PAUSED) {
        postCurrentTrack(true);
    } else if (state === YT.PlayerState.ENDED) {
        playNext();
    }
}

function playVideoAt(index) {
    if (!player || queue.length === 0) return;
    queueIndex = ((index % queue.length) + queue.length) % queue.length;
    player.loadVideoById(queue[queueIndex]);
}

function playNext() {
    if (queue.length === 0) return;
    playVideoAt(queueIndex + 1);
}

function playPrev() {
    if (queue.length === 0) return;
    playVideoAt(queueIndex - 1);
}

async function initialize() {
    if (apiReady) return;
    try {
        await loadIframeApi();
        await buildPlayer();
        apiReady = true;
        sendToParent(MESSAGE_TYPES.PLAYER_READY);
    } catch (error) {
        console.error('[YT Sandbox] Init failed:', error);
        sendToParent(MESSAGE_TYPES.PLAYER_ERROR, { error: error.message });
    }
}

window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || !message.type) return;
    if (!Object.values(MESSAGE_TYPES).includes(message.type)) return;

    switch (message.type) {
        case MESSAGE_TYPES.INIT_PLAYER:
            initialize();
            break;
        case MESSAGE_TYPES.LOAD_QUEUE:
            if (!apiReady) {
                // Buffer the queue until player is ready
                initialize().then(() => {
                    queue = Array.isArray(message.video_ids) ? message.video_ids.filter(Boolean) : [];
                    if (queue.length > 0) playVideoAt(0);
                });
                return;
            }
            queue = Array.isArray(message.video_ids) ? message.video_ids.filter(Boolean) : [];
            if (queue.length > 0) playVideoAt(0);
            break;
        case MESSAGE_TYPES.PLAY:
            if (player) player.playVideo();
            break;
        case MESSAGE_TYPES.PAUSE:
            if (player) player.pauseVideo();
            break;
        case MESSAGE_TYPES.NEXT:
            playNext();
            break;
        case MESSAGE_TYPES.PREV:
            playPrev();
            break;
    }
});

console.log('[YT Sandbox] Script loaded');
