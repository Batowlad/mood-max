// Background service worker for Chrome extension.

chrome.runtime.onInstalled.addListener(() => {
    console.log('Superior Reading extension installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrape') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    function: () => {
                        if (window.superiorReadingScrape) {
                            window.superiorReadingScrape();
                        }
                    }
                });
            }
        });
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'scrapingComplete') {
        (async () => {
            try {
                const prefs = await chrome.storage.sync.get(['autoFetchRecommendations', 'testMode']);
                if (!prefs.autoFetchRecommendations) {
                    return;
                }

                const isTestMode = prefs.testMode === true;
                const url = isTestMode
                    ? 'http://localhost:3000/api/recommendations/latest?preset=true'
                    : 'http://localhost:3000/api/recommendations/latest';

                const response = await fetch(url);
                if (!response.ok) {
                    if (response.status === 404) {
                        console.log('[Background] No scraped content found for recommendations');
                        return;
                    }
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || `Server error: ${response.status}`);
                }

                const data = await response.json();
                const recommendations = data?.music_recommendations?.recommendations || [];
                const playable = recommendations.filter(rec => rec.youtube_id);

                if (playable.length === 0) {
                    console.log('[Background] No playable tracks (check YOUTUBE_API_KEY)');
                    return;
                }

                await chrome.storage.local.set({
                    pendingRecommendations: playable,
                    recommendationsTimestamp: Date.now()
                });
                console.log(`[Background] Stored ${playable.length} pending track(s) for playback`);
            } catch (error) {
                console.error('[Background] Auto-fetch error:', error);
            }
        })();
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'startPlayback') {
        (async () => {
            try {
                await chrome.storage.local.set({
                    pendingRecommendations: request.recommendations,
                    recommendationsTimestamp: Date.now()
                });
                sendResponse({ success: true });
            } catch (error) {
                console.error('Error starting playback:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    return false;
});
