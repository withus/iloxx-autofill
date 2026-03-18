/**
 * iloxx Autofill Content Script
 *
 * Fills the iloxx shipping form (ppvmanualorder.aspx) with order data
 * received from the popup. Also monitors the page for tracking numbers
 * after form submission.
 *
 * All iloxx form IDs have prefix "ContentPlaceHolder1_"
 */

const PREFIX = 'ContentPlaceHolder1_';

// Country mapping: Shop values -> iloxx ISO 3166-1 alpha-3
const COUNTRY_MAP = {
  'Deutschland': 'DEU',
  'Oesterreich': 'AUT',
  'Schweiz': 'CHE',
  'Frankreich': 'FRA',
  'Niederlande': 'NLD',
  'Belgien': 'BEL',
  'Luxemburg': 'LUX',
  'Italien': 'ITA',
  'Spanien': 'ESP',
  'Polen': 'POL',
  'Tschechien': 'CZE',
  'Daenemark': 'DNK',
  'Schweden': 'SWE',
};

// Field mapping: { jsonKey: [primaryId, fallbackId, fieldType] }
const FIELD_MAP = {
  vorname:      ['txtFirstName',         'txtFirstName',       'text'],
  nachname:     ['txtLastName',          'txtLastName',        'text'],
  firma:        ['txtCompany',           'txtCompany',         'text'],
  plz:          ['txtZIP',               'txtPostalCode',      'text'],
  stadt:        ['txtCity',              'txtCity',             'text'],
  strasse:      ['txtStreet',            'txtStreet',           'text'],
  hausnummer:   ['txtHouseNo',           'txtHouseNumber',      'text'],
  adresszusatz: ['txtAdditionalAddress', 'txtAdditionAddress',  'text'],
  telefon:      ['txtPhone',             'txtPhoneNumber',      'text'],
  email:        ['txtEMail',             'txtEmailAddress',     'text'],
  kundennummer: ['txtCustomerNr',        'txtCustomerNumber',   'text'],
};

// Salutation radio IDs
const SALUTATION_MAP = {
  herr:  ['chkSalutationMale',          'chkSalutationMale'],
  frau:  ['chkSalutationFemale',        'chkSalutationFemale'],
  keine: ['chkSalutationNoSalutation',  'chkSalutationNone'],
};

// Country select IDs
const COUNTRY_IDS = ['selCountry', 'ddlCountry'];

// Weight select IDs (Parcel 1)
const WEIGHT_IDS = ['selPostWeight_Parcel1', 'ddlWeight'];

// Reference field IDs (Parcel 1)
const REFERENCE_IDS = ['txtReference_Parcel1', 'txtReference'];

// Content field IDs (Parcel 1)
const CONTENT_IDS = ['txtContent_Parcel1', 'txtContent'];

// Vorbelegung des Felds "Inhalt", bei Bedarf an das eigene Sortiment anpassen
const DEFAULT_PACKAGE_CONTENT = 'Waren';


/**
 * Find element by trying primary ID, then fallback ID (both with prefix)
 */
function findElement(primaryId, fallbackId) {
  let el = document.getElementById(PREFIX + primaryId);
  if (!el && fallbackId && fallbackId !== primaryId) {
    el = document.getElementById(PREFIX + fallbackId);
  }
  return el;
}

/**
 * Set value on a text input and dispatch events
 */
function setTextValue(el, value) {
  if (!el || value === null || value === undefined) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Set value on a select element and trigger PostBack if needed
 */
function setSelectValue(el, value) {
  if (!el || !value) return false;

  // Find matching option
  for (let i = 0; i < el.options.length; i++) {
    if (el.options[i].value === value || el.options[i].text === value) {
      el.selectedIndex = i;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}

/**
 * Click a radio button
 */
function clickRadio(el) {
  if (!el) return;
  el.checked = true;
  el.dispatchEvent(new Event('click', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Enable a disabled field, set its value
 */
function setDisabledField(el, value) {
  if (!el) return;
  el.disabled = false;
  el.readOnly = false;
  setTextValue(el, value);
}

/**
 * Add visual feedback (green border) to filled fields
 */
function highlightField(el) {
  if (!el) return;
  const original = el.style.borderColor;
  el.style.borderColor = '#4CAF50';
  el.style.boxShadow = '0 0 4px rgba(76, 175, 80, 0.4)';
  setTimeout(() => {
    el.style.borderColor = original;
    el.style.boxShadow = '';
  }, 3000);
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main fill function
 */
async function fillForm(data) {
  console.log('[iloxx-autofill] Starting form fill for order #' + data.order_id);

  // Step 1: Set country (has PostBack)
  const countryCode = COUNTRY_MAP[data.land] || data.land || 'DEU';
  const countryEl = findElement(COUNTRY_IDS[0], COUNTRY_IDS[1]);
  if (countryEl) {
    const countrySet = setSelectValue(countryEl, countryCode);
    if (countrySet) {
      highlightField(countryEl);
      console.log('[iloxx-autofill] Country set to ' + countryCode + ', waiting for PostBack...');
      await sleep(600);
    }
  }

  // Step 2: Set PLZ (has PostBack for auto-fill city)
  const plzField = FIELD_MAP.plz;
  const plzEl = findElement(plzField[0], plzField[1]);
  if (plzEl && data.plz) {
    setTextValue(plzEl, data.plz);
    highlightField(plzEl);
    // Trigger blur to activate PostBack
    plzEl.dispatchEvent(new Event('blur', { bubbles: true }));
    console.log('[iloxx-autofill] PLZ set to ' + data.plz + ', waiting for city auto-fill...');
    await sleep(600);
  }

  // Step 3: Set city (may already be auto-filled by PLZ PostBack, override if needed)
  const stadtField = FIELD_MAP.stadt;
  const stadtEl = findElement(stadtField[0], stadtField[1]);
  if (stadtEl && data.stadt) {
    setTextValue(stadtEl, data.stadt);
    highlightField(stadtEl);
  }

  // Step 4: Set all other text fields
  const textFields = ['vorname', 'nachname', 'firma', 'strasse', 'hausnummer', 'adresszusatz', 'telefon', 'email'];
  for (const key of textFields) {
    const value = data[key];
    if (!value) continue;
    const [primaryId, fallbackId] = FIELD_MAP[key];
    const el = findElement(primaryId, fallbackId);
    if (el) {
      setTextValue(el, value);
      highlightField(el);
    } else {
      console.warn('[iloxx-autofill] Field not found: ' + key);
    }
  }

  // Step 5: Kundennummer (may be disabled)
  if (data.kundennummer && data.kundennummer !== '0') {
    const [primaryId, fallbackId] = FIELD_MAP.kundennummer;
    const kundEl = findElement(primaryId, fallbackId);
    if (kundEl) {
      setDisabledField(kundEl, data.kundennummer);
      highlightField(kundEl);
    }
  }

  // Step 6: Anrede (radio buttons)
  const anrede = (data.anrede || 'keine').toLowerCase();
  const salutationKey = anrede === 'herr' ? 'herr' : anrede === 'frau' ? 'frau' : 'keine';
  const [salPrimary, salFallback] = SALUTATION_MAP[salutationKey];
  const salEl = findElement(salPrimary, salFallback);
  if (salEl) {
    clickRadio(salEl);
    highlightField(salEl);
  }

  // Step 7: Reference field = Order ID
  const refEl = findElement(REFERENCE_IDS[0], REFERENCE_IDS[1]);
  if (refEl) {
    setTextValue(refEl, String(data.order_id));
    highlightField(refEl);
  }

  // Step 8: Content field = default package content
  const contentEl = findElement(CONTENT_IDS[0], CONTENT_IDS[1]);
  if (contentEl) {
    setTextValue(contentEl, DEFAULT_PACKAGE_CONTENT);
    highlightField(contentEl);
  }

  console.log('[iloxx-autofill] Form fill complete for order #' + data.order_id);
}


/**
 * Detect tracking number on the current iloxx.de page.
 *
 * GLS uses TWO identifier formats:
 * - Track-ID: 8-char alphanumeric (e.g. "AB12CD34", "XY98ZW76")
 * - Paketnummer: 11-14 digit numeric (e.g. "1234567890123")
 * Both are valid for tracking on gls-group.eu.
 *
 * Strategies (tried in order):
 * 1. Look for labeled Track-ID / Paketnummer patterns in page text
 * 2. Look for PDF download links
 * 3. Look for labeled elements near tracking keywords
 * 4. Multiline: keyword on one line, value on nearby lines
 */
function detectTrackingNumber() {
  console.log('[iloxx-autofill] Attempting tracking number detection...');

  const bodyText = document.body.innerText || '';

  // Strategy 1: Labeled patterns in page text
  // Priority: numeric Paketnummer first (needed for direct tracking URL with PLZ)
  const trackingPatterns = [
    // GLS Paketnummer: 11-14 digits (preferred - used in customer email tracking link)
    /Sendungsnummer[:\s]*(\d{11,14})/i,
    /Paketnummer[:\s]*(\d{11,14})/i,
    /Tracking[- ]?(?:Nr|Number|Nummer)[.:\s]*(\d{11,14})/i,
    /GLS[:\s]*(\d{11,14})/i,
    // GLS Track-ID: 8-char alphanumeric (fallback)
    /(?:Ihre\s+)?GLS\s+Track-?ID[:\s.]*([A-Z0-9]{8})\b/i,
    /Track-?ID[:\s.]*([A-Z0-9]{8})\b/i,
  ];

  for (const pattern of trackingPatterns) {
    const match = bodyText.match(pattern);
    if (match && match[1]) {
      console.log('[iloxx-autofill] Tracking found via text pattern: ' + match[1]);
      return match[1];
    }
  }

  // Strategy 2: Look for download links (DUN2 PDFs often contain parcel number)
  const links = document.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.href || '';
    const downloadMatch = href.match(/dun2[_-]?(\d{11,14})/i);
    if (downloadMatch && downloadMatch[1]) {
      console.log('[iloxx-autofill] Tracking found in download link: ' + downloadMatch[1]);
      return downloadMatch[1];
    }
  }

  // Strategy 3: Look for labeled elements near tracking keywords
  const allElements = document.querySelectorAll('td, span, div, label, p');
  for (const el of allElements) {
    const text = (el.textContent || '').trim();
    if (/sendung|tracking|paket|track.?id/i.test(text)) {
      // Check next sibling for alphanumeric Track-ID or numeric Paketnummer
      const sibling = el.nextElementSibling;
      if (sibling) {
        const sibText = (sibling.textContent || '').trim();
        // Try alphanumeric Track-ID first (8 chars, must contain both letters and digits)
        const alphaMatch = sibText.match(/\b([A-Z0-9]{8})\b/i);
        if (alphaMatch && /[A-Z]/i.test(alphaMatch[1]) && /\d/.test(alphaMatch[1])) {
          console.log('[iloxx-autofill] Track-ID found near label: ' + alphaMatch[1]);
          return alphaMatch[1];
        }
        // Try numeric Paketnummer
        const numMatch = sibText.match(/(\d{11,14})/);
        if (numMatch) {
          console.log('[iloxx-autofill] Paketnummer found near label: ' + numMatch[1]);
          return numMatch[1];
        }
      }
      // Check within the element itself
      const selfAlpha = text.match(/\b([A-Z0-9]{8})\b/i);
      if (selfAlpha && /[A-Z]/i.test(selfAlpha[1]) && /\d/.test(selfAlpha[1]) && text.length < 100) {
        console.log('[iloxx-autofill] Track-ID found in labeled element: ' + selfAlpha[1]);
        return selfAlpha[1];
      }
      const selfNum = text.match(/(\d{11,14})/);
      if (selfNum && text.length < 100) {
        console.log('[iloxx-autofill] Paketnummer found in labeled element: ' + selfNum[1]);
        return selfNum[1];
      }
    }
  }

  // Strategy 4: Multiline - keyword on one line, value within ±2 lines
  const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/track.?id|sendungsnummer|paketnummer|ihre\s+gls/i.test(lines[i])) {
      for (let j = Math.max(0, i - 2); j <= Math.min(i + 2, lines.length - 1); j++) {
        // Alphanumeric Track-ID
        const alphaMatch = lines[j].match(/\b([A-Z0-9]{8})\b/i);
        if (alphaMatch && /[A-Z]/i.test(alphaMatch[1]) && /\d/.test(alphaMatch[1])) {
          console.log('[iloxx-autofill] Track-ID found near keyword line: ' + alphaMatch[1]);
          return alphaMatch[1];
        }
        // Numeric Paketnummer
        const numMatch = lines[j].match(/\b(\d{11,14})\b/);
        if (numMatch) {
          console.log('[iloxx-autofill] Paketnummer found near keyword line: ' + numMatch[1]);
          return numMatch[1];
        }
      }
    }
  }

  console.log('[iloxx-autofill] No tracking number detected on page.');
  return null;
}


/**
 * Start observing DOM changes after form submission to auto-detect tracking numbers.
 * Called after a successful form fill.
 */
let domObserver = null;

function startTrackingObserver() {
  // Don't start multiple observers
  if (domObserver) return;

  console.log('[iloxx-autofill] Starting DOM observer for tracking number detection...');

  domObserver = new MutationObserver(() => {
    const trackingNumber = detectTrackingNumber();
    if (trackingNumber) {
      console.log('[iloxx-autofill] Auto-detected tracking number: ' + trackingNumber);
      // Send to popup
      chrome.runtime.sendMessage({
        action: 'trackingDetected',
        trackingNumber: trackingNumber,
      });
      // Stop observing after detection
      stopTrackingObserver();
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Auto-stop after 5 minutes to prevent memory leaks
  setTimeout(() => stopTrackingObserver(), 5 * 60 * 1000);
}

function stopTrackingObserver() {
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
    console.log('[iloxx-autofill] DOM observer stopped.');
  }
}


// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fillForm' && message.data) {
    fillForm(message.data)
      .then(() => {
        // Start observing for tracking numbers after form fill
        startTrackingObserver();
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('[iloxx-autofill] Error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }

  if (message.action === 'detectTracking') {
    const trackingNumber = detectTrackingNumber();
    sendResponse({ trackingNumber: trackingNumber });
    return false; // sync response
  }
});

// --- OrderbookID Detection ---

/**
 * Detect the internal iloxx OrderbookID from the confirmation page.
 * The hidden field ContentPlaceHolder1_hdfOrderbookID contains the ID
 * after a successful form submission on ppvmanualorder.aspx.
 */
function detectOrderBookId() {
  if (!window.location.href.includes('ppvmanualorder.aspx')) return;

  const hiddenField = document.getElementById(PREFIX + 'hdfOrderbookID');
  if (!hiddenField || !hiddenField.value) return;

  const orderBookId = hiddenField.value.trim();
  if (!orderBookId || orderBookId === '0') return;

  console.log('[iloxx-autofill] OrderbookID detected:', orderBookId);

  // Send to service worker for storage in pendingOrder
  chrome.runtime.sendMessage({
    action: 'orderBookIdDetected',
    orderBookId: orderBookId,
  }).catch(() => {
    // Service worker may not be ready yet, that's okay
    console.log('[iloxx-autofill] Could not send OrderbookID to service worker');
  });
}

// Run OrderbookID detection on page load
detectOrderBookId();

// Also observe for dynamic page updates (e.g. after PostBack)
const orderBookObserver = new MutationObserver(() => {
  detectOrderBookId();
});

const orderBookField = document.getElementById(PREFIX + 'hdfOrderbookID');
if (orderBookField) {
  orderBookObserver.observe(orderBookField, { attributes: true, attributeFilter: ['value'] });
  // Also watch parent for replacement of the hidden field
  if (orderBookField.parentElement) {
    orderBookObserver.observe(orderBookField.parentElement, { childList: true });
  }
}

console.log('[iloxx-autofill] Content script loaded on', window.location.href);
