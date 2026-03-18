document.addEventListener('DOMContentLoaded', () => {
  const orderIdInput = document.getElementById('orderId');
  const fetchBtn = document.getElementById('fetchBtn');
  const statusEl = document.getElementById('status');
  const previewEl = document.getElementById('preview');
  const previewTable = document.getElementById('previewTable');
  const fillBtn = document.getElementById('fillBtn');
  const historyEl = document.getElementById('history');
  const historyList = document.getElementById('historyList');
  const settingsLink = document.getElementById('settingsLink');
  const setupHint = document.getElementById('setupHint');
  const setupLink = document.getElementById('setupLink');
  const mainContent = document.getElementById('mainContent');

  // Tracking elements
  const trackingSection = document.getElementById('trackingSection');
  const trackingNumberInput = document.getElementById('trackingNumber');
  const autoDetectBtn = document.getElementById('autoDetectBtn');
  const sendTrackingBtn = document.getElementById('sendTrackingBtn');
  const trackingStatusEl = document.getElementById('trackingStatus');

  let currentOrderData = null;
  let formFilled = false;

  // --- Pending Order State Persistence ---

  function savePendingOrder(data) {
    const pending = {
      order_id: data.order_id,
      data: data,
      formFilledAt: Date.now(),
      status: 'awaiting_tracking',
    };
    chrome.storage.local.set({ pendingOrder: pending });
  }

  function loadPendingOrder() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['pendingOrder'], (result) => {
        const pending = result.pendingOrder;
        if (!pending) return resolve(null);

        // 24h expiry check
        const age = Date.now() - pending.formFilledAt;
        if (age > 24 * 60 * 60 * 1000) {
          chrome.storage.local.remove('pendingOrder');
          return resolve(null);
        }

        if (pending.status !== 'awaiting_tracking') {
          return resolve(null);
        }

        resolve(pending);
      });
    });
  }

  function clearPendingOrder() {
    chrome.storage.local.remove('pendingOrder');
  }

  // Settings link
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  setupLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Check if settings are configured
  chrome.storage.local.get(['apiUrl', 'apiKey'], async (data) => {
    if (!data.apiUrl || !data.apiKey) {
      setupHint.classList.remove('hidden');
      mainContent.classList.add('hidden');
    } else {
      loadHistory();

      // Restore pending order state if popup was closed and reopened
      const pending = await loadPendingOrder();
      if (pending) {
        currentOrderData = pending.data;
        formFilled = true;
        orderIdInput.value = pending.order_id;
        showPreview(pending.data);

        // Show pending banner
        const pendingBanner = document.getElementById('pendingBanner');
        if (pendingBanner) pendingBanner.classList.remove('hidden');

        // Show tracking section directly
        showTrackingSection();
        showStatus('Formular bereits ausgefuellt - bitte Track-ID eingeben.', 'info');
      }
    }
  });

  // Fetch order data
  fetchBtn.addEventListener('click', () => fetchOrder());

  orderIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchOrder();
  });

  async function fetchOrder() {
    const orderId = orderIdInput.value.trim();
    if (!orderId || !/^\d+$/.test(orderId)) {
      showStatus('Bitte gueltige Bestellnummer eingeben.', 'error');
      return;
    }

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Lade...';
    previewEl.classList.add('hidden');
    trackingSection.classList.add('hidden');
    formFilled = false;
    showStatus('Bestelldaten werden geladen...', 'info');

    try {
      const { apiUrl, apiKey } = await getSettings();
      const response = await fetch(`${apiUrl}/api_shipping/order/${orderId}`, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        showStatus(`API-Fehler: Server liefert kein JSON (Status ${response.status}). API-URL pruefen.`, 'error');
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        showStatus(`Fehler: ${data.error || 'Unbekannter Fehler'}`, 'error');
        return;
      }

      currentOrderData = data;
      showPreview(data);
      addToHistory(data);
      hideStatus();
    } catch (err) {
      showStatus(`Verbindungsfehler: ${err.message}`, 'error');
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Laden';
    }
  }

  function showPreview(data) {
    const rows = [
      ['Bestellung', `#${data.order_id}`],
      ['Name', `${data.vorname} ${data.nachname}`.trim()],
      ['Firma', data.firma],
      ['Strasse', `${data.strasse} ${data.hausnummer}`.trim()],
      ['PLZ / Ort', `${data.plz} ${data.stadt}`.trim()],
      ['Land', data.land],
      ['Telefon', data.telefon],
      ['E-Mail', data.email],
      ['Status', data.status],
    ];

    previewTable.innerHTML = rows
      .filter(([, val]) => val)
      .map(([label, val]) => `<tr><td>${label}</td><td>${escapeHtml(val)}</td></tr>`)
      .join('');

    previewEl.classList.remove('hidden');
  }

  // Fill iloxx form
  fillBtn.addEventListener('click', async () => {
    if (!currentOrderData) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('iloxx.de')) {
      showStatus('Bitte zuerst eine iloxx.de-Seite oeffnen.', 'error');
      return;
    }

    try {
      showStatus('Formular wird ausgefuellt...', 'info');
      await chrome.tabs.sendMessage(tab.id, {
        action: 'fillForm',
        data: currentOrderData,
      });
      showStatus('Formular erfolgreich ausgefuellt.', 'success');
      formFilled = true;

      // Persist state so it survives popup close/reopen
      savePendingOrder(currentOrderData);

      // Update history entry with form_filled flag
      updateHistoryFormFilled(currentOrderData.order_id);

      // Show tracking section after successful form fill
      showTrackingSection();
    } catch (err) {
      showStatus('Content Script nicht geladen. Bitte iloxx-Seite neu laden.', 'error');
    }
  });

  // --- Tracking Section ---

  function showTrackingSection() {
    trackingSection.classList.remove('hidden');
    trackingNumberInput.value = '';
    sendTrackingBtn.disabled = true;
    hideTrackingStatus();

    // Show warning if order is already shipped
    if (currentOrderData && currentOrderData.status === 'shipped') {
      showTrackingStatus('Diese Bestellung ist bereits als "shipped" markiert.', 'warning');
    }
  }

  // Enable/disable send button based on input
  trackingNumberInput.addEventListener('input', () => {
    const val = trackingNumberInput.value.trim();
    sendTrackingBtn.disabled = val.length === 0;
  });

  trackingNumberInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !sendTrackingBtn.disabled) {
      sendTracking();
    }
  });

  // Send tracking number to shop
  sendTrackingBtn.addEventListener('click', () => sendTracking());

  async function sendTracking() {
    if (!currentOrderData) return;

    const trackingNumber = trackingNumberInput.value.trim();
    if (!trackingNumber) {
      showTrackingStatus('Bitte Track-ID eingeben.', 'error');
      return;
    }

    sendTrackingBtn.disabled = true;
    sendTrackingBtn.textContent = 'Sende...';
    showTrackingStatus('Tracking-Daten werden uebermittelt...', 'info');

    try {
      const { apiUrl, apiKey } = await getSettings();
      const response = await fetch(`${apiUrl}/api_shipping/shipped/${currentOrderData.order_id}`, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tracking_number: trackingNumber,
          shipping_provider: 'GLS',
        }),
      });

      const respContentType = response.headers.get('content-type') || '';
      if (!respContentType.includes('application/json')) {
        showTrackingStatus(`API-Fehler: Server liefert kein JSON (Status ${response.status}). API-URL pruefen.`, 'error');
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        showTrackingStatus(`Fehler: ${data.error || 'Unbekannter Fehler'}`, 'error');
        return;
      }

      showTrackingStatus('Tracking-Nummer an den Shop uebermittelt. Status: shipped.', 'success');
      sendTrackingBtn.textContent = 'Gesendet';

      // Update history entry with tracking number
      updateHistoryWithTracking(currentOrderData.order_id, trackingNumber);

      // Clear pending order - tracking was sent successfully
      clearPendingOrder();

      // Hide pending banner if visible
      const pendingBanner = document.getElementById('pendingBanner');
      if (pendingBanner) pendingBanner.classList.add('hidden');

      // Update local order status
      currentOrderData.status = 'shipped';
    } catch (err) {
      showTrackingStatus(`Verbindungsfehler: ${err.message}`, 'error');
    } finally {
      if (sendTrackingBtn.textContent === 'Sende...') {
        sendTrackingBtn.textContent = 'An Shop senden';
        sendTrackingBtn.disabled = false;
      }
    }
  }

  // Auto-detect tracking number from the active tab (any page, not just iloxx.de)
  autoDetectBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showTrackingStatus('Kein aktiver Tab gefunden.', 'error');
      return;
    }

    autoDetectBtn.disabled = true;
    showTrackingStatus('Suche Track-ID auf der Seite...', 'info');

    // Check if this is a restricted page (chrome://, chrome-extension://, etc.)
    const url = tab.url || '';
    const isRestricted = url.startsWith('chrome') || url.startsWith('about:') || url === '';

    if (isRestricted) {
      showTrackingStatus('Diese Seite kann nicht gelesen werden (Browser-Seite oder PDF-Extension). Bitte Track-ID manuell eingeben.', 'warning');
      autoDetectBtn.disabled = false;
      return;
    }

    // Strategy 1: Try content script message (works on iloxx.de tabs)
    if (url.includes('iloxx.de')) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'detectTracking',
        });
        if (response && response.trackingNumber) {
          trackingNumberInput.value = response.trackingNumber;
          sendTrackingBtn.disabled = false;
          showTrackingStatus(`Track-ID gefunden: ${escapeHtml(response.trackingNumber)}`, 'success');
          autoDetectBtn.disabled = false;
          return;
        }
      } catch (err) {
        // Content script not reachable, fall through to scripting API
      }
    }

    // Strategy 2: Inject detection script into any accessible tab
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const bodyText = document.body ? document.body.innerText : '';
          if (!bodyText) return null;

          // GLS has TWO formats:
          // - Paketnummer: 11-14 digit numeric (e.g. "1234567890123") - preferred for tracking URL
          // - Track-ID: 8-char alphanumeric (e.g. "AB12CD34") - fallback
          const patterns = [
            // Numeric Paketnummer (preferred - used in customer email tracking link)
            /Sendungsnummer[:\s]*(\d{11,14})/i,
            /Paketnummer[:\s]*(\d{11,14})/i,
            /Tracking[- ]?(?:Nr|Number|Nummer)[.:\s]*(\d{11,14})/i,
            /GLS[:\s]*(\d{11,14})/i,
            // Alphanumeric Track-ID (fallback)
            /(?:Ihre\s+)?GLS\s+Track-?ID[:\s.]*([A-Z0-9]{8})\b/i,
            /Track-?ID[:\s.]*([A-Z0-9]{8})\b/i,
          ];

          for (const pattern of patterns) {
            const match = bodyText.match(pattern);
            if (match && match[1]) return match[1];
          }

          // Multiline: keyword on one line, value within ±2 lines
          const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            if (/track.?id|sendungsnummer|paketnummer|ihre\s+gls/i.test(lines[i])) {
              for (let j = Math.max(0, i - 2); j <= Math.min(i + 2, lines.length - 1); j++) {
                // Alphanumeric Track-ID (must contain both letters and digits)
                const alphaMatch = lines[j].match(/\b([A-Z0-9]{8})\b/i);
                if (alphaMatch && /[A-Z]/i.test(alphaMatch[1]) && /\d/.test(alphaMatch[1])) {
                  return alphaMatch[1];
                }
                // Numeric Paketnummer
                const numMatch = lines[j].match(/\b(\d{11,14})\b/);
                if (numMatch) return numMatch[1];
              }
            }
          }

          return null;
        },
      });

      const trackingNumber = results && results[0] && results[0].result;
      if (trackingNumber) {
        trackingNumberInput.value = trackingNumber;
        sendTrackingBtn.disabled = false;
        showTrackingStatus(`Track-ID gefunden: ${escapeHtml(trackingNumber)}`, 'success');
      } else {
        showTrackingStatus('Keine Track-ID auf der Seite gefunden. Bitte manuell eingeben.', 'warning');
      }
    } catch (err) {
      showTrackingStatus('Seite nicht lesbar (evtl. PDF-Viewer). Bitte Track-ID manuell eingeben.', 'warning');
    } finally {
      autoDetectBtn.disabled = false;
    }
  });

  // Listen for tracking numbers pushed from content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'trackingDetected' && message.trackingNumber) {
      trackingNumberInput.value = message.trackingNumber;
      sendTrackingBtn.disabled = false;
      showTrackingStatus(`Track-ID erkannt: ${escapeHtml(message.trackingNumber)}`, 'success');
    }
  });

  function showTrackingStatus(message, type) {
    trackingStatusEl.textContent = message;
    trackingStatusEl.className = `status ${type}`;
  }

  function hideTrackingStatus() {
    trackingStatusEl.className = 'status hidden';
  }

  // --- History management ---

  function addToHistory(data) {
    chrome.storage.local.get(['orderHistory'], (result) => {
      let history = result.orderHistory || [];

      // Remove existing entry for same order
      history = history.filter((h) => h.order_id !== data.order_id);

      // Add to front
      history.unshift({
        order_id: data.order_id,
        name: `${data.vorname} ${data.nachname}`.trim(),
        tracking_number: null,
        form_filled: false,
        timestamp: Date.now(),
      });

      // Keep max 20 entries
      history = history.slice(0, 20);

      chrome.storage.local.set({ orderHistory: history }, () => {
        loadHistory();
      });
    });
  }

  function updateHistoryWithTracking(orderId, trackingNumber) {
    chrome.storage.local.get(['orderHistory'], (result) => {
      let history = result.orderHistory || [];
      const entry = history.find((h) => h.order_id === orderId);
      if (entry) {
        entry.tracking_number = trackingNumber;
        entry.shipping_provider = 'GLS';
        entry.tracking_sent_at = Date.now();
        chrome.storage.local.set({ orderHistory: history }, () => {
          loadHistory();
        });
      }
    });
  }

  function updateHistoryFormFilled(orderId) {
    chrome.storage.local.get(['orderHistory'], (result) => {
      let history = result.orderHistory || [];
      const entry = history.find((h) => h.order_id === orderId);
      if (entry) {
        entry.form_filled = true;
        chrome.storage.local.set({ orderHistory: history }, () => {
          loadHistory();
        });
      }
    });
  }

  function loadHistory() {
    chrome.storage.local.get(['orderHistory'], (result) => {
      const history = result.orderHistory || [];
      if (history.length === 0) {
        historyEl.classList.add('hidden');
        return;
      }

      historyList.innerHTML = history
        .slice(0, 10)
        .map((h) => {
          const orderId = escapeHtml(h.order_id);
          if (h.tracking_number) {
            // Completed: show provider + tracking number + resend button
            const provider = escapeHtml(h.shipping_provider || 'GLS');
            const trackId = escapeHtml(h.tracking_number);
            return `<li data-id="${orderId}">
              <div class="history-main">#${orderId} <span class="name">${escapeHtml(h.name)}</span></div>
              <div class="history-detail">
                <span class="tracking-sent">&#10003; ${provider}: ${trackId}</span>
                <button class="btn-resend-tracking" data-id="${orderId}" data-tracking="${trackId}" title="Track-ID korrigieren oder erneut senden">Erneut</button>
              </div>
            </li>`;
          } else if (h.form_filled) {
            // Form filled but no tracking yet
            return `<li data-id="${orderId}">
              <div class="history-main">#${orderId} <span class="name">${escapeHtml(h.name)}</span></div>
              <div class="history-detail pending">
                <span>&#9203; Formular ausgefuellt</span>
                <button class="btn-add-tracking" data-id="${orderId}" title="Tracking-Nummer nachtragen">Track-ID</button>
              </div>
            </li>`;
          } else {
            // Not yet processed
            return `<li data-id="${orderId}">
              <div class="history-main">#${orderId} <span class="name">${escapeHtml(h.name)}</span></div>
            </li>`;
          }
        })
        .join('');

      historyEl.classList.remove('hidden');

      // Click handler for history items (order re-fetch)
      historyList.querySelectorAll('li').forEach((li) => {
        li.addEventListener('click', (e) => {
          // Don't trigger fetch when clicking action buttons
          if (e.target.classList.contains('btn-add-tracking')) return;
          if (e.target.classList.contains('btn-resend-tracking')) return;
          orderIdInput.value = li.dataset.id;
          fetchOrder();
        });
      });

      // Click handler for "Track-ID nachtragen" buttons
      historyList.querySelectorAll('.btn-add-tracking').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          loadOrderForTracking(btn.dataset.id);
        });
      });

      // Click handler for "Erneut senden" buttons
      historyList.querySelectorAll('.btn-resend-tracking').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const prevTracking = btn.dataset.tracking || '';
          loadOrderForTracking(btn.dataset.id).then(() => {
            // Pre-fill with previous tracking number for correction
            if (prevTracking) {
              trackingNumberInput.value = prevTracking;
              sendTrackingBtn.disabled = false;
            }
          });
        });
      });
    });
  }

  /**
   * Load order data from API for tracking-only mode.
   * Shows a compact preview and the tracking section directly.
   */
  async function loadOrderForTracking(orderId) {
    showStatus('Lade Bestelldaten fuer Tracking...', 'info');

    try {
      const { apiUrl, apiKey } = await getSettings();
      const response = await fetch(`${apiUrl}/api_shipping/order/${orderId}`, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        showStatus(`API-Fehler: Server liefert kein JSON (Status ${response.status}). API-URL pruefen.`, 'error');
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        showStatus(`Fehler: ${data.error || 'Unbekannter Fehler'}`, 'error');
        return;
      }

      currentOrderData = data;
      formFilled = true;
      orderIdInput.value = orderId;

      // Show compact preview
      showPreview(data);
      showStatus('Bitte Track-ID eingeben.', 'info');

      // Show tracking section directly (skip "Formular ausfuellen")
      showTrackingSection();
    } catch (err) {
      showStatus(`Verbindungsfehler: ${err.message}`, 'error');
    }
  }

  // --- Helpers ---

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey'], (data) => {
        resolve(data);
      });
    });
  }

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
  }

  function hideStatus() {
    statusEl.className = 'status hidden';
  }

  // Escaped auch Anfuehrungszeichen, weil Werte in Attributen (data-*) landen
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
});
