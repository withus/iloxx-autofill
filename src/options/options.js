const INVALID_URL_MESSAGE = 'Ungueltige API-URL. Erlaubt ist https (http nur fuer localhost und 127.0.0.1).';

document.addEventListener('DOMContentLoaded', () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const statusEl = document.getElementById('status');

  // Load saved settings (lokal, der API-Key soll nicht per Chrome Sync wandern)
  chrome.storage.local.get(['apiUrl', 'apiKey'], (data) => {
    if (data.apiUrl) apiUrlInput.value = data.apiUrl;
    if (data.apiKey) apiKeyInput.value = data.apiKey;
  });

  // Toggle API key visibility
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = 'Verbergen';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = 'Anzeigen';
    }
  });

  // Origin der API-URL liefern, null wenn nicht erlaubt (https, http nur lokal)
  function getApiOrigin(apiUrl) {
    let parsed;
    try {
      parsed = new URL(apiUrl);
    } catch (err) {
      return null;
    }
    // Zugangsdaten, Query und Fragment in der Basis-URL fuehren zu kaputten Anfragen
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocal)) {
      return parsed.origin;
    }
    return null;
  }

  // Zugriff auf den Shop-Origin anfordern, muss direkt im Klick-Handler starten (Nutzergeste)
  async function requestOriginAccess(origin) {
    try {
      return await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch (err) {
      showStatus(`Zugriffsanfrage fehlgeschlagen: ${err.message}`, 'error');
      return null;
    }
  }

  function showAccessDenied(origin) {
    showStatus(
      `Zugriff auf ${origin} wurde nicht erlaubt. Ohne diesen Zugriff kann die Erweiterung den Shop nicht abfragen. Bitte erneut versuchen und im Chrome-Dialog "Zulassen" waehlen.`,
      'error'
    );
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, '');
    const apiKey = apiKeyInput.value.trim();

    if (!apiUrl || !apiKey) {
      showStatus('Bitte alle Felder ausfuellen.', 'error');
      return;
    }

    const origin = getApiOrigin(apiUrl);
    if (!origin) {
      showStatus(INVALID_URL_MESSAGE, 'error');
      return;
    }

    const granted = await requestOriginAccess(origin);
    if (granted === null) return;

    // Einstellungen auch bei Ablehnung speichern, damit die Eingabe nicht verloren geht
    await chrome.storage.local.set({ apiUrl, apiKey });
    if (granted) {
      showStatus('Einstellungen gespeichert.', 'success');
    } else {
      showAccessDenied(origin);
    }
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, '');
    const apiKey = apiKeyInput.value.trim();

    if (!apiUrl || !apiKey) {
      showStatus('Bitte zuerst API-URL und Key eingeben.', 'error');
      return;
    }

    const origin = getApiOrigin(apiUrl);
    if (!origin) {
      showStatus(INVALID_URL_MESSAGE, 'error');
      return;
    }

    const granted = await requestOriginAccess(origin);
    if (granted === null) return;
    if (!granted) {
      showAccessDenied(origin);
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Teste...';

    try {
      const response = await fetch(`${apiUrl}/api_shipping/test`, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      });

      const data = await response.json();

      if (response.ok && data.status === 'ok') {
        showStatus('Verbindung erfolgreich!', 'success');
      } else {
        showStatus(`Fehler: ${data.error || 'Unbekannter Fehler'}`, 'error');
      }
    } catch (err) {
      showStatus(`Verbindungsfehler: ${err.message}`, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Verbindung testen';
    }
  });

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
  }
});
