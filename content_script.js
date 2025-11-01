// This runs in the context of each web page

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractPageText') {
    try {
      // Extract visible text content from the page
      const pageText = extractPageText();
      
      sendResponse({
        success: true,
        text: pageText,
        tabId: request.tabId
      });
    } catch (error) {
      console.error('[Content Script] Error extracting text:', error);
      sendResponse({
        success: false,
        error: error.message,
        tabId: request.tabId
      });
    }
  }
  
  // Return true to indicate we'll send response asynchronously
  return true;
});

function extractPageText() {
  // Get the main content text, excluding scripts, styles, and hidden elements
  const body = document.body;
  if (!body) return '';
  
  // Clone the body to avoid modifying the actual page
  const clone = body.cloneNode(true);
  
  // Remove script, style, noscript, and other non-content elements
  const elementsToRemove = clone.querySelectorAll(
    'script, style, noscript, iframe, svg, canvas, input, textarea, select, button'
  );
  elementsToRemove.forEach(el => el.remove());
  
  // Get text content
  let text = clone.innerText || clone.textContent || '';
  
  // Clean up the text
  text = text
    .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with single space
    .replace(/\n+/g, ' ') // Replace newlines with space
    .trim();
  
  // Limit text length to prevent memory issues (max 50,000 characters)
  if (text.length > 50000) {
    text = text.substring(0, 50000);
  }
  
  return text;
}

// Optional: Send a ready message when the content script loads
console.log('[Content Script] AI Tab Navigator content script loaded');
