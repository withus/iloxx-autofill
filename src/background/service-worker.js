/**
 * iloxx Autofill Service Worker
 *
 * Responsibilities:
 * 1. Badge management: Shows "!" on extension icon when a pending order awaits tracking
 * 2. Storage change listener: Updates badge when pendingOrder changes
 * 3. Message routing: Receives orderBookIdDetected from content script, stores in pendingOrder
 */

// --- Badge Management ---

/**
 * Update the extension badge based on pendingOrder state
 */
function updateBadge() {
  chrome.storage.local.get(['pendingOrder'], (result) => {
    const pending = result.pendingOrder;

    if (pending && pending.status === 'awaiting_tracking') {
      // Check 24h expiry
      const age = Date.now() - pending.formFilledAt;
      if (age > 24 * 60 * 60 * 1000) {
        // Expired - clean up
        chrome.storage.local.remove('pendingOrder');
        chrome.action.setBadgeText({ text: '' });
        return;
      }

      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#e67e22' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  });
}

// Listen for storage changes to update badge reactively
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.pendingOrder) {
    updateBadge();
  }
});

// Set initial badge state on service worker startup
updateBadge();


// --- Message Routing ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'orderBookIdDetected' && message.orderBookId) {
    // Store the orderBookId in the pendingOrder
    chrome.storage.local.get(['pendingOrder'], (result) => {
      const pending = result.pendingOrder;
      if (pending) {
        pending.orderBookId = message.orderBookId;
        chrome.storage.local.set({ pendingOrder: pending }, () => {
          console.log('[iloxx-autofill] OrderbookID stored:', message.orderBookId);
          sendResponse({ success: true });
        });
      } else {
        console.log('[iloxx-autofill] No pendingOrder to attach OrderbookID to');
        sendResponse({ success: false, reason: 'no_pending_order' });
      }
    });
    return true; // async response
  }
});

console.log('[iloxx-autofill] Service worker loaded.');
