// This runs in the context of each web page

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractPageText') {
    try {
      const pageText = extractPageText();
      
      sendResponse({
        success: true,
        text: pageText,
        tabId: request.tabId
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message,
        tabId: request.tabId
      });
    }
  }
  
  return true;
});

function extractPageText() {
  const body = document.body;
  if (!body) return '';
  
  const clone = body.cloneNode(true);
  
  const elementsToRemove = clone.querySelectorAll(
    'script, style, noscript, iframe, svg, canvas, input, textarea, select, button'
  );
  elementsToRemove.forEach(el => el.remove());
  
  let text = clone.innerText || clone.textContent || '';
  
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
  
  // Limit to 50,000 characters
  if (text.length > 50000) {
    text = text.substring(0, 50000);
  }
  
  return text;
}
