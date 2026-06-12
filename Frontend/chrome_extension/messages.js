// Message types shared by the popup, the player page, and the YouTube sandbox.
// Loaded as a plain <script> before the page script so each context sees the
// same constants — keep this file dependency-free.
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
