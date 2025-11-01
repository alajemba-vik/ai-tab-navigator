// Background script that monitors tab updates and clears stale summaries

chrome.runtime.onInstalled.addListener(() => {
  console.debug('[Service Worker] Extension installed');
});

// Listen for tab updates to invalidate summaries when pages change
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only care about URL changes (navigation to new pages)
  if (changeInfo.status === 'complete' && changeInfo.url) {
    console.debug('[Service Worker] Tab navigated:', tabId, changeInfo.url);
    
    // Clear the old summary for this tab since it navigated to a new page
    try {
      const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
      const key = String(tabId);
      
      if (tabSummaries[key]) {
        console.debug('[Service Worker] Clearing stale summary for tab', tabId);
        delete tabSummaries[key];
        await chrome.storage.local.set({ tabSummaries });
      }
    } catch (e) {
      console.warn('[Service Worker] Failed to clear summary for tab', tabId, e);
    }
  }
});

// Listen for tab removal to clean up summaries
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  try {
    const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
    const key = String(tabId);
    
    if (tabSummaries[key]) {
      console.debug('[Service Worker] Cleaning up summary for closed tab', tabId);
      delete tabSummaries[key];
      await chrome.storage.local.set({ tabSummaries });
    }
  } catch (e) {
    console.warn('[Service Worker] Failed to cleanup summary for tab', tabId, e);
  }
});

// Periodic cleanup of stale summaries (run every hour)
chrome.alarms.create('cleanup-summaries', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanup-summaries') {
    try {
      console.debug('[Service Worker] Running periodic summary cleanup');
      const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
      const tabs = await chrome.tabs.query({});
      const currentTabIds = new Set(tabs.map(t => t.id));
      const now = Date.now();
      const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
      
      const cleanedSummaries = {};
      let cleanedCount = 0;
      
      for (const [key, summary] of Object.entries(tabSummaries)) {
        const tabId = parseInt(key);
        if (currentTabIds.has(tabId) && (now - summary.timestamp) < maxAgeMs) {
          cleanedSummaries[key] = summary;
        } else {
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        await chrome.storage.local.set({ tabSummaries: cleanedSummaries });
        console.debug('[Service Worker] Cleaned up', cleanedCount, 'stale summaries');
      }
    } catch (e) {
      console.warn('[Service Worker] Periodic cleanup failed:', e);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle any future background requests
  sendResponse({ ok: true });
});
