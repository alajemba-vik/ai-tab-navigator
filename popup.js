/**
 * AI Tab Navigator - Smart Tab Search Extension
 * 
 * Features:
 * - Natural Language Search: Handles full sentences like "I am looking for a tab about JavaScript"
 * - Keyword Extraction: Automatically filters out filler words (I, am, looking, for, a, tab, about, etc.)
 * - AI-Powered Matching: Uses on-device AI for intelligent tab relevance scoring
 * - Aggressive Search: Deep content scanning for precise matches
 * - Hashtag Search: Fast tag-based filtering with #hashtags
 * - Keyword Fallback: Traditional keyword search when AI is unavailable
 */

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('queryInput');
  const searchButton = document.getElementById('searchButton');
  const groupButton = document.getElementById('groupButton');
  const endButton = document.getElementById('endButton');
  const status = document.getElementById('status');
  const searchStatus = document.getElementById('searchStatus');
  const backgroundStatus = document.getElementById('backgroundStatus');
  const resultsUl = document.getElementById('results');
  const template = document.getElementById('li_template');
  const historyContainer = document.getElementById('historyContainer');
  const closeAllSummariesBtn = document.getElementById('closeAllSummariesBtn');
  const showMoreContainer = document.getElementById('showMoreContainer');
  const showMoreButton = document.getElementById('showMoreButton');
  const aggressiveSearchToggle = document.getElementById('aggressiveSearchToggle');
  const aiOnlyToggle = document.getElementById('aiOnlyToggle');

  // Onboarding elements
  const onboardingOverlay = document.getElementById('onboardingOverlay');
  const skipOnboarding = document.getElementById('skipOnboarding');
  const completeOnboarding = document.getElementById('completeOnboarding');
  const aiStatusNotice = document.getElementById('aiStatusNotice');
  const showSetupAgain = document.getElementById('showSetupAgain');
  const aiStatusIndicator = document.getElementById('aiStatusIndicator');

  console.info('[AI Tab Navigator] Popup loaded');

  // Cache for on-device sessions per purpose within this popup lifetime
  const sessionCache = new Map(); // key -> {type, session, controller}
  const sessionCreatePromises = new Map(); // key -> Promise

  // History state (removed offset since we show all chips)
  let historyItems = [];
  
  // Active search abort controller
  let activeSearchController = null;
  
  // Pagination state
  const RESULTS_PER_PAGE = 10;
  let currentResultsPage = 1;
  let allSearchResults = [];
  
  // Background summarization state
  let isBackgroundSummarizing = false;
  
  // Scroll position tracking
  let savedScrollPosition = 0;
  
  // AI availability state
  let aiAvailable = null; // null = unknown, true = available, false = unavailable
  
  // Search mode toggles state (mutually exclusive)
  let aggressiveSearchEnabled = false;
  let aiOnlyEnabled = false;

  searchButton.addEventListener('click', () => handleSearch({ groupAfter: false }));
  groupButton.addEventListener('click', handleGroupTabs);
  endButton.addEventListener('click', handleEndSearch);
  closeAllSummariesBtn.addEventListener('click', closeAllSummaries);
  showMoreButton.addEventListener('click', showMoreResults);
  
  // Aggressive search toggle (mutually exclusive with AI Only)
  aggressiveSearchToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Turn off AI Only when enabling Aggressive
      aiOnlyEnabled = false;
      aiOnlyToggle.checked = false;
      await chrome.storage.local.set({ aiOnlyEnabled: false });
    }
    aggressiveSearchEnabled = e.target.checked;
    await chrome.storage.local.set({ aggressiveSearchEnabled: e.target.checked });
  });
  
  // AI Only toggle (mutually exclusive with Aggressive)
  aiOnlyToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Turn off Aggressive when enabling AI Only
      aggressiveSearchEnabled = false;
      aggressiveSearchToggle.checked = false;
      await chrome.storage.local.set({ aggressiveSearchEnabled: false });
    }
    aiOnlyEnabled = e.target.checked;
    await chrome.storage.local.set({ aiOnlyEnabled: e.target.checked });
  });
  
  // Load search mode preferences
  chrome.storage.local.get(['aggressiveSearchEnabled', 'aiOnlyEnabled']).then(({ aggressiveSearchEnabled: savedAggressive, aiOnlyEnabled: savedAiOnly }) => {
    aggressiveSearchEnabled = savedAggressive || false;
    aiOnlyEnabled = savedAiOnly || false;
    
    // Ensure mutual exclusivity on load (Aggressive takes priority if both somehow saved)
    if (aggressiveSearchEnabled && aiOnlyEnabled) {
      aiOnlyEnabled = false;
      chrome.storage.local.set({ aiOnlyEnabled: false });
    }
    
    if (aggressiveSearchToggle) {
      aggressiveSearchToggle.checked = aggressiveSearchEnabled;
    }
    if (aiOnlyToggle) {
      aiOnlyToggle.checked = aiOnlyEnabled;
    }
  });
  
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSearch({ groupAfter: false });
    }
  });

  
  // STATUS & UI HELPERS
  
  
  function updateSearchIconState() {
    const hasText = input.value.trim().length > 0;
    if (hasText) {
      searchButton.classList.add('has-text');
      endButton.style.display = 'block'; // Show Clear Search button when there's text
    } else {
      searchButton.classList.remove('has-text');
      endButton.style.display = 'none'; // Hide Clear Search button when input is empty
    }
  }

  function setStatus(msg, type = '') {
    status.textContent = msg;
    status.className = type;
    if (msg) {
      status.style.display = 'block';
      status.style.visibility = 'visible';
      status.style.opacity = '1';
    } else {
      status.style.display = 'none';
    }
  }

  function pluralize(word, count) {
    return count === 1 ? word : word + 's';
  }

  function setBusy(isBusy, customMessage) {
    searchButton.disabled = isBusy;
    input.disabled = isBusy;
    groupButton.disabled = isBusy ? true : groupButton.disabled;
    endButton.disabled = isBusy ? true : endButton.disabled;
    
    // Disable/enable history chips
    const historyChips = document.querySelectorAll('.history-chip');
    historyChips.forEach(chip => {
      if (isBusy) {
        chip.classList.add('disabled');
      } else {
        chip.classList.remove('disabled');
      }
    });
    
    if (isBusy) {
      searchButton.setAttribute('aria-label', 'Searching...');
      searchButton.title = 'Searching tabs...';
      searchButton.classList.add('searching');
      input.placeholder = 'Searching...';
      searchStatus.textContent = customMessage || 'AI is analyzing your tabs...';
      searchStatus.className = 'searching';
      searchStatus.style.display = 'block';
      searchStatus.style.visibility = 'visible';
      searchStatus.style.opacity = '1';
      status.style.display = 'none';
    } else {
      searchButton.setAttribute('aria-label', 'Search tabs');
      searchButton.title = 'Search tabs';
      searchButton.classList.remove('searching');
      input.placeholder = 'search for a tab...';
      status.style.display = 'block';
      updateSearchIconState();
    }
  }
  
  function showAIWaitingMessage(message) {
    searchStatus.textContent = message;
    searchStatus.className = 'searching';
    searchStatus.style.display = 'block';
    searchStatus.style.visibility = 'visible';
    searchStatus.style.opacity = '1';
    setAIStatus('active');
  }
  
  function hideAIWaitingMessage() {
    searchStatus.textContent = '';
    searchStatus.className = '';
    searchStatus.style.display = 'none';
    if (aiAvailable) {
      setAIStatus('available');
    }
  }

  function setBackgroundStatus(msg) {
    if (msg) {
      backgroundStatus.textContent = msg;
      backgroundStatus.style.display = 'block';
    } else {
      backgroundStatus.textContent = '';
      backgroundStatus.style.display = 'none';
    }
  }

  function setAIStatus(state) {
    // state can be: 'unavailable' (red), 'available' (orange), 'active' (green)
    aiStatusIndicator.className = 'ai-status-indicator ' + state;
    
    // Update tooltip
    const titles = {
      'unavailable': 'AI: Unavailable',
      'available': 'AI: Ready',
      'active': 'AI: Processing'
    };
    aiStatusIndicator.title = titles[state] || 'AI Status';
  }

  async function canUpdateStatus() {
    const { isSearching, aiSearchSession } = await chrome.storage.session.get(['isSearching', 'aiSearchSession']);
    // Don't update status if searching or if there are active search results
    return !isSearching && !searchButton.disabled && !aiSearchSession;
  }

  
  // EVENT LISTENERS - INITIALIZATION
  
  
  // Monitor input changes
  input.addEventListener('input', updateSearchIconState);
  input.addEventListener('paste', () => setTimeout(updateSearchIconState, 0));

  // Initialize icon state
  updateSearchIconState();

  
  // ONBOARDING & AI AVAILABILITY
  
  
  // Onboarding event listeners
  skipOnboarding.addEventListener('click', handleSkipOnboarding);
  completeOnboarding.addEventListener('click', handleCompleteOnboarding);
  showSetupAgain.addEventListener('click', showOnboarding);
  
  // Check onboarding status and AI availability
  checkOnboardingStatus();
  
  // Restore existing session status and UI
  initSessionState();
  
  // Start background summarization immediately
  startBackgroundSummarization();

  
  // BACKGROUND SUMMARIZATION
  

  async function startBackgroundSummarization() {
    if (isBackgroundSummarizing) return;
    
    const { isSearching } = await chrome.storage.session.get('isSearching');
    if (isSearching) return;
    
    try {
      isBackgroundSummarizing = true;
      console.debug('[Background] Starting background summarization');
      const tabs = await chrome.tabs.query({});
      if (!tabs.length) {
        console.debug('[Background] No tabs to summarize');
        return;
      }
      
      // Get existing summaries from persistent storage
      const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
      const now = Date.now();
      const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours cache for persistent storage
      
      // Clean up summaries for tabs that no longer exist
      const currentTabIds = new Set(tabs.map(t => t.id));
      const cleanedSummaries = {};
      for (const [key, summary] of Object.entries(tabSummaries)) {
        const tabId = parseInt(key);
        if (currentTabIds.has(tabId) && (now - summary.timestamp) < maxAgeMs) {
          cleanedSummaries[key] = summary;
        }
      }
      
      // Save cleaned summaries
      if (Object.keys(cleanedSummaries).length !== Object.keys(tabSummaries).length) {
        await chrome.storage.local.set({ tabSummaries: cleanedSummaries });
      }
      
      // Find tabs that need summarization
      const toSummarize = [];
      const alreadyProcessed = [];
      
      for (const t of tabs) {
        if (!isScriptableUrl(t.url)) continue;
        
        const key = String(t.id);
        const cached = cleanedSummaries[key];
        const needsSummary = !cached || 
                            cached.url !== t.url || 
                            (now - cached.timestamp) >= maxAgeMs || 
                            !cached.summary;
        
        if (needsSummary) {
          toSummarize.push(t);
        } else {
          alreadyProcessed.push(t);
        }
      }
      
      if (!toSummarize.length) {
        const totalProcessed = alreadyProcessed.length;
        const totalTabs = tabs.filter(t => isScriptableUrl(t.url)).length;
        if (await canUpdateStatus()) {
          setBackgroundStatus(`Read ${totalProcessed} out of ${totalTabs} tabs`);
        }
        return;
      }
      
      await summarizeTabsWithProgress(toSummarize, alreadyProcessed.length);
      
      const totalProcessed = alreadyProcessed.length + toSummarize.length;
      const totalTabs = tabs.filter(t => isScriptableUrl(t.url)).length;
      if (await canUpdateStatus()) {
        setBackgroundStatus(`Read ${totalProcessed} out of ${totalTabs} tabs`);
      }
      
    } catch (e) {
      console.error('[Background] Summarization failed:', e);
      if (await canUpdateStatus()) {
        setBackgroundStatus('');
      }
    } finally {
      isBackgroundSummarizing = false;
    }
  }

  // Onboarding and AI availability functions
  async function checkOnboardingStatus() {
    const { onboardingCompleted = false } = await chrome.storage.local.get('onboardingCompleted');
    
    if (!onboardingCompleted) {
      showOnboarding();
      return;
    }
    
    // Check AI availability and show notice if needed
    await checkAIAvailability();
  }

  function showOnboarding() {
    onboardingOverlay.classList.remove('hidden');
  }

  function hideOnboarding() {
    onboardingOverlay.classList.add('hidden');
  }

  async function handleSkipOnboarding() {
    await chrome.storage.local.set({ onboardingCompleted: true });
    hideOnboarding();
    // Check AI availability but don't immediately show notice
    setTimeout(() => checkAIAvailability(), 500);
  }

  async function handleCompleteOnboarding() {
    await chrome.storage.local.set({ onboardingCompleted: true });
    hideOnboarding();
    // Give user time to set up AI before checking
    setTimeout(() => checkAIAvailability(), 1000);
  }

  async function checkAIAvailability() {
    try {
      showAICheckingNotice();
      
      const testSystemPrompt = 'Test prompt for availability check.';
      const testSession = await createOnDeviceSession(testSystemPrompt);
      
      if (testSession && testSession.session) {
        try {
          if (testSession.type === 'LanguageModel' && testSession.session.destroy) {
            testSession.session.destroy();
          }
        } catch (e) {
          console.debug('[AI-STATUS] Test session cleanup failed:', e);
        }
        
        aiAvailable = true;
        setAIStatus('available');
        hideAIStatusNotice();
        return;
      }
    } catch (e) {
      console.debug('[AI-STATUS] AI availability test failed:', e);
    }
    
    aiAvailable = false;
    setAIStatus('unavailable');
    const { onboardingCompleted = false } = await chrome.storage.local.get('onboardingCompleted');
    if (onboardingCompleted) {
      showAIStatusNotice();
    }
  }

  function showAICheckingNotice() {
    aiStatusNotice.className = 'ai-status-notice checking';
    aiStatusNotice.innerHTML = '<strong>🔍 Checking AI features...</strong> Any search will use basic text search until verified.';
    aiStatusNotice.classList.remove('hidden');
  }

  function showAIStatusNotice() {
    aiStatusNotice.className = 'ai-status-notice warning';
    aiStatusNotice.innerHTML = '<strong>⚠️ Fallback Mode:</strong> AI features unavailable. Using basic search. <a href="#" id="showSetupAgain">Enable AI features</a> for better results.';
    aiStatusNotice.classList.remove('hidden');
    
    // Re-attach event listener for the new link
    const showSetupAgain = document.getElementById('showSetupAgain');
    if (showSetupAgain) {
      showSetupAgain.addEventListener('click', showOnboarding);
    }
  }

  function hideAIStatusNotice() {
    aiStatusNotice.classList.add('hidden');
  }

  async function summarizeTabsWithProgress(tabs, alreadyProcessedCount = 0) {
    // Use local storage for persistent caching across browser sessions
    const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
    const now = Date.now();
    const totalTabs = tabs.length + alreadyProcessedCount;
    
    // Process in larger batches for speed (10 tabs at a time instead of 1)
    const BATCH_SIZE = 10;
    
    for (let batchStart = 0; batchStart < tabs.length; batchStart += BATCH_SIZE) {
      const batch = tabs.slice(batchStart, batchStart + BATCH_SIZE);
      const batchEnd = Math.min(batchStart + BATCH_SIZE, tabs.length);
      const currentTotal = alreadyProcessedCount + batchEnd;
      
      if (await canUpdateStatus()) {
        setBackgroundStatus(`Reading tabs (${currentTotal}/${totalTabs})`);
      }
      
      try {
        // Extract text from all tabs in batch (parallel)
        const extracted = await extractTextFromTabs(batch);
        
        if (extracted.length) {
          // Summarize entire batch at once (parallel)
          const summarized = await summarizeBatch(extracted);
          
          for (const summary of summarized) {
            tabSummaries[String(summary.id)] = { 
              url: summary.url, 
              summary: summary.summary, 
              tags: summary.tags || [],
              timestamp: now,
              tabId: summary.id
            };
          }
        }
      } catch (e) {
        // Store fallback summaries for failed batch
        for (const tab of batch) {
          const fallbackSummary = `${tab.title || ''} ${tab.url || ''}`.trim() || tab.url || '';
          tabSummaries[String(tab.id)] = { 
            url: tab.url, 
            summary: fallbackSummary, 
            timestamp: now,
            tabId: tab.id
          };
        }
      }
      
      // Save progress after each batch
      await chrome.storage.local.set({ tabSummaries });
    }
    
    // Clear the background status after completion
    setBackgroundStatus('');
    
    console.debug('[Background] Completed summarization of', tabs.length, 'new tabs, total processed:', totalTabs);
  }

  
  // SESSION STATE MANAGEMENT
  

  async function initSessionState() {
    try {
      await loadHistory();
      renderHistory();

      const { aiSearchSession, isSearching } = await chrome.storage.session.get(['aiSearchSession', 'isSearching']);
      console.debug('[Init] Restored session:', aiSearchSession, 'isSearching:', isSearching);
      
      // If a search was in progress when popup closed, restore that state
      if (isSearching) {
        input.value = isSearching.query || '';
        updateSearchIconState();
        setBusy(true);
        // Ensure status is visible when restoring
        status.style.display = 'block';
        status.style.visibility = 'visible';
        status.style.opacity = '1';
        console.debug('[Init] Restoring in-progress search for query:', isSearching.query);
        // Continue the search
        handleSearch({ groupAfter: false, isRestore: true });
        return;
      }
      
      if (aiSearchSession?.query) {
        // Restore search input
        input.value = aiSearchSession.query;
        updateSearchIconState(); // Update icon state based on restored text
        
        // Restore status
        status.textContent = `Active search: "${truncate(aiSearchSession.query, 40)}"`;
        status.className = '';
        status.style.display = 'block';
        endButton.disabled = false;
        groupButton.disabled = false;
        updateClearSearchButton();
        await updateGroupButton();
        const tabs = await chrome.tabs.query({});
        console.debug('[Init] Tabs count:', tabs.length);
        renderResultsList(tabs, aiSearchSession.tabIds, aiSearchSession.preserveOrder !== false);
        // Restore scroll position after results are rendered
        await restoreScrollPosition();
      } else {
        endButton.disabled = true;
        groupButton.disabled = true;
        endButton.style.display = 'none';
      }
    } catch (e) {
      console.error('[Init] Failed to restore session', e);
    }
  }

  
  // SEARCH HISTORY
  

  async function removeFromHistory(queryToRemove) {
    try {
      const { searchHistoryByDate = {} } = await chrome.storage.local.get('searchHistoryByDate');
      const todayKey = getTodayKey();
      const arr = Array.isArray(searchHistoryByDate[todayKey]) ? searchHistoryByDate[todayKey] : [];
      
      // Filter out the query to remove
      const filtered = arr.filter(item => item.query !== queryToRemove);
      searchHistoryByDate[todayKey] = filtered;
      
      await chrome.storage.local.set({ searchHistoryByDate });
      console.debug('[History] Removed query:', queryToRemove);
      
      // Reload and re-render
      await loadHistory();
      renderHistory();
    } catch (e) {
      console.error('[History] Error removing query:', e);
    }
  }

  async function loadHistory() {
    const { searchHistoryByDate = {} } = await chrome.storage.local.get('searchHistoryByDate');
    const todayKey = getTodayKey();
    const arr = Array.isArray(searchHistoryByDate[todayKey]) ? searchHistoryByDate[todayKey] : [];
    console.debug('[History] Loaded', arr.length, 'items for', todayKey, ':', arr.map(item => item.query));
    // Keep only last 5 for view
    historyItems = arr.slice(0, 5);
  }

  function renderHistory() {
    historyContainer.innerHTML = '';
    console.debug('[History] Rendering', historyItems.length, 'history items');
    
    if (!historyItems.length) {
      console.debug('[History] No history items to display');
      return;
    }
    
    for (const item of historyItems) {
      const chip = document.createElement('div');
      chip.className = 'history-chip';
      
      const chipText = document.createElement('span');
      chipText.className = 'history-chip-text';
      chipText.textContent = truncate(item.query, 20);
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'history-chip-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove from history';
      
      chip.appendChild(chipText);
      chip.appendChild(removeBtn);
      
      // Click chip to search - uses same handleSearch logic
      chip.addEventListener('click', (e) => {
        if (e.target === removeBtn || chip.classList.contains('disabled')) return;
        input.value = item.query;
        updateSearchIconState();
        handleSearch({ groupAfter: false });
      });
      
      // Remove chip functionality
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeFromHistory(item.query);
      });
      
      historyContainer.appendChild(chip);
    }
  }

  function getTodayKey() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  
  // MAIN SEARCH HANDLER
  

  async function handleSearch(options) {
    const { groupAfter, isRestore } = options || { groupAfter: false, isRestore: false };
    const query = input.value.trim();
    console.info('[Search] Query:', query, 'groupAfter:', groupAfter, 'isRestore:', isRestore);
    if (!query) {
      setStatus('Please enter a search query.', 'error');
      return;
    }

    // Create abort controller for this search
    activeSearchController = new AbortController();
    const searchSignal = activeSearchController.signal;

    // Clear old results immediately when starting new search (unless restoring)
    if (!isRestore) {
      resultsUl.innerHTML = '';
      closeAllSummariesBtn.style.display = 'none';
      status.textContent = '';
      status.style.display = 'none';
      setBackgroundStatus(''); // Clear background status when starting search
    }
    groupButton.disabled = true;
    groupButton.textContent = 'Group';
    groupButton.title = 'Group the current matches';
    
    // Detect search mode to show appropriate status message
    const hashtagInfo = parseHashtagQuery(query);
    
    if (aggressiveSearchEnabled) {
      // For aggressive search, don't show any initial message - it will set its own
      console.debug('[Search] Mode: aggressive - skipping setBusy message');
      searchButton.disabled = true;
      input.disabled = true;
      searchButton.setAttribute('aria-label', 'Searching...');
      searchButton.title = 'Searching tabs...';
      searchButton.classList.add('searching');
      input.placeholder = 'Searching...';
    } else {
      // For hashtag or normal AI search, show appropriate message
      let searchMessage;
      if (hashtagInfo.isHashtagSearch) {
        searchMessage = `Searching tags: ${hashtagInfo.tags.map(t => '#' + t).join(', ')}...`;
      } else {
        searchMessage = 'AI is analyzing your tabs...';
      }
      setBusy(true, searchMessage);
      
      status.style.display = 'block';
      status.style.visibility = 'visible';
      status.style.opacity = '1';
    }
    
    await chrome.storage.session.set({ isSearching: { query, timestamp: Date.now() } });

    try {
      const tabs = await chrome.tabs.query({});
      if (!tabs.length) {
        setStatus('No open tabs found.', 'error');
        return;
      }
      
      // Filter out chrome:// URLs unless user explicitly searches for them
      const queryLower = query.toLowerCase();
      const searchingForChromePages = queryLower.includes('extension') || queryLower.includes('chrome://');
      const filteredTabs = searchingForChromePages 
        ? tabs 
        : tabs.filter(tab => !tab.url || !tab.url.startsWith('chrome://'));
      
      if (!filteredTabs.length) {
        setStatus('No matching tabs found.', 'error');
        return;
      }
      
      if (searchSignal.aborted) return;

      const summaries = await getExistingSummaries(filteredTabs);

      if (searchSignal.aborted) return;

      const selectedTabIds = await selectFromSummariesWithAIOrFallback(summaries, query, searchSignal);
      
      if (searchSignal.aborted) return;

      // 3) Log search history and update display
      await logSearchHistory(query, selectedTabIds);
      await loadHistory();
      renderHistory();

      if (!selectedTabIds.length) {
        setStatus('No matching tabs found.', 'error');
        resultsUl.innerHTML = '';
        closeAllSummariesBtn.style.display = 'none';
        endButton.style.display = 'none';
        groupButton.disabled = true;
        groupButton.textContent = 'Group'; // Reset to default text
        groupButton.title = 'Group the current matches';
        await chrome.storage.session.remove('aiSearchSession');
        await clearHighlightsSafely();
        return;
      }

      // Display results list - preserve AI order for relevance
      renderResultsList(filteredTabs, selectedTabIds, true);

      // For new searches, start at the top
      savedScrollPosition = 0;
      await chrome.storage.session.remove('scrollPosition');

      // Persist session (no groups yet) - Skip highlighting to prevent popup from closing
      const sessionRecord = await buildSessionRecord(selectedTabIds, query, []);
      console.debug('[Search] Persist sessionRecord:', sessionRecord);
      await chrome.storage.session.set({ aiSearchSession: sessionRecord });

      endButton.disabled = false;
      groupButton.disabled = false;
      updateClearSearchButton();
      await updateGroupButton();

      // Check result sources to determine status message
      const { tabResultSources = {} } = await chrome.storage.session.get('tabResultSources');
      const hasAI = selectedTabIds.some(id => tabResultSources[id] === 'ai');
      const hasKeyword = selectedTabIds.some(id => tabResultSources[id] === 'keyword');
      
      if (hasAI && hasKeyword) {
        const aiCount = selectedTabIds.filter(id => tabResultSources[id] === 'ai').length;
        const keywordCount = selectedTabIds.filter(id => tabResultSources[id] === 'keyword').length;
        setStatus(`Found ${selectedTabIds.length} ${pluralize('tab', selectedTabIds.length)} (${aiCount} AI, ${keywordCount} keyword).`, 'success');
      } else if (hasKeyword) {
        // Don't set final status yet - AI is still processing and will update the count
        // Just show that we're working on it
        setStatus(`Searching with AI...`, '');
      } else {
        setStatus(`Found ${selectedTabIds.length} ${pluralize('tab', selectedTabIds.length)}.`, 'success');
      }

      if (groupAfter) {
        await handleGroupTabs();
      }
    } catch (err) {
      console.error('[Search] Error:', err);
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      setBusy(false);
      // Clear the searching state flag
      await chrome.storage.session.remove('isSearching');
      // Clear the active search controller
      activeSearchController = null;
    }
  }

  async function getExistingSummaries(tabs) {
    // Use persistent storage for better caching
    const { tabSummaries = {} } = await chrome.storage.local.get('tabSummaries');
    const now = Date.now();
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours cache

    const results = [];

    for (const t of tabs) {
      const key = String(t.id);
      const cached = tabSummaries[key];
      
      // Use cached summary if available and fresh
      if (cached && cached.url === t.url && (now - cached.timestamp) < maxAgeMs && cached.summary) {
        results.push({ 
          id: t.id, 
          title: t.title || '', 
          url: t.url || '', 
          summary: cached.summary,
          tags: cached.tags || []
        });
      } else {
        // Use fallback for tabs without summaries (non-scriptable URLs or new tabs)
        const fallbackSummary = !isScriptableUrl(t.url) 
          ? `${t.title || ''} ${t.url || ''}`.trim() || t.url || ''
          : `${t.title || ''} ${t.url || ''}`.trim() || 'Loading...';
        const fallbackTags = generateFallbackTags(t.title, t.url);
        results.push({ 
          id: t.id, 
          title: t.title || '', 
          url: t.url || '', 
          summary: fallbackSummary,
          tags: fallbackTags
        });
      }
    }

    return results;
  }

  // --- Summaries pipeline ---
  function isScriptableUrl(url) {
    try {
      const u = new URL(url || '');
      // Only allow http and https protocols
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      
      // Block Chrome Web Store (both old and new URLs)
      if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return false;
      if (u.hostname === 'chromewebstore.google.com') return false;
      
      // Block Chrome internal management pages (but allow developer.chrome.com)
      if (u.hostname === 'chrome.google.com') return false;
      
      // Block extension pages
      if (u.protocol === 'chrome-extension:') return false;
      
      // Block other special protocols
      if (u.protocol.startsWith('chrome')) return false;
      
      return true;
    } catch { return false; }
  }

  async function buildOrGetSummaries(tabs) {
    const { tabSummaries = {} } = await chrome.storage.session.get('tabSummaries');
    const now = Date.now();
    const maxAgeMs = 5 * 60 * 1000; // 5 minutes cache

    const results = [];
    const toSummarize = [];

    for (const t of tabs) {
      if (!isScriptableUrl(t.url)) {
        console.debug('[Extract] Skipping non-scriptable/restricted URL (tabId', t.id, '):', t.url);
        const key = String(t.id);
        if (tabSummaries[key]?.summary && tabSummaries[key].url === t.url && (now - tabSummaries[key].timestamp) < maxAgeMs) {
          results.push({ id: t.id, title: t.title || '', url: t.url || '', summary: tabSummaries[key].summary });
        } else {
          // Use the URL and title as the summary when we cannot inject
          const fallbackSummary = `${t.title || ''} ${t.url || ''}`.trim() || t.url || '';
          results.push({ id: t.id, title: t.title || '', url: t.url || '', summary: fallbackSummary });
        }
        continue;
      }
      const key = String(t.id);
      const cached = tabSummaries[key];
      if (cached && cached.url === t.url && (now - cached.timestamp) < maxAgeMs && cached.summary) {
        results.push({ id: t.id, title: t.title || '', url: t.url || '', summary: cached.summary });
      } else {
        toSummarize.push(t);
      }
    }

    if (toSummarize.length) {
      const extracted = await extractTextFromTabs(toSummarize);
      const summarized = await summarizeBatch(extracted);
      for (const s of summarized) {
        tabSummaries[String(s.id)] = { url: s.url, summary: s.summary, timestamp: now };
        results.push(s);
      }
      await chrome.storage.session.set({ tabSummaries });
    }

    return results;
  }

    async function extractTextFromTabs(tabs) {
    const tasks = tabs.map(async (t) => {
      if (!isScriptableUrl(t.url)) {
        console.debug('[Extract] Skipping non-scriptable/restricted URL (tabId', t.id, '):', t.url);
        return { id: t.id, title: t.title || '', url: t.url || '', text: '' };
      }
      
      // Check if tab is still valid and has completed loading
      try {
        const tab = await chrome.tabs.get(t.id);
        if (tab.status === 'loading') {
          console.debug('[Extract] Tab still loading, using fallback for tabId', t.id);
          const fallbackText = `${t.title || ''} ${t.url || ''}`.trim();
          return { id: t.id, title: t.title || '', url: t.url || '', text: fallbackText };
        }
        
        // Double-check URL hasn't changed
        if (tab.url !== t.url) {
          console.debug('[Extract] Tab URL changed during processing, tabId', t.id);
          const fallbackText = `${tab.title || t.title || ''} ${tab.url || t.url || ''}`.trim();
          return { id: t.id, title: tab.title || t.title || '', url: tab.url || t.url || '', text: fallbackText };
        }
      } catch (e) {
        console.debug('[Extract] Tab no longer exists, tabId', t.id);
        return { id: t.id, title: t.title || '', url: t.url || '', text: '' };
      }
      
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: t.id, allFrames: false },
          func: () => {
            try {
              const getMeta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')
                || document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
              const title = document.title || '';
              const desc = getMeta('description') || '';
              const bodyText = document.body ? document.body.innerText || '' : '';
              const text = (title + '\n' + desc + '\n' + bodyText).replace(/\s+/g, ' ').trim();
              return text.slice(0, 4000);
            } catch (e) { return ''; }
          }
        });
        const text = (res?.result || '').trim();
        console.debug('[Extract] Successfully extracted', text.length, 'chars from tabId', t.id);
        return { id: t.id, title: t.title || '', url: t.url || '', text };
      } catch (e) {
        // This is expected for some URLs - just log and use fallback
        console.debug('[Extract] Content extraction not available for tabId', t.id, '- using title/URL fallback');
        const fallbackText = `${t.title || ''} ${t.url || ''}`.trim();
        return { id: t.id, title: t.title || '', url: t.url || '', text: fallbackText };
      }
    });

    const extracted = await Promise.all(tasks);
    console.debug('[Extract] Completed', extracted.length, 'tabs');
    return extracted;
  }

  // Extract full page text for aggressive keyword search
  async function extractFullPageText(tabs) {
    console.log('[AggressiveSearch] Extracting full page text from', tabs.length, 'tabs');
    
    const results = await Promise.all(tabs.map(async (tab) => {
      if (!isScriptableUrl(tab.url)) {
        console.debug('[AggressiveSearch] Skipping non-scriptable URL:', tab.url);
        return {
          id: tab.id,
          title: tab.title || '',
          url: tab.url || '',
          fullText: `${tab.title || ''} ${tab.url || ''}`.trim()
        };
      }
      
      try {
        // First, try to inject the content script if not already present
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content_script.js']
          });
          console.debug('[AggressiveSearch] Injected content script into tab', tab.id);
        } catch (injectError) {
          // Script might already be injected, which is fine
          console.debug('[AggressiveSearch] Script already injected or injection failed for tab', tab.id);
        }
        
        // Now send message to content script to extract page text
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'extractPageText',
          tabId: tab.id
        });
        
        if (response && response.success) {
          console.debug('[AggressiveSearch] Extracted', response.text.length, 'chars from tab', tab.id);
          return {
            id: tab.id,
            title: tab.title || '',
            url: tab.url || '',
            fullText: response.text
          };
        } else {
          throw new Error(response?.error || 'Failed to extract text');
        }
      } catch (error) {
        console.debug('[AggressiveSearch] Content script error for tab', tab.id, ':', error.message);
        // Fallback to title and URL
        return {
          id: tab.id,
          title: tab.title || '',
          url: tab.url || '',
          fullText: `${tab.title || ''} ${tab.url || ''}`.trim()
        };
      }
    }));
    
    console.log('[AggressiveSearch] Completed extraction for', results.length, 'tabs');
    return results;
  }

  async function summarizeBatch(extracted) {
   //const systemPrompt = 'You summarize web page text into one concise sentence and provide 3 relevant category tags. Always respond in valid JSON format: {"summary": "one sentence summary", "tags": ["tag1", "tag2", "tag3"]}. Escape any quotes in the summary text properly.';
   const systemPrompt = `You are an **EXTREMELY CRITICAL and PRECISE** tab relevance scorer. Your sole purpose is to identify tabs that are **DIRECTLY AND PRIMARILY** about the user's query, assigning a relevance score from 1 (completely irrelevant) to 10 (perfect, unequivocal match).

      **Scoring Guidelines (READ AND ADHERE STRICTLY):**
      - **10 (Perfect, Primary Focus):** The tab's main topic and content are an **EXACT, undeniable, and central match** to the user's query. This tab is precisely what the user is looking for. No ambiguity.
      - **8-9 (Strong, Direct Relevance):** The tab is **unquestionably focused** on the user's query. It's not a perfect keyword match, but the content's primary subject is clearly the query. **Only use 8-9 if the tab's core purpose IS the query.**
      - **5-7 (Moderate, Supporting Relevance):** The tab is **tangentially or secondarily related** to the query. It might contain information *about* the query, but the query is not its main subject. This could be a broader category, a related sub-topic, or a tool that *uses* the query topic. **These scores should be rare.**
      - **1-4 (Low or No Relevance):** The tab has a weak, incidental, or abstract connection to the query. **THESE SCORES MUST NEVER BE INCLUDED IN THE FINAL JSON OUTPUT.**

      **ABSOLUTE CRITICAL RULES (VIOLATING THESE IS A FAILURE):**
      1.  **SEVERE STRICTNESS:** It is **ALWAYS better to assign a score below 5 (and thus exclude) or a score of 1** than to falsely assign a high score (8-10) to a tab that isn't a direct and primary match. Over-inclusion is a critical error.
      2.  **NEW RULE - PRIMARY TOPIC vs. MERE MENTION:** You MUST distinguish between a tab *about* the query (e.g., a "JavaScript tutorial" for query "JavaScript") and a tab that *mentions* the query (e.g., a "web design" article that mentions "JavaScript"). A mere mention, even if in the title, **CANNOT** receive a score higher than 5. A score of 8-10 is **RESERVED** for tabs whose **PRIMARY TOPIC** is the query.
      3.  **NO "SOUNDS LIKE" OR "RELATED TO":** Do not score highly based on tabs that are just in the same general category. The connection must be direct and central.
      4.  **OUTPUT JSON:** You MUST respond with a valid JSON object: \`{"results": [{"tabId": number, "relevanceScore": number}]}\`.
      5.  **STRICT FILTERING:** **ONLY** include tabs with a \`relevanceScore\` of 5 or higher in your JSON. **NEVER** include tabs with scores 1-4.
      6.  **SORTING:** Sort the results in descending order by \`relevanceScore\`.
      7.  **PENALTY FOR DOUBT:** If you are in ANY doubt, assign a score of 1-4. High scores must be absolutely certain.
      `;
    console.log('[AI-LOG] Summarization System Prompt:', systemPrompt);
    
    const session = await getOnDeviceSession('summarize', systemPrompt);

    // Process all tabs in parallel for maximum speed
    const summaryPromises = extracted.map(async (item) => {
      let summary = '';
      let tags = [];
      
      if (session && item.text) {
        const prompt = `Analyze this page and provide a summary and 30 tags in valid JSON format.
Title: ${item.title}
URL: ${item.url}
Text: ${item.text}

Extract 30 tags/keywords covering:
- Broad categories (e.g., "technology", "education", "entertainment")
- Medium categories (e.g., "web-development", "machine-learning", "productivity")
- Specific/niche tags (e.g., "react-hooks", "python-django", "css-flexbox")
- Topics mentioned (e.g., "tutorial", "documentation", "news", "blog")
- Technologies/tools (e.g., "javascript", "vscode", "github")

Respond with valid JSON only (escape any quotes with \\): {"summary": "one sentence describing what this page is about", "tags": ["tag1", "tag2", ..., "tag30"]}`;
        console.log('[AI-LOG] Summarization Input for tab', item.id + ':', {
          title: item.title,
          url: item.url,
          textLength: item.text?.length || 0,
          textPreview: item.text?.substring(0, 200) + (item.text?.length > 200 ? '...' : ''),
          fullPrompt: prompt.substring(0, 300) + '...'
        });
        
        try {
          const raw = await applyOnDevicePrompt(session, prompt);
          console.log('[AI-LOG] Summarization Output for tab', item.id + ':', raw);
          console.debug('[AI] Summary raw:', raw);
          
          // Try to parse JSON response
          let parsed = null;
          parsed = safeJsonParse(raw || '{}');
          
          if (!parsed) {
            console.warn('[AI-LOG] Failed to parse JSON response, treating as plain text');
            // Fallback: treat as plain text summary
            const rawSummary = (raw || '').trim();
            const maxLength = 500;
            summary = rawSummary.length > maxLength ? rawSummary.slice(0, maxLength) + '...' : rawSummary;
          }
          
          if (parsed && parsed.summary) {
            const maxLength = 500;
            summary = parsed.summary.length > maxLength ? parsed.summary.slice(0, maxLength) + '...' : parsed.summary;
            tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3) : [];
            console.log('[AI-LOG] Parsed summary and tags for tab', item.id + ':', { summary, tags });
          }
          
        } catch (e) { 
          console.warn('[Summarize] AI failed for tabId', item.id, e); 
          console.log('[AI-LOG] Summarization Error for tab', item.id + ':', e.message);
        }
      } else {
        console.log('[AI-LOG] Skipping AI summarization for tab', item.id + ':', {
          reason: !session ? 'No AI session' : 'No text content',
          hasSession: !!session,
          hasText: !!item.text,
          textLength: item.text?.length || 0
        });
      }
      
      if (!summary) {
        // If we couldn't read text, prefer URL-only summary; else use snippet or title
        const fallbackMaxLength = 500; // Increased from 240 to 500 characters
        const fallbackText = item.text || item.title || item.url || '';
        
        if (fallbackText.length > fallbackMaxLength) {
          summary = fallbackText.slice(0, fallbackMaxLength) + '...';
          console.log('[AI-LOG] Fallback summary truncated for tab', item.id + '- original length:', fallbackText.length, 'truncated to:', fallbackMaxLength);
        } else {
          summary = fallbackText;
        }
        
        // Generate simple tags from title and URL for fallback
        const fallbackTags = generateFallbackTags(item.title, item.url);
        tags = fallbackTags;
        
        console.log('[AI-LOG] Using fallback summary and tags for tab', item.id + ':', { summary, tags });
      }
      
      return { id: item.id, title: item.title, url: item.url, summary, tags };
    });
    
    const results = await Promise.all(summaryPromises);
    console.debug('[Summarize] Completed', results.length, 'summaries');
    return results;
  }

  function generateFallbackTags(title, url) {
    const tags = [];
    
    try {
      // Extract domain-based tags
      const urlObj = new URL(url || '');
      const domain = urlObj.hostname.replace('www.', '').toLowerCase();
      
      // Common domain patterns
      if (domain.includes('github')) tags.push('development');
      else if (domain.includes('stackoverflow') || domain.includes('stackexchange')) tags.push('programming');
      else if (domain.includes('youtube') || domain.includes('vimeo')) tags.push('video');
      else if (domain.includes('linkedin') || domain.includes('twitter') || domain.includes('facebook')) tags.push('social');
      else if (domain.includes('amazon') || domain.includes('ebay') || domain.includes('shop')) tags.push('shopping');
      else if (domain.includes('gmail') || domain.includes('outlook') || domain.includes('mail')) tags.push('email');
      else if (domain.includes('docs.google') || domain.includes('office.com')) tags.push('documents');
      else if (domain.includes('calendar')) tags.push('calendar');
      else if (domain.includes('drive.google') || domain.includes('dropbox') || domain.includes('onedrive')) tags.push('storage');
      else if (domain.includes('news') || domain.includes('cnn') || domain.includes('bbc')) tags.push('news');
      else {
        // Use domain name as a tag
        const domainParts = domain.split('.');
        if (domainParts.length > 1) {
          tags.push(domainParts[0]);
        }
      }
      
      // Extract path-based tags
      const path = urlObj.pathname.toLowerCase();
      if (path.includes('insurance')) tags.push('insurance');
      if (path.includes('finance') || path.includes('bank')) tags.push('finance');
      if (path.includes('health') || path.includes('medical')) tags.push('health');
      if (path.includes('education') || path.includes('course')) tags.push('education');
      if (path.includes('job') || path.includes('career')) tags.push('jobs');
      
    } catch (e) {
      // URL parsing failed, skip URL-based tags
    }
    
    // Extract title-based tags
    if (title) {
      const titleLower = title.toLowerCase();
      if (titleLower.includes('insurance')) tags.push('insurance');
      if (titleLower.includes('finance') || titleLower.includes('bank')) tags.push('finance');
      if (titleLower.includes('health') || titleLower.includes('medical')) tags.push('health');
      if (titleLower.includes('education') || titleLower.includes('course')) tags.push('education');
      if (titleLower.includes('job') || titleLower.includes('career')) tags.push('jobs');
      if (titleLower.includes('news')) tags.push('news');
      if (titleLower.includes('shop') || titleLower.includes('buy')) tags.push('shopping');
      if (titleLower.includes('video') || titleLower.includes('watch')) tags.push('video');
      if (titleLower.includes('doc') || titleLower.includes('edit')) tags.push('documents');
    }
    
    // Remove duplicates and limit to 3
    const uniqueTags = [...new Set(tags)];
    return uniqueTags.slice(0, 3);
  }

  async function selectFromSummariesWithAIOrFallback(summaries, query, signal) {
    console.debug('[Search] Starting selection for query:', query, 'from', summaries.length, 'summaries');
    console.log('[AggressiveSearch] Current state:', aggressiveSearchEnabled);
    
    // Check for hashtag search (takes priority over everything)
    const hashtagQuery = parseHashtagQuery(query);
    if (hashtagQuery.isHashtagSearch) {
      console.log('[HashtagSearch] Using fast tag-only search');
      const results = await performTagSearch(summaries, hashtagQuery.tags);
      
      // Mark all results as 'keyword' source
      const resultSources = {};
      results.forEach(id => { resultSources[id] = 'keyword'; });
      await chrome.storage.session.set({ tabResultSources: resultSources });
      
      return results;
    }
    
    // Check if aggressive search is enabled
    if (aggressiveSearchEnabled) {
      console.log('[AggressiveSearch] Aggressive mode enabled - using sequential tab-by-tab search with progressive results');
      
      // Extract meaningful keywords from the query
      const keywords = extractKeywords(query);
      const q = query.toLowerCase();
      const words = keywords; // Use extracted keywords instead of all words
      const minScore = Math.max(words.length * 2, 4);
      
      console.log('[AggressiveSearch] Using keywords:', keywords);
      
      const results = [];
      const reasonsMap = {};
      const scoresMap = {};
      const tabs = await chrome.tabs.query({});
      
      console.log('[AggressiveSearch] Starting sequential search through', tabs.length, 'tabs');
      
      // Update status to show aggressive search is running
      setStatus(`Aggressive search: 0/${tabs.length} tabs searched...`, '');
      
      // Search tab by tab sequentially
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const summary = summaries.find(s => s.id === tab.id);
        if (!summary) continue;
        
        // Check if aborted
        if (signal?.aborted) {
          setStatus(`Search aborted. Found ${results.length} tabs (searched ${i + 1}/${tabs.length})`, 'success');
          break;
        }
        
        // Quick check: title, URL, tags first (no text extraction needed)
        const title = (summary.title || '').toLowerCase();
        const tags = (summary.tags || []).map(tag => tag.toLowerCase()).join(' ');
        let urlParts = '';
        try {
          const url = new URL(summary.url || '');
          urlParts = `${url.hostname.replace('www.', '')} ${url.pathname.replace(/[\/\-_]/g, ' ')}`.toLowerCase();
        } catch {
          urlParts = (summary.url || '').toLowerCase();
        }
        
        let score = 0;
        const matchedIn = [];
        const matchedWords = [];
        
        // Score based on title, tags, URL
        for (const word of words) {
          if (word.length < 3) continue;
          const stem = word.replace(/(?:ing|ed|s|es|ship|ships)$/i, '');
          
          const titleMatch = title.includes(word) || (stem.length >= 3 && title.includes(stem));
          const tagMatch = tags.includes(word) || (stem.length >= 3 && tags.includes(stem));
          const urlMatch = urlParts.includes(word) || (stem.length >= 3 && urlParts.includes(stem));
          
          if (titleMatch || tagMatch || urlMatch) {
            matchedWords.push(word);
          }
          
          if (titleMatch) {
            score += 5;
            matchedIn.push('title');
          }
          if (tagMatch) {
            score += 7;
            matchedIn.push('tags');
          }
          if (urlMatch) {
            score += 1;
            matchedIn.push('url');
          }
        }
        
        // If score is already good enough, add to results
        if (score >= minScore) {
          results.push(tab.id);
          const reason = `Matched "${matchedWords.join('", "')}" in ${[...new Set(matchedIn)].join(', ')}`;
          reasonsMap[tab.id] = reason;
          scoresMap[tab.id] = score;
          
          // Update UI immediately with current results (progressive/streaming)
          await chrome.storage.session.set({
            tabSelectionReasons: reasonsMap,
            tabSelectionScores: scoresMap
          });
          
          const resultSources = {};
          results.forEach(id => { resultSources[id] = 'keyword'; });
          await chrome.storage.session.set({ tabResultSources: resultSources });
          
          // Render current results
          const allTabs = await chrome.tabs.query({});
          renderResultsList(allTabs, results, true);
          
          // Update status
          setStatus(`Aggressive search: ${i + 1}/${tabs.length} tabs | Found ${results.length} matches`, 'success');
          
          continue;
        }
        
        // If no quick match, extract full text and check content
        if (isScriptableUrl(tab.url)) {
          setStatus(`Aggressive search: ${i + 1}/${tabs.length} tabs | Scanning: "${tab.title.substring(0, 30)}..."`, '');
          
          const fullTextResult = await extractFullPageText([tab]);
          const fullText = fullTextResult[0]?.fullText || '';
          
          if (fullText) {
            const fullTextLower = fullText.toLowerCase();
            
            // Search in full text
            for (const word of words) {
              if (word.length < 3) continue;
              const stem = word.replace(/(?:ing|ed|s|es|ship|ships)$/i, '');
              
              const contentMatch = fullTextLower.includes(word) || (stem.length >= 3 && fullTextLower.includes(stem));
              
              if (contentMatch) {
                matchedWords.push(word);
                score += 4;
                matchedIn.push('content');
              }
            }
            
            // If found match in content, add to results
            if (score >= minScore) {
              results.push(tab.id);
              const reason = `Matched "${matchedWords.join('", "')}" in ${[...new Set(matchedIn)].join(', ')}`;
              reasonsMap[tab.id] = reason;
              scoresMap[tab.id] = score;
              console.log('[AggressiveSearch] Tab', i + 1, '- Content match (score:', score + '):', tab.title);
              
              // Update UI immediately with current results (progressive/streaming)
              await chrome.storage.session.set({
                tabSelectionReasons: reasonsMap,
                tabSelectionScores: scoresMap
              });
              
              const resultSources = {};
              results.forEach(id => { resultSources[id] = 'keyword'; });
              await chrome.storage.session.set({ tabResultSources: resultSources });
              
              // Render current results
              const allTabs = await chrome.tabs.query({});
              renderResultsList(allTabs, results, true);
              
              // Update status
              setStatus(`Aggressive search: ${i + 1}/${tabs.length} tabs | Found ${results.length} matches`, 'success');
            }
          }
        }
        
        // Update progress every 10 tabs
        if ((i + 1) % 10 === 0) {
          console.log('[AggressiveSearch] Progress:', i + 1, '/', tabs.length, 'tabs searched,', results.length, 'matches found');
          setStatus(`Aggressive search: ${i + 1}/${tabs.length} tabs | Found ${results.length} matches`, 'success');
        }
      }
      
      console.log('[AggressiveSearch] Sequential search complete:', results.length, 'total matches');
      setStatus(`Found ${results.length} ${pluralize('tab', results.length)} (searched all ${tabs.length} tabs).`, 'success');
      
      // Final update
      await chrome.storage.session.set({
        tabSelectionReasons: reasonsMap,
        tabSelectionScores: scoresMap
      });
      
      // Mark all results as 'keyword' source
      const resultSources = {};
      results.forEach(id => { resultSources[id] = 'keyword'; });
      await chrome.storage.session.set({ tabResultSources: resultSources });
      
      return results;
    }
    
    // Normal flow with AI
    // Show AI waiting message immediately while AI processes
    const aiMessages = [
      'AI is finding the most relevant tabs...',
      'Analyzing tab content with AI...',
      'AI is scoring tab relevance...',
      'Matching your query with AI...',
      'AI is searching through your tabs...'
    ];
    const randomMessage = aiMessages[Math.floor(Math.random() * aiMessages.length)];
    showAIWaitingMessage(randomMessage);
    
    // Check if AI Only mode is enabled
    if (aiOnlyEnabled) {
      console.log('[Search] AI Only mode enabled - skipping fallback search');
      // Only use AI, no fallback
      const idsFromAI = await tryOnDeviceSelectFromSummaries(summaries, query, signal);
      hideAIWaitingMessage();
      
      if (idsFromAI && idsFromAI.length) {
        console.debug('[Search] AI Only returned', idsFromAI.length, 'tab IDs');
        hideAIStatusNotice();
        
        // Mark all AI results as 'ai' source
        const resultSources = {};
        idsFromAI.forEach(id => { resultSources[id] = 'ai'; });
        await chrome.storage.session.set({ tabResultSources: resultSources });
        
        return idsFromAI;
      }
      
      // AI failed and AI Only mode is on - return empty (no fallback)
      console.debug('[Search] AI Only mode: No results from AI, not using fallback');
      return [];
    }
    
    // Normal mode: Start both searches in parallel for faster results

    const fallbackPromise = performFallbackSearch(summaries, query);
    const aiPromise = tryOnDeviceSelectFromSummaries(summaries, query, signal);
    
    // Get fallback results first (they're fast)
    const fallbackIds = await fallbackPromise;
    console.debug('[Search] Fallback returned', fallbackIds.length, 'tab IDs:', fallbackIds);
    
    // Check if aborted
    if (signal?.aborted) {
      console.debug('[Search] Search aborted, stopping AI processing');
      hideAIWaitingMessage();
      return [];
    }
    
    // If we have fallback results, return them immediately and let AI enhance later
    if (fallbackIds.length > 0) {
      // Mark these tabs as from keyword search initially
      const resultSources = {};
      fallbackIds.forEach(id => { resultSources[id] = 'keyword'; });
      await chrome.storage.session.set({ tabResultSources: resultSources });
      
      // Return fallback results immediately for fast UI update
      // Then wait for AI to potentially add more results
      aiPromise.then(async idsFromAI => {
        // Check if aborted before processing AI results
        if (signal?.aborted) {
          console.debug('[Search] Search aborted, ignoring AI results');
          return;
        }
        
        if (idsFromAI && idsFromAI.length) {
          console.debug('[Search] AI returned', idsFromAI.length, 'relevance-scored tab IDs');
          hideAIStatusNotice();
          hideAIWaitingMessage(); // Hide AI waiting message
          
          // Detailed logging of AI vs fallback comparison
          console.log('[AI-Replace] === Replacing fallback results with AI results ===');
          console.log('[AI-Replace] AI results:', idsFromAI);
          console.log('[AI-Replace] Fallback results (will be replaced):', fallbackIds);
          
          // Find which tabs are in both results
          const aiSet = new Set(idsFromAI);
          const fallbackSet = new Set(fallbackIds);
          
          const duplicates = idsFromAI.filter(id => fallbackSet.has(id));
          const aiOnly = idsFromAI.filter(id => !fallbackSet.has(id));
          const fallbackOnly = fallbackIds.filter(id => !aiSet.has(id));
          
          console.log('[AI-Replace] Tabs in both (AI replaces keyword version):', duplicates.length, duplicates);
          console.log('[AI-Replace] Tabs only in AI results (new additions):', aiOnly.length, aiOnly);
          console.log('[AI-Replace] Tabs only in fallback (will be removed):', fallbackOnly.length, fallbackOnly);
          
          // REPLACEMENT STRATEGY: Use ONLY AI results, discard fallback-only tabs
          // This ensures AI scoring and reasoning completely replaces keyword matching
          const finalIds = idsFromAI; // Only keep AI results
          
          console.log('[AI-Replace] Final result: Using AI results only');
          console.log('[AI-Replace] Previous count:', fallbackIds.length, '→ New count:', finalIds.length);
          console.log('[AI-Replace] Removed', fallbackOnly.length, 'keyword-only results');
          
          // Get AI scores for sorting
          const { tabSelectionScores = {} } = await chrome.storage.session.get('tabSelectionScores');
          console.log('[AI-Replace] Top 5 AI scores:', finalIds.slice(0, 5).map(id => `ID=${id} Score=${tabSelectionScores[id]}`));
          
          // Mark ALL results as 'ai' source (no keyword results remain)
          const updatedSources = {};
          finalIds.forEach(id => { updatedSources[id] = 'ai'; });
          await chrome.storage.session.set({ tabResultSources: updatedSources });
          
          // Update UI with AI results only
          if (finalIds.length !== fallbackIds.length || !finalIds.every((id, i) => id === fallbackIds[i])) {
            console.log('[AI-Replace] Updating UI with AI-only results');
            
            // Store that we have AI results
            await chrome.storage.session.set({ aiResultsAdded: true, originalFallbackIds: fallbackIds });
            
            chrome.tabs.query({}).then(async tabs => {
              renderResultsList(tabs, finalIds, true);
              // Update session with AI results
              const { aiSearchSession } = await chrome.storage.session.get('aiSearchSession');
              if (aiSearchSession) {
                const updated = { ...aiSearchSession, tabIds: finalIds };
                await chrome.storage.session.set({ aiSearchSession: updated });
              }
              
              // Show status with AI result count - use actual finalIds count
              const aiCount = finalIds.length;
              
              console.log('[AI-Replace] Setting status with final AI count:', aiCount);
              
              // Create status message - always show final count clearly
              status.textContent = `Found ${aiCount} ${pluralize('tab', aiCount)}.`;
              status.className = 'success';
            });
          } else {
            console.log('[AI-Replace] Results identical - no UI update needed');
            // Same tabs, just update the status message
            hideAIWaitingMessage();
            setStatus(`Found ${finalIds.length} ${pluralize('tab', finalIds.length)}.`, 'success');
          }
        } else {
          // AI failed or returned no results
          hideAIWaitingMessage();
          // Show fallback notification when AI fails
          chrome.storage.local.get('onboardingCompleted').then(({ onboardingCompleted = false }) => {
            if (onboardingCompleted && aiAvailable === false) {
              showAIStatusNotice();
            }
          });
        }
      });
      
      return fallbackIds;
    }
    
    // If no fallback results, wait for AI
    const idsFromAI = await aiPromise;
    hideAIWaitingMessage(); // Hide AI message after AI completes
    
    if (idsFromAI && idsFromAI.length) {
      console.debug('[Search] AI returned', idsFromAI.length, 'relevance-scored tab IDs:', idsFromAI);
      hideAIStatusNotice();
      
      // Mark all AI results as 'ai' source
      const resultSources = {};
      idsFromAI.forEach(id => { resultSources[id] = 'ai'; });
      await chrome.storage.session.set({ tabResultSources: resultSources });
      
      return idsFromAI;
    }
    
    // Show fallback notification when AI fails and we haven't shown onboarding
    const { onboardingCompleted = false } = await chrome.storage.local.get('onboardingCompleted');
    if (onboardingCompleted && aiAvailable === false) {
      showAIStatusNotice();
    }
    
    return [];
  }
  
  // Detect and parse hashtag queries
  function parseHashtagQuery(query) {
    const trimmed = query.trim();
    
    // Check if query contains hashtags
    if (trimmed.includes('#')) {
      // Extract all hashtags
      const hashtags = trimmed
        .split(/[,\s]+/) // Split by comma or space
        .filter(word => word.startsWith('#'))
        .map(tag => tag.substring(1).toLowerCase()) // Remove # and lowercase
        .filter(Boolean);
      
      if (hashtags.length > 0) {
        console.log('[HashtagSearch] Detected hashtag search:', hashtags);
        return { isHashtagSearch: true, tags: hashtags };
      }
    }
    
    return { isHashtagSearch: false, tags: [] };
  }
  
  // Fast tag-only search
  async function performTagSearch(summaries, searchTags) {
    console.log('[HashtagSearch] Searching for tags:', searchTags);
    
    const results = [];
    const reasonsMap = {};
    const scoresMap = {};
    
    for (const summary of summaries) {
      const tabTags = (summary.tags || []).map(t => t.toLowerCase());
      
      let matchedTags = [];
      let score = 0;
      
      // Check how many search tags match this tab's tags
      for (const searchTag of searchTags) {
        for (const tabTag of tabTags) {
          // Exact match or partial match
          if (tabTag === searchTag || tabTag.includes(searchTag) || searchTag.includes(tabTag)) {
            matchedTags.push(searchTag);
            score += 10; // High score for tag matches
            break;
          }
        }
      }
      
      // Include tab if at least one tag matches
      if (matchedTags.length > 0) {
        results.push(summary.id);
        reasonsMap[summary.id] = `Matched tags: #${matchedTags.join(', #')}`;
        scoresMap[summary.id] = score;
      }
    }
    
    // Store reasons and scores
    await chrome.storage.session.set({
      tabSelectionReasons: reasonsMap,
      tabSelectionScores: scoresMap
    });
    
    console.log('[HashtagSearch] Found', results.length, 'tabs matching tags');
    return results;
  }
  
  // Extract meaningful keywords from natural language queries
  function extractKeywords(query) {
    // Common filler words/phrases to ignore when extracting keywords
    // Since this is a tab search tool, users often say "looking for tab about X" or "tab is about Y"
    // We want to keep the actual topic (X, Y) but remove the search-related filler
    const stopWords = new Set([
      // Personal pronouns and articles
      'i', 'me', 'my', 'your', 'a', 'an', 'the',
      // Tab search context (users say this because it's a tab tool)
      'tab', 'tabs', 'looking', 'find', 'search', 'show', 'open',
      // Prepositions that don't add meaning
      'for', 'about', 'in', 'on', 'at', 'to', 'from', 'with', 'of',
      // Conjunctions
      'and', 'or', 'but',
      // Demonstratives
      'this', 'that', 'these', 'those',
      // Common verbs that are just filler
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'should', 'could', 'may', 'might', 'can',
      'want', 'need', 'am', 'try', 'get', 'go', 'see',
      // Vague qualifiers
      'related', 'some', 'any', 'all', 'where'
    ]);
    
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    
    // Filter out stop words and keep meaningful keywords
    const keywords = words.filter(word => {
      // Keep words that are:
      // - Not stop words
      // - Longer than 2 characters (keeps meaningful short words like "git", "npm", "api")
      return !stopWords.has(word) && word.length > 2;
    });
    
    // If no keywords found (query was all stop words), return original words
    // This handles edge cases like "ai" or "ml" where the query IS the stop word
    if (keywords.length === 0) {
      console.log('[KeywordExtract] No keywords found after filtering, using all words');
      return words;
    }
    
    console.log('[KeywordExtract] Original query:', query);
    console.log('[KeywordExtract] Extracted keywords:', keywords);
    
    return keywords;
  }
  
  async function performFallbackSearch(summaries, query, fullTextData = null) {
    // Extract meaningful keywords from the query
    const keywords = extractKeywords(query);
    const q = query.toLowerCase();
    const words = keywords; // Use extracted keywords instead of all words
    
    // If aggressive search is enabled and we have full text data, use it
    const isAggressive = fullTextData !== null;
    if (isAggressive) {
      console.log('[AggressiveSearch] Using full page text for keyword search');
    }
    
    const scored = summaries.map(s => {
      // Search in title, summary, tags, and parsed URL parts
      const title = (s.title || '').toLowerCase();
      const summary = (s.summary || '').toLowerCase();
      const tags = (s.tags || []).map(tag => tag.toLowerCase()).join(' ');
      
      // Extract domain and path from URL for better matching
      let urlParts = '';
      try {
        const url = new URL(s.url || '');
        urlParts = `${url.hostname.replace('www.', '')} ${url.pathname.replace(/[\/\-_]/g, ' ')}`.toLowerCase();
      } catch {
        urlParts = (s.url || '').toLowerCase();
      }
      
      // If aggressive search, include full page text
      let fullText = '';
      if (isAggressive && fullTextData) {
        const tabFullText = fullTextData.find(ft => ft.id === s.id);
        fullText = tabFullText ? (tabFullText.fullText || '').toLowerCase() : '';
      }
      
      const searchText = isAggressive 
        ? `${title} ${tags} ${urlParts} ${fullText}` 
        : `${title} ${summary} ${tags} ${urlParts}`;
      
      let score = 0;
      const matchedIn = []; // Track where matches were found
      const matchedWords = []; // Track which words were matched
      
      // Score based on keyword matches with different weights
      for (const word of words) {
        // Skip very short words (less than 3 chars) to avoid too many false positives
        if (word.length < 3) continue;
        
        // Create a simple stem by removing common suffixes
        const stem = word.replace(/(?:ing|ed|s|es|ship|ships)$/i, '');
        
        // Check for both exact and stemmed matches
        const titleMatch = title.includes(word) || (stem.length >= 3 && title.includes(stem));
        const summaryMatch = !isAggressive && (summary.includes(word) || (stem.length >= 3 && summary.includes(stem)));
        const tagMatch = tags.includes(word) || (stem.length >= 3 && tags.includes(stem));
        const urlMatch = urlParts.includes(word) || (stem.length >= 3 && urlParts.includes(stem));
        const fullTextMatch = isAggressive && fullText && (fullText.includes(word) || (stem.length >= 3 && fullText.includes(stem)));
        
        if (titleMatch || summaryMatch || tagMatch || urlMatch || fullTextMatch) {
          matchedWords.push(word);
        }
        
        if (titleMatch) {
          score += 5; // Title matches are most important
          matchedIn.push('title');
        }
        if (tagMatch) {
          score += 7; // Tag matches are highly important
          matchedIn.push('tags');
        }
        if (summaryMatch) {
          score += 3; // Summary matches are good
          matchedIn.push('summary');
        }
        if (fullTextMatch) {
          score += 4; // Full text matches are important in aggressive mode
          matchedIn.push('content');
        }
        if (urlMatch) {
          score += 1; // URL matches are helpful
          matchedIn.push('url');
        }
      }
      
      return { id: s.id, score, title, url: s.url, tags: s.tags, searchText, matchedIn: [...new Set(matchedIn)], matchedWords: [...new Set(matchedWords)] };
    });
    
    scored.sort((a, b) => b.score - a.score);
    
    // More selective: require higher scores for better precision
    const minScore = Math.max(words.length * 2, 4); // Require at least 2 points per word, minimum 4
    const filtered = scored.filter(x => x.score >= minScore);
    
    // Generate reasons for each result
    const reasonsMap = {};
    const scoresMap = {};
    
    for (const item of filtered) {
      const locations = item.matchedIn;
      const matchedWords = item.matchedWords;
      
      // Build a human-readable reason
      let reason = 'Matched ';
      if (matchedWords.length > 0) {
        reason += `"${matchedWords.join('", "')}" in `;
      }
      reason += locations.join(', ');
      
      reasonsMap[item.id] = reason;
      scoresMap[item.id] = item.score;
    }
    
    // Store reasons in session storage for rendering
    try {
      await chrome.storage.session.set({
        tabSelectionReasons: reasonsMap,
        tabSelectionScores: scoresMap
      });
    } catch (err) {
      console.error('[Search] Failed to store fallback reasons:', err);
    }
    
    const results = filtered.map(x => x.id);
    
    console.debug('[Search] Fallback scoring results:');
    console.debug('[Search] Query words:', words);
    console.debug('[Search] Min score threshold:', minScore);
    console.debug('[Search] Top 5 scored tabs:', scored.slice(0, 5).map(x => ({ id: x.id, score: x.score, title: x.title })));
    console.debug('[Search] Selected', results.length, 'tabs with score >=', minScore);
    
    return results;
  }

  async function tryOnDeviceSelectFromSummaries(summaries, query, signal) {
    console.log('[AI-SELECTION] Starting AI tab selection with relevance scoring');
    
    try {
      const systemPrompt = `Tab relevance scorer. Find tabs matching ALL query keywords in context.

RULES:
1. ALL keywords must be found in the tab (missing one = exclude)
2. Check TAGS first - they show the page's true topic
3. Context matters: "X for Y" means X in context of Y (e.g., "math for data science" needs both math AND data science context)

FORMAT: "Keywords: 'X' in [location]: '[text]', 'Y' in [location]: '[text]'"

EXAMPLE: Query "math for data science"
✅ MATCH: Tab with tags: 'mathematics, data-science, statistics' 
❌ NO MATCH: Tab with only 'mathematics' tag (missing data science context)

Score 6-10, return JSON: {"results": [{"id": number, "relevanceScore": number, "reason": string}]}`;
      
      const sessionObj = await getOnDeviceSession('select_scored', systemPrompt);
      if (!sessionObj) {
        console.debug('[AI] No session available for scoring, falling back.');
        aiAvailable = false;
        return [];
      }
      
      // Check if aborted before making AI call
      if (signal?.aborted) {
        console.debug('[AI] Search aborted, skipping AI prompt');
        return [];
      }
      
      // Include a stable string reference for each tab so AI doesn't confuse numeric IDs.
      // AI should refer to tabs by the 'ref' field (tab1, tab2, ...). We'll map refs back to real IDs.
      const anonymousTabs = summaries.map((s, idx) => ({
        ref: `tab${idx + 1}`,
        id: s.id, // real browser tab id (for internal mapping)
        title: s.title || 'Untitled',
        summary: s.summary || 'No summary',
        tags: s.tags || [],
        url: s.url || ''
      }));

      // Build a quick lookup from ref -> tab data and ref -> real id
      const refToTab = new Map();
      const refToId = new Map();
      anonymousTabs.forEach(tab => {
        refToTab.set(tab.ref, tab);
        refToId.set(tab.ref, tab.id);
      });
      
      // Schema: AI must return 'ref' (string like 'tab1'), relevanceScore and reason
      const schema = {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ref: { type: 'string', description: "The tab ref from the provided list (e.g. 'tab1')" },
                relevanceScore: { type: 'number', description: 'Score from 1-10, only include if >= 6' },
                reason: { type: 'string', description: 'MUST quote exact text from title/summary/tags/URL containing query keywords' }
              },
              required: ['ref', 'relevanceScore', 'reason']
            }
          }
        },
        required: ['results']
      };

      const userPrompt = [
        `Query: "${query}"`,
        ``,
        `RULES:`,
        `1. ALL keywords must match (missing one = exclude)`,
        `2. Check TAGS first - they show true topic`,
        `3. "X for Y" = need both X AND Y context`,
        `4. Semantic match ONLY if same category (ice-cream IS food ✓, NOT movies ✗)`,
        `5. No hedging ("but", "however", "might") = exclude tab`,
        `6. Score: 10=perfect, 8=good semantic, 6=weak, 4-5=loose`,
        `7. Include score >= 4`,
        ``,
        `FORMAT: "Keywords: 'X' in title: '[exact text]', 'Y' in tags: 'tag1'"`,
        ``,
        `Tabs:`,
        JSON.stringify(anonymousTabs, null, 2)
      ].join('\n');

      console.log('[AI-SELECTION] Sending scoring request to AI...');
      console.debug('[AI] Prompting AI for scored selection. Query:', query);
      
      // Pass the abort signal to the AI prompt
      let raw = await applyOnDevicePrompt(sessionObj, userPrompt, schema, signal);
      
      // Check if aborted after AI call
      if (signal?.aborted) {
        console.debug('[AI] Search aborted after AI prompt');
        return [];
      }
      
      console.log('[AI-SELECTION] AI Response received:', raw);
      console.debug('[AI] Select (scored) raw response:', raw);
      
      let parsed = safeJsonParse(raw);
      if (parsed?.results && Array.isArray(parsed.results)) {
        // Extract keywords from query to validate AI actually found them
        const queryKeywords = extractKeywords(query);
        console.log('[AI-VALIDATION] Checking if AI found all keywords:', queryKeywords);
        
        // Create a map of tab refs to tab data for validation (ref = 'tab1', 'tab2', ...)
        // We already built refToTab and refToId above.
        
        // First pass: try with score >= 6 (high quality)
        let validResults = parsed.results
          .filter(r => {
            // Basic validation: must have a ref (string) and a numeric relevanceScore
            if (!r.ref || typeof r.ref !== 'string') return false;
            if (!Number.isFinite(r.relevanceScore)) return false;
            if (!r.reason || typeof r.reason !== 'string') return false;
            
            // First pass: only accept high-quality results (score >= 6)
            if (r.relevanceScore < 6) return false;

            // CRITICAL: Validate the ref exists in our provided data
            const tabData = refToTab.get(r.ref);
            if (!tabData) {
              console.warn(`[AI-VALIDATION] Ref ${r.ref} REJECTED - ref not found in tab list`);
              return false;
            }

            // CRITICAL: Validate that the reason contains text from the ACTUAL tab
            const reasonLower = r.reason.toLowerCase();
            const titleLower = (tabData.title || '').toLowerCase();
            const summaryLower = (tabData.summary || '').toLowerCase();
            const urlLower = (tabData.url || '').toLowerCase();
            const tagsLower = (tabData.tags || []).map(t => t.toLowerCase()).join(' ');

            // Extract quoted text from reason (text between single quotes that AI claimed to find)
            const quotedTexts = r.reason.match(/'([^']+)'/g) || [];

            if (quotedTexts.length > 0) {
              let foundMatch = false;

              // Check if quoted text matches THIS tab (by ref)
              for (const quoted of quotedTexts) {
                const cleanQuoted = quoted.replace(/'/g, '').toLowerCase().trim();
                if (cleanQuoted.length < 5) continue; // Skip very short quoted text

                const matchesThisTab = titleLower.includes(cleanQuoted) ||
                                      summaryLower.includes(cleanQuoted) ||
                                      urlLower.includes(cleanQuoted) ||
                                      tagsLower.includes(cleanQuoted);

                if (matchesThisTab) {
                  foundMatch = true;
                  break;
                }
              }

              if (!foundMatch) {
                const claimedId = refToId.get(r.ref);
                console.error(`[AI-VALIDATION] ❌ Ref ${r.ref} (ID=${claimedId}) REJECTED - quoted text doesn't match this tab`);
                console.error(`[AI-VALIDATION] AI claimed ref: ${r.ref}, Title="${tabData.title}"`);
                console.error(`[AI-VALIDATION] AI reason: "${r.reason}"`);
                console.error(`[AI-VALIDATION] Quoted texts: ${quotedTexts.join(', ')}`);
                return false; // Exclude - quoted text doesn't match this tab
              }
            }

            // CRITICAL: Detect uncertainty/hedging in AI's reason
            // If AI is uncertain, it shouldn't return the result at all
            const uncertaintyPhrases = [
              'but context is',
              'however',
              'but it',
              'although',
              'not directly',
              'not exactly',
              'might be',
              'could be',
              'possibly',
              'perhaps',
              'may be related',
              'somewhat related',
              'loosely related',
              'tangentially',
              'indirectly',
              'not quite',
              'not really',
              'unclear',
              'unsure',
              'uncertain'
            ];
            
            const hasUncertainty = uncertaintyPhrases.some(phrase => reasonLower.includes(phrase));
            if (hasUncertainty) {
              const claimedId = refToId.get(r.ref);
              console.warn(`[AI-VALIDATION] Ref ${r.ref} (ID=${claimedId}) REJECTED - AI expressed uncertainty in reason`);
              console.warn(`[AI-VALIDATION] AI reason: ${r.reason}`);
              return false; // Exclude - AI is uncertain about this match
            }

            // CRITICAL: Validate that the reason addresses the query
            // Allow semantic matches: if AI provided a detailed explanation, trust it
            // Count how many keywords are explicitly mentioned in the reason
            const foundKeywords = queryKeywords.filter(keyword => {
              const keywordLower = keyword.toLowerCase();
              return reasonLower.includes(keywordLower);
            });
            
            const keywordMatchRatio = queryKeywords.length > 0 ? foundKeywords.length / queryKeywords.length : 1;
            
            // Reject only if:
            // - Less than 40% of keywords are mentioned AND
            // - Reason is short (not a detailed semantic explanation)
            // This allows semantic matches like "ice-cream" for "food" while filtering out irrelevant results
            if (keywordMatchRatio < 0.4 && r.reason.length < 50) {
              const claimedId = refToId.get(r.ref);
              const missingKeywords = queryKeywords.filter(k => !foundKeywords.includes(k));
              console.warn(`[AI-VALIDATION] Ref ${r.ref} (ID=${claimedId}) REJECTED - insufficient keyword coverage (${Math.round(keywordMatchRatio * 100)}%). Missing: ${missingKeywords.join(', ')}`);
              console.warn(`[AI-VALIDATION] Query keywords: ${queryKeywords.join(', ')}`);
              console.warn(`[AI-VALIDATION] AI reason: ${r.reason}`);
              return false; // Exclude this result - reason doesn't adequately explain the match
            }

            return true;
          })
          .sort((a, b) => b.relevanceScore - a.relevanceScore); // Re-sort just in case AI didn't

        // If no high-quality results found, try again with lower threshold (score >= 4)
        if (validResults.length === 0) {
          console.log('[AI-VALIDATION] No results with score >= 6, lowering threshold to >= 4');
          validResults = parsed.results
            .filter(r => {
              // Basic validation
              if (!r.ref || typeof r.ref !== 'string') return false;
              if (!Number.isFinite(r.relevanceScore)) return false;
              if (!r.reason || typeof r.reason !== 'string') return false;
              
              // Second pass: accept lower scores (4-5)
              if (r.relevanceScore < 4) return false;

              const tabData = refToTab.get(r.ref);
              if (!tabData) return false;

              const reasonLower = r.reason.toLowerCase();
              const titleLower = (tabData.title || '').toLowerCase();
              const summaryLower = (tabData.summary || '').toLowerCase();
              const urlLower = (tabData.url || '').toLowerCase();
              const tagsLower = (tabData.tags || []).map(t => t.toLowerCase()).join(' ');

              const quotedTexts = r.reason.match(/'([^']+)'/g) || [];

              if (quotedTexts.length > 0) {
                let foundMatch = false;
                for (const quoted of quotedTexts) {
                  const cleanQuoted = quoted.replace(/'/g, '').toLowerCase().trim();
                  if (cleanQuoted.length < 5) continue;

                  const matchesThisTab = titleLower.includes(cleanQuoted) ||
                                        summaryLower.includes(cleanQuoted) ||
                                        urlLower.includes(cleanQuoted) ||
                                        tagsLower.includes(cleanQuoted);

                  if (matchesThisTab) {
                    foundMatch = true;
                    break;
                  }
                }

                if (!foundMatch) {
                  return false;
                }
              }

              const uncertaintyPhrases = [
                'but context is', 'however', 'but it', 'although',
                'not directly', 'not exactly', 'might be', 'could be',
                'possibly', 'perhaps', 'may be related', 'somewhat related',
                'loosely related', 'tangentially', 'indirectly',
                'not quite', 'not really', 'unclear', 'unsure', 'uncertain'
              ];
              
              if (uncertaintyPhrases.some(phrase => reasonLower.includes(phrase))) {
                return false;
              }

              const foundKeywords = queryKeywords.filter(keyword => {
                return reasonLower.includes(keyword.toLowerCase());
              });
              
              const keywordMatchRatio = queryKeywords.length > 0 ? foundKeywords.length / queryKeywords.length : 1;
              
              // For lower scores, be more lenient (30% threshold instead of 40%)
              if (keywordMatchRatio < 0.3 && r.reason.length < 50) {
                return false;
              }

              return true;
            })
            .sort((a, b) => b.relevanceScore - a.relevanceScore);
        }

        // Store reasons and scores indexed by REAL tab ID (mapped from ref)
        const tabReasons = {};
        const tabScores = {};
        const finalIds = validResults.map(r => {
          const tabId = refToId.get(r.ref);
          tabReasons[tabId] = r.reason;
          tabScores[tabId] = r.relevanceScore;
          return tabId;
        });
        
        // Get existing fallback reasons from storage (if any) to preserve them
        const existingData = await chrome.storage.session.get(['tabSelectionReasons', 'tabSelectionScores']);
        const existingReasons = existingData.tabSelectionReasons || {};
        const existingScores = existingData.tabSelectionScores || {};
        
        // Merge: AI reasons take precedence, fallback reasons are preserved for tabs not in AI results
        const mergedReasons = { ...existingReasons, ...tabReasons };
        const mergedScores = { ...existingScores, ...tabScores };
        
        // Store the merged reasons and scores in session storage
        await chrome.storage.session.set({ 
          tabSelectionReasons: mergedReasons,
          tabSelectionScores: mergedScores
        });

        console.log('[AI-SELECTION] AI scoring results:');
        console.log('[AI-SELECTION] Parsed and validated results:', validResults);
        
        if (validResults.length > 0) {
          console.log('[AI-SELECTION] Top selected tabs with scores:');
          validResults.slice(0, 5).forEach((res, idx) => {
            const tab = summaries.find(s => s.id === res.id);
            console.log(`[AI-SELECTION] ${idx + 1}: ID=${res.id}, Score=${res.relevanceScore}, Reason="${res.reason}", Title="${tab?.title}"`);
          });
        } else {
          console.log('[AI-SELECTION] No tabs met the minimum relevance score of 6.');
        }
        
        aiAvailable = true;
        return finalIds;
      } else {
        console.log('[AI-SELECTION] Failed to parse valid scored results from AI response.');
      }
      
      return [];
    } catch (e) {
      // Check if it's an abort error - don't mark AI as unavailable
      if (signal?.aborted || e.name === 'AbortError') {
        console.debug('[AI] Selection aborted');
        return [];
      }
      
      // Only mark AI as unavailable for actual AI failures, not code errors
      console.error('[AI] Scored selection from summaries failed:', e);
      // Don't set aiAvailable = false for code errors, only for actual AI unavailability
      return [];
    }
  }

  async function handleGroupTabs() {
    try {
      const { aiSearchSession } = await chrome.storage.session.get('aiSearchSession');
      console.debug('[Group] Session before group/ungroup:', aiSearchSession);
      if (!aiSearchSession?.tabIds?.length) { 
        setStatus('No current matches to group.', 'error'); 
        return; 
      }

      // Check if tabs are already grouped
      const hasGroups = aiSearchSession.groups && aiSearchSession.groups.length > 0;
      
      if (hasGroups) {
        // Ungroup existing groups
        console.debug('[Ungroup] Ungrouping existing groups:', aiSearchSession.groups);
        
        for (const g of aiSearchSession.groups) {
          try { 
            const tabsInGroup = await chrome.tabs.query({ groupId: g.groupId }); 
            const tabIds = tabsInGroup.map(t => t.id).filter(Boolean); 
            if (tabIds.length) {
              await chrome.tabs.ungroup(tabIds);
              console.debug('[Ungroup] Ungrouped', tabIds.length, 'tabs from group', g.groupId);
            }
          } catch (e) {
            console.warn('[Ungroup] Failed to ungroup:', e);
          }
        }
        
        // Remove groups from session but keep search results
        const updated = { ...aiSearchSession, groups: [] };
        await chrome.storage.session.set({ aiSearchSession: updated });
        setStatus(`Ungrouped ${aiSearchSession.tabIds.length} ${pluralize('tab', aiSearchSession.tabIds.length)}.`, 'success');
        
      } else {
        // Group tabs
        const groups = await groupResultsByWindow(aiSearchSession.tabIds, aiSearchSession.query);
        console.info('[Group] Created groups:', groups);
        const updated = { ...aiSearchSession, groups };
        await chrome.storage.session.set({ aiSearchSession: updated });
        setStatus(`Grouped ${aiSearchSession.tabIds.length} ${pluralize('tab', aiSearchSession.tabIds.length)}.`, 'success');
      }
      
      // Update button text after operation
      await updateGroupButton();
      
    } catch (e) { 
      console.error('[Group] Error:', e); 
      setStatus(`Group operation failed: ${e.message}`, 'error'); 
    }
  }

  async function handleEndSearch() {
    setBusy(true);
    setStatus('Clearing search results…', '');
    
    // Abort any active search operations
    if (activeSearchController) {
      console.debug('[Clear] Aborting active search operations');
      activeSearchController.abort();
      activeSearchController = null;
    }
    
    // Hide AI waiting message immediately
    hideAIWaitingMessage();
    
    try {
      const { aiSearchSession } = await chrome.storage.session.get('aiSearchSession');
      console.debug('[Clear] Clearing search session:', aiSearchSession);
      
      if (aiSearchSession) {
        // Ungroup any grouped tabs
        if (Array.isArray(aiSearchSession.groups)) {
          for (const g of aiSearchSession.groups) {
            try { 
              const tabsInGroup = await chrome.tabs.query({ groupId: g.groupId }); 
              const tabIds = tabsInGroup.map(t => t.id).filter(Boolean); 
              if (tabIds.length) await chrome.tabs.ungroup(tabIds); 
            } catch (e) {}
          }
        }
        // Clear any tab highlights
        await clearHighlightsSafely(aiSearchSession.tabIds);
      }
      
      // Remove only the search session, keep summaries for reuse
      await chrome.storage.session.remove(['aiSearchSession', 'scrollPosition']);
      savedScrollPosition = 0;
      console.debug('[Clear] Search session cleared, summaries preserved');
      
      // Reset UI only (keep AI sessions and summaries)
      resultsUl.innerHTML = '';
      closeAllSummariesBtn.style.display = 'none';
      endButton.style.display = 'none';
      input.value = '';
      input.focus();
      endButton.disabled = true;
      groupButton.disabled = true;
      groupButton.textContent = 'Group'; // Reset to default text
      groupButton.title = 'Group the current matches';
      setStatus('Search cleared. Summaries preserved for faster next search.', 'success');
      
      // Clear status after 2 seconds
      setTimeout(() => setStatus('', ''), 2000);
    } catch (err) { 
      console.error('[Clear] Error clearing search:', err); 
      setStatus(`Error clearing search: ${err.message}`, 'error'); 
    }
    finally { setBusy(false); }
  }

  function closeAllSummaries() {
    console.debug('[UI] Closing all summaries and reasons');
    const openSummaries = document.querySelectorAll('.summary-section[style*="display: block"]');
    const openReasons = document.querySelectorAll('.reason-section[style*="display: block"]');
    
    openSummaries.forEach(summary => {
      summary.style.display = 'none';
    });
    
    openReasons.forEach(reason => {
      reason.style.display = 'none';
    });
    
    updateCloseAllSummariesButton();
  }

  function updateCloseAllSummariesButton() {
    const openSummaries = document.querySelectorAll('.summary-section[style*="display: block"]');
    const openReasons = document.querySelectorAll('.reason-section[style*="display: block"]');
    const totalOpen = openSummaries.length + openReasons.length;
    
    if (totalOpen > 1) {
      closeAllSummariesBtn.style.display = 'block';
      closeAllSummariesBtn.textContent = `Close All (${totalOpen})`;
    } else {
      closeAllSummariesBtn.style.display = 'none';
    }
  }

  function updateClearSearchButton() {
    // Show button when there are search results or an active search session
    const hasResults = resultsUl.children.length > 0;
    const hasStatus = status.textContent.includes('tab') || status.textContent.includes('search');
    
    if (hasResults || hasStatus) {
      endButton.style.display = 'block';
    } else {
      endButton.style.display = 'none';
    }
  }

  async function updateGroupButton() {
    try {
      const { aiSearchSession } = await chrome.storage.session.get('aiSearchSession');
      if (aiSearchSession?.groups && aiSearchSession.groups.length > 0) {
        groupButton.textContent = 'Ungroup';
        groupButton.title = 'Ungroup the current matches';
      } else {
        groupButton.textContent = 'Group';
        groupButton.title = 'Group the current matches';
      }
    } catch (e) {
      console.debug('[UI] Error updating group button:', e);
    }
  }

  async function saveScrollPosition() {
    if (resultsUl.children.length > 0) {
      savedScrollPosition = resultsUl.scrollTop;
      // Also persist to storage for popup reopening
      await chrome.storage.session.set({ scrollPosition: savedScrollPosition });
      console.debug('[Scroll] Saved position:', savedScrollPosition);
    }
  }

  async function restoreScrollPosition() {
    try {
      // First try to use the in-memory position
      let scrollPos = savedScrollPosition;
      
      // If no in-memory position, try to get from storage
      if (scrollPos === 0) {
        const { scrollPosition } = await chrome.storage.session.get('scrollPosition');
        scrollPos = scrollPosition || 0;
      }
      
      if (scrollPos > 0 && resultsUl.children.length > 0) {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
          resultsUl.scrollTop = scrollPos;
          console.debug('[Scroll] Restored position:', scrollPos);
        }, 50);
      }
    } catch (e) {
      console.debug('[Scroll] Error restoring position:', e);
    }
  }

  function showMoreResults() {
    currentResultsPage++;
    
    // Get the stored session data to re-render
    chrome.storage.session.get('aiSearchSession').then(({ aiSearchSession }) => {
      if (aiSearchSession) {
        chrome.tabs.query({}).then(allTabs => {
          renderResultsPage(allTabs, aiSearchSession.tabIds, aiSearchSession.preserveOrder);
        });
      }
    });
  }

  function renderResultsList(allTabs, selectedIdSet, preserveOrder = false) {
    // Store all results for pagination
    allSearchResults = allTabs.filter(t => {
      const idSet = Array.isArray(selectedIdSet) ? new Set(selectedIdSet) : selectedIdSet;
      return idSet.has(t.id);
    });
    
    // Reset to first page
    currentResultsPage = 1;
    
    // Render first page
    renderResultsPage(allTabs, selectedIdSet, preserveOrder);
  }

  function renderResultsPage(allTabs, selectedIdSet, preserveOrder = false) {
    resultsUl.innerHTML = '';
    closeAllSummariesBtn.style.display = 'none'; // Hide button when rendering new results
    const collator = new Intl.Collator();
    
    // Handle both arrays and Sets
    const idSet = Array.isArray(selectedIdSet) ? new Set(selectedIdSet) : selectedIdSet;
    const selectedTabs = allTabs.filter(t => idSet.has(t.id));
    
    if (preserveOrder) {
      // For AI results, preserve the order returned by AI (likely relevance-based)
      const orderedIds = Array.isArray(selectedIdSet) ? selectedIdSet : Array.from(selectedIdSet);
      selectedTabs.sort((a, b) => {
        const indexA = orderedIds.indexOf(a.id);
        const indexB = orderedIds.indexOf(b.id);
        return indexA - indexB;
      });
    } else {
      // For fallback search or when order doesn't matter, sort alphabetically
      selectedTabs.sort((a, b) => collator.compare(a.title || '', b.title || ''));
    }
    
    // Paginate results
    const startIdx = 0;
    const endIdx = currentResultsPage * RESULTS_PER_PAGE;
    const tabsToShow = selectedTabs.slice(startIdx, endIdx);
    const hasMore = selectedTabs.length > endIdx;
    const totalPages = Math.ceil(selectedTabs.length / RESULTS_PER_PAGE);
    
    // Update Show More button visibility
    if (hasMore) {
      showMoreContainer.style.display = 'block';
    } else {
      showMoreContainer.style.display = 'none';
    }
    
    console.debug('[Render] Rendering', tabsToShow.length, 'of', selectedTabs.length, 'tabs', preserveOrder ? '(preserving AI order)' : '(alphabetical)');
    
    // Get result sources and summaries for badge and tag display
    Promise.all([
      chrome.storage.session.get('tabResultSources'),
      getExistingSummaries(tabsToShow)
    ]).then(([{ tabResultSources = {} }, summaries]) => {
      const fragments = [];
      
      for (const tab of tabsToShow) {
        const el = template.content.firstElementChild.cloneNode(true);
        el.querySelector('.title').textContent = tab.title || '(Untitled)';
        
        // Set URL in meta
        try { 
          const u = new URL(tab.url || ''); 
          el.querySelector('.meta').textContent = `${u.hostname}${u.pathname}`; 
        } catch { 
          el.querySelector('.meta').textContent = tab.url || ''; 
        }
        
        // Build tags display: result source + tab tags
        const badge = el.querySelector('.result-badge');
        const resultSource = tabResultSources[tab.id];
        const tabSummary = summaries.find(s => s.id === tab.id);
        const tabTags = tabSummary?.tags || [];
        
        // Build tag HTML
        let tagsHtml = '';
        
        // Add result source tag first
        if (resultSource === 'ai') {
          tagsHtml += '<span class="tag-badge ai">#AI</span>';
        } else if (resultSource === 'keyword') {
          tagsHtml += '<span class="tag-badge keyword">#Keyword</span>';
        }
        
        // Add tab tags (show only first 3)
        const tagsToShow = tabTags.slice(0, 3);
        tagsToShow.forEach(tag => {
          tagsHtml += `<span class="tag-badge tab-tag">#${tag}</span>`;
        });
        
        if (tagsHtml) {
          badge.innerHTML = tagsHtml;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
        
        // Tab click to navigate
        el.querySelector('a').addEventListener('click', async () => { 
        console.debug('[Render] Click focus tabId:', tab.id, 'windowId:', tab.windowId); 
        
        // Save scroll position before navigating
        await saveScrollPosition();
        
        try {
          // Only switch to the tab, don't focus the window to prevent popup from closing
          await chrome.tabs.update(tab.id, { active: true }); 
          console.debug('[Render] Successfully switched to tab:', tab.id);
        } catch (e) {
          console.error('[Render] Failed to switch to tab:', e);
        }
      });
      
      // Three-dot menu functionality
      const menuButton = el.querySelector('.tab-menu');
      const dropdown = el.querySelector('.dropdown-menu');
      const viewReasonButton = el.querySelector('.view-reason');
      const viewSummaryButton = el.querySelector('.view-summary');
      const closeButton = el.querySelector('.dropdown-item.danger');
      const reasonSection = el.querySelector('.reason-section');
      const reasonContent = el.querySelector('.reason-content');
      const closeReasonButton = el.querySelector('.close-reason');
      const summarySection = el.querySelector('.summary-section');
      const summaryContent = el.querySelector('.summary-content');
      const closeSummaryButton = el.querySelector('.close-summary');
      
      // Toggle dropdown on menu button click
      menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close all other dropdowns first
        document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
          if (menu !== dropdown) menu.classList.remove('show');
        });
        
        dropdown.classList.toggle('show');
      });
      
      // View reason functionality
      viewReasonButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
        
        // Check if reason is already visible
        if (reasonSection.style.display !== 'none') {
          reasonSection.style.display = 'none';
          updateCloseAllSummariesButton();
          return;
        }
        
        // Show reason section and load content
        reasonSection.style.display = 'block';
        updateCloseAllSummariesButton();
        reasonContent.textContent = 'Loading reason...';
        reasonContent.className = 'reason-content loading';
        
        try {
          // Get the reason and score from session storage
          const { tabSelectionReasons = {}, tabSelectionScores = {} } = await chrome.storage.session.get(['tabSelectionReasons', 'tabSelectionScores']);
          const reason = tabSelectionReasons[tab.id];
          const score = tabSelectionScores[tab.id];
          
          if (reason) {
            // Format with score if available
            const scoreText = score ? `Relevance Score: ${score}/10\n\n` : '';
            reasonContent.textContent = `${scoreText}${reason}`;
            reasonContent.className = 'reason-content';
          } else {
            reasonContent.textContent = 'No reason available. This tab may have been selected through fallback search.';
            reasonContent.className = 'reason-content';
          }
        } catch (err) {
          console.error('[Reason] Error loading reason:', err);
          reasonContent.textContent = 'Error loading reason.';
          reasonContent.className = 'reason-content error';
        }
      });
      
      // Close reason button
      closeReasonButton.addEventListener('click', (e) => {
        e.stopPropagation();
        reasonSection.style.display = 'none';
        updateCloseAllSummariesButton();
      });
      
      // View summary functionality
      viewSummaryButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
        
        // Check if summary is already visible
        if (summarySection.style.display !== 'none') {
          summarySection.style.display = 'none';
          updateCloseAllSummariesButton();
          return;
        }
        
        // Show summary section and load content
        summarySection.style.display = 'block';
        updateCloseAllSummariesButton();
        summaryContent.textContent = 'Loading summary...';
        summaryContent.className = 'summary-content loading';
        
        try {
          // Get the summary from existing summaries
          const summaries = await getExistingSummaries([tab]);
          const tabSummary = summaries.find(s => s.id === tab.id);
          
          if (tabSummary?.summary) {
            summaryContent.textContent = tabSummary.summary;
            summaryContent.className = 'summary-content';
          } else {
            summaryContent.textContent = 'No summary available for this tab.';
            summaryContent.className = 'summary-content error';
          }
        } catch (err) {
          console.error('[Summary] Error loading summary:', err);
          summaryContent.textContent = 'Error loading summary.';
          summaryContent.className = 'summary-content error';
        }
      });
      
      // Close summary functionality
      closeSummaryButton.addEventListener('click', (e) => {
        e.stopPropagation();
        summarySection.style.display = 'none';
        updateCloseAllSummariesButton();
      });
      
      // Close tab functionality
      closeButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          console.debug('[Menu] Closing tab:', tab.id);
          await chrome.tabs.remove(tab.id);
          
          // Remove the tab from UI immediately
          el.remove();
          
          // Update the session to remove this tab ID
          const { aiSearchSession } = await chrome.storage.session.get('aiSearchSession');
          if (aiSearchSession?.tabIds) {
            const updatedTabIds = aiSearchSession.tabIds.filter(id => id !== tab.id);
            const updatedSession = { ...aiSearchSession, tabIds: updatedTabIds };
            await chrome.storage.session.set({ aiSearchSession: updatedSession });
            
            // Update status
            const remaining = updatedTabIds.length;
            if (remaining === 0) {
              setStatus('All tabs closed. Search ended.', 'success');
              endButton.disabled = true;
              groupButton.disabled = true;
              await clearHighlightsSafely();
            } else {
              setStatus(`Tab closed. ${remaining} ${pluralize('tab', remaining)} remaining.`, 'success');
            }
          }
        } catch (err) {
          console.error('[Menu] Error closing tab:', err);
          setStatus(`Error closing tab: ${err.message}`, 'error');
        }
        
        dropdown.classList.remove('show');
      });
      
        fragments.push(el);
      }
      
      resultsUl.append(...fragments);
      
      // Add scroll listener to save position as user scrolls
      resultsUl.addEventListener('scroll', async () => {
        if (resultsUl.children.length > 0) {
          savedScrollPosition = resultsUl.scrollTop;
          // Debounced save to storage
          clearTimeout(resultsUl.scrollSaveTimeout);
          resultsUl.scrollSaveTimeout = setTimeout(async () => {
            await chrome.storage.session.set({ scrollPosition: savedScrollPosition });
          }, 500);
        }
      });
      
      // Close dropdowns when clicking outside
      document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
          menu.classList.remove('show');
        });
      });
    });
  }

  async function groupResultsByWindow(tabIds, query) {
    const tabs = await chrome.tabs.query({});
    const tabById = new Map(tabs.map(t => [t.id, t]));
    const perWindow = new Map();
    for (const id of tabIds) { const t = tabById.get(id); if (!t) continue; if (!perWindow.has(t.windowId)) perWindow.set(t.windowId, []); perWindow.get(t.windowId).push(id); }
    const groups = [];
    const groupTitle = `AI: ${truncate(query, 18)}`;
    for (const [windowId, ids] of perWindow.entries()) { if (!ids.length) continue; const groupId = await chrome.tabs.group({ tabIds: ids }); await chrome.tabGroups.update(groupId, { title: groupTitle, color: 'yellow' }); groups.push({ windowId, groupId }); }
    return groups;
  }

  // --- On-device AI helpers with better memoization ---
  async function getOnDeviceSession(key, systemPrompt) {
    // Use only the key for caching, not the full systemPrompt
    // This allows reusing sessions across different prompts
    const cacheKey = key;
    
    if (sessionCache.has(cacheKey)) {
      console.debug('[AI] Using cached session for:', key);
      return sessionCache.get(cacheKey);
    }
    
    if (sessionCreatePromises.has(cacheKey)) {
      console.debug('[AI] Waiting for session creation for:', key);
      return sessionCreatePromises.get(cacheKey);
    }
    
    console.debug('[AI] Creating new session for:', key);
    const p = (async () => { 
      const sess = await createOnDeviceSession(systemPrompt); 
      if (sess) {
        sessionCache.set(cacheKey, sess);
        console.debug('[AI] Session cached for:', key);
      }
      sessionCreatePromises.delete(cacheKey); 
      return sess; 
    })();
    
    sessionCreatePromises.set(cacheKey, p);
    return p;
  }

  async function createOnDeviceSession(systemPrompt) {
    try {
      if (typeof self.LanguageModel !== 'undefined' && typeof self.LanguageModel.create === 'function') {
        const availabilityOptions = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
        let availability = 'unavailable';
        try { availability = await self.LanguageModel.availability?.(availabilityOptions); console.debug('[AI] LanguageModel availability:', availability); }
        catch (e) { console.warn('[AI] availability() failed', e); }
        if (availability === 'unavailable') { 
          console.debug('[AI] LanguageModel unavailable for current options'); 
          aiAvailable = false;
          return null; 
        }
        const controller = new AbortController();
        const session = await self.LanguageModel.create({ 
          ...availabilityOptions, 
          signal: controller.signal, 
          systemPrompt: systemPrompt,
          temperature: 0.0,  // Lower = more deterministic, less creative (range: 0.0-1.0)
          topK: 1,           // Only consider the top 1 token = most predictable output
          monitor(m) { 
            m.addEventListener('downloadprogress', (e) => { 
              const pct = Math.round((e.loaded || 0) * 100); 
              console.debug('[AI] Download progress: ' + pct + '%'); 
              setStatus(`Downloading on-device model… ${pct}%`, ''); 
            }); 
          } 
        });
        console.debug('[AI] LanguageModel session created'); setStatus('', '');
        aiAvailable = true;
        return { type: 'LanguageModel', session };
      }
      console.debug('[AI] No on-device API detected'); 
      aiAvailable = false;
      return null;
    } catch (e) { 
      console.warn('[AI] Failed to create on-device session', e); 
      aiAvailable = false;
      return null; 
    }
  }

  function clearSessionCache() {
    console.debug('[AI] Clearing session cache');
    // Destroy all cached sessions
    for (const [key, sessionObj] of sessionCache.entries()) {
      try {
        if (sessionObj.type === 'LanguageModel' && sessionObj.session.destroy) {
          sessionObj.session.destroy();
        }
      } catch (e) {
        console.debug('[AI] Session cleanup error:', e);
      }
    }
    sessionCache.clear();
    sessionCreatePromises.clear();
  }

  async function applyOnDevicePrompt(sessionObj, promptText, responseSchema, signal) {
    if (!sessionObj) return null;
    try {
      const { type, session } = sessionObj;
      if (type === 'LanguageModel') {
        console.debug('[AI] Sending prompt, length:', promptText.length, 'has schema:', !!responseSchema);
        
        // Check if aborted before making the call
        if (signal?.aborted) {
          console.debug('[AI] Prompt aborted before execution');
          return null;
        }
        
        const raw = await session.prompt(promptText, responseSchema ? { responseConstraint: responseSchema, omitResponseConstraintInput: true } : undefined);
        console.debug('[AI] LanguageModel raw:', raw);
        return raw;
      }
      return null;
    } catch (e) { 
      // Check if it's an abort error
      if (signal?.aborted || e.name === 'AbortError') {
        console.debug('[AI] Prompt was aborted');
        return null;
      }
      
      console.error('[AI] Prompt failed:', {
        error: e,
        errorName: e.name,
        errorMessage: e.message,
        promptLength: promptText?.length,
        hasSchema: !!responseSchema,
        sessionType: sessionObj?.type
      }); 
      setAIStatus('unavailable');
      return null; 
    }
  }

  async function applyHighlights(tabIds) {
    const tabs = await chrome.tabs.query({});
    const activeByWindow = new Map(); for (const t of tabs) { if (t.active) activeByWindow.set(t.windowId, t.id); }
    const perWindow = new Map(); for (const t of tabs) { if (tabIds.includes(t.id)) { if (!perWindow.has(t.windowId)) perWindow.set(t.windowId, []); perWindow.get(t.windowId).push(t.index); } }
    for (const [windowId, indices] of perWindow.entries()) {
      try { if (indices.length) { indices.sort((a, b) => a - b); console.debug('[Highlight] windowId:', windowId, 'indices:', indices); await chrome.tabs.highlight({ windowId, tabs: indices }); const activeTabId = activeByWindow.get(windowId); if (activeTabId !== undefined) { try { await chrome.tabs.update(activeTabId, { active: true }); } catch (e) {} } } }
      catch (e) { console.warn('[Highlight] Failed for window', windowId, e); }
    }
  }

  async function clearHighlightsSafely(existingTabIds) {
    try {
      const tabs = await chrome.tabs.query({});
      const affectedWindowIds = new Set();
      if (Array.isArray(existingTabIds) && existingTabIds.length) { const set = new Set(existingTabIds); for (const t of tabs) if (set.has(t.id)) affectedWindowIds.add(t.windowId); }
      else { for (const t of tabs) affectedWindowIds.add(t.windowId); }
      for (const windowId of affectedWindowIds) {
        try { const winTabs = tabs.filter(t => t.windowId === windowId); const activeIndex = winTabs.find(t => t.active)?.index ?? 0; await chrome.tabs.highlight({ windowId, tabs: [activeIndex] }); } catch (e) {}
      }
    } catch (e) {}
  }

  async function buildSessionRecord(tabIds, query, groups, preserveOrder = true) { 
    return { 
      createdAt: Date.now(), 
      query, 
      tabIds, 
      groups: groups || [],
      preserveOrder 
    }; 
  }

  async function logSearchHistory(query, tabIds) {
    try {
      const { searchHistoryByDate = {} } = await chrome.storage.local.get('searchHistoryByDate');
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      const entry = { query, tabIds, at: Date.now() };
      const arr = Array.isArray(searchHistoryByDate[key]) ? searchHistoryByDate[key] : [];
      
      // Remove any existing entry with the same query to avoid duplicates
      const filteredArr = arr.filter(item => item.query !== query);
      
      // Add the new/updated entry at the beginning (most recent)
      filteredArr.unshift(entry);
      
      // Keep only last 5 searches
      if (filteredArr.length > 5) filteredArr.length = 5;
      
      searchHistoryByDate[key] = filteredArr;
      await chrome.storage.local.set({ searchHistoryByDate });
      console.debug('[History] Logged search under', key, entry);
    } catch (e) {
      console.warn('[History] Failed to log search', e);
    }
  }

  function safeJsonParse(text) { 
    try { 
      // First try to parse as-is
      return JSON.parse(text); 
    } catch (e) { 
      try {
        // Try to extract JSON from markdown code blocks
        let jsonText = text;
        const codeBlockMatch = text.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1];
        } else {
          // Try to find JSON object without code blocks
          const jsonMatch = text.match(/({[\s\S]*?})/);
          if (jsonMatch) {
            jsonText = jsonMatch[1];
          }
        }
        
        // Try to repair truncated JSON
        if (!jsonText.endsWith('}')) {
          console.warn('[JSON] Response appears truncated, attempting repair');
          // Count unclosed brackets and quotes
          const openBraces = (jsonText.match(/{/g) || []).length;
          const closeBraces = (jsonText.match(/}/g) || []).length;
          const openBrackets = (jsonText.match(/\[/g) || []).length;
          const closeBrackets = (jsonText.match(/\]/g) || []).length;
          
          // Add missing closing characters
          for (let i = 0; i < openBrackets - closeBrackets; i++) {
            jsonText += ']';
          }
          for (let i = 0; i < openBraces - closeBraces; i++) {
            jsonText += '}';
          }
          
          // Remove trailing incomplete entries
          jsonText = jsonText.replace(/,\s*$/, '');
          jsonText = jsonText.replace(/,\s*[\]}]+$/, (match) => match.substring(1));
        }
        
        // Clean up common JSON formatting issues
        jsonText = jsonText
          // Fix unescaped quotes in string values
          .replace(/"([^"]*)"([^"]*)"([^"]*)":/g, (match, p1, p2, p3) => {
            // This is a property name, don't modify
            return match;
          })
          .replace(/: "([^"]*)"([^"]*)"([^"]*)",/g, (match, p1, p2, p3) => {
            // This is a string value with unescaped quotes
            return `: "${p1}\\"${p2}\\"${p3}",`;
          })
          .replace(/: "([^"]*)"([^"]*)"([^"]*)"$/gm, (match, p1, p2, p3) => {
            // This is a string value at end of line with unescaped quotes
            return `: "${p1}\\"${p2}\\"${p3}"`;
          })
          // Fix trailing commas
          .replace(/,(\s*[}\]])/g, '$1')
          // Fix extra spaces
          .trim();
        
        return JSON.parse(jsonText);
        
      } catch (e2) {
        console.warn('[JSON] fallback parse also failed', e2, 'text:', text); 
        return null;
      }
    } 
  }
  function setStatus(msg, cls) { status.textContent = msg; status.className = cls || ''; }
  function truncate(s, n) { if (!s) return ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  
  function getFriendlyTabName(tab) {
    try {
      const title = (tab.title || '').trim();
      const url = tab.url || '';
      
      if (title && title !== 'New Tab' && title !== 'Untitled') {
        return truncate(title, 30);
      }
      
      // Extract domain and path from URL
      const u = new URL(url);
      const domain = u.hostname.replace('www.', '');
      const path = u.pathname === '/' ? '' : u.pathname.split('/').filter(Boolean)[0];
      
      if (path) {
        return `${domain}/${path}`;
      }
      return domain || 'Unknown page';
    } catch {
      return 'Unknown page';
    }
  }
});

