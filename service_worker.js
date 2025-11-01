// Background script that monitors tab updates and clears stale summaries

chrome.runtime.onInstalled.addListener(() => {});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && changeInfo.url) {
    try {
      const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
      const key = String(tabId);
      
      if (tabSummaries[key]) {
        delete tabSummaries[key];
        await chrome.storage.local.set({ tabSummaries });
      }
    } catch (e) {}
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  try {
    const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
    const key = String(tabId);
    
    if (tabSummaries[key]) {
      delete tabSummaries[key];
      await chrome.storage.local.set({ tabSummaries });
    }
  } catch (e) {}
});

chrome.alarms.create('cleanup-summaries', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanup-summaries') {
    try {
      const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
      const tabs = await chrome.tabs.query({});
      const currentTabIds = new Set(tabs.map(t => t.id));
      const now = Date.now();
      const maxAgeMs = 24 * 60 * 60 * 1000;
      
      const cleanedSummaries = {};
      
      for (const [key, summary] of Object.entries(tabSummaries)) {
        const tabId = parseInt(key);
        if (currentTabIds.has(tabId) && (now - summary.timestamp) < maxAgeMs) {
          cleanedSummaries[key] = summary;
        }
      }
      
      if (Object.keys(cleanedSummaries).length !== Object.keys(tabSummaries).length) {
        await chrome.storage.local.set({ tabSummaries: cleanedSummaries });
      }
    } catch (e) {}
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle any future background requests
  sendResponse({ ok: true });
});
