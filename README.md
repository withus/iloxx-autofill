# iloxx Autofill

A Chrome extension (Manifest V3) that fills the shipping form on iloxx.de with order data from your own web shop and reports the tracking number back to the shop afterwards.

This project is not affiliated with, endorsed by or sponsored by iloxx or GLS. The name "iloxx" only describes the website whose form is filled.

## What it does

1. You enter an order number in the extension popup. The extension asks your shop API for the delivery address and shows a preview.
2. With an iloxx form page open in the active tab, a click on "Formular ausfuellen" writes the address into the form fields (name, company, street, postal code, city, country, phone, e-mail, salutation, order number as reference).
3. You check the form and submit it on iloxx yourself. The extension never submits the form.
4. After the fill, the content script watches the iloxx page for 5 minutes and tries to find the tracking number in the page text. You can also press the magnifier button in the popup to search the active tab, or type the number by hand.
5. A click on "An Shop senden" sends the tracking number to your shop API, which is expected to mark the order as shipped.

The extension has no backend of its own. Its own network requests go only to the shop API you configure. Filling the iloxx form also triggers the iloxx page's own server round trips (see Privacy).

## Why

Typing every delivery address into the carrier portal by hand is slow and error-prone. This tool was written in 2026 to take that step out of the shipping routine of a web shop: the address comes from the shop, the tracking number goes back to the shop.

### Changes for this public version

The extension was first used privately with one shop. For this repository it was cleaned up and hardened:

- The shop domain was removed from `host_permissions`. The shop API origin is now requested at runtime as an optional host permission when you save the settings.
- The API URL must use https (http only for localhost).
- URL and API key moved from `chrome.storage.sync` to `chrome.storage.local`, so the key is not synced to other browsers.
- Order data from the shop API is HTML-escaped before it is inserted into the popup.
- Shop-specific defaults and sample tracking numbers were replaced with neutral values, the success message after sending no longer assumes that the shop mails the customer, and the icons were replaced.
- The name and description in the manifest are neutral, and `minimum_chrome_version` is set to 99.
- "Verbindung testen" also checks the URL and asks for access; the URL check rejects user name, password, query and fragment.

## Requirements

- Chrome 99 or newer. The manifest sets `minimum_chrome_version` to 99 because the code uses the promise form of `chrome.tabs.sendMessage` and `chrome.runtime.sendMessage`, which Chrome supports from version 99 on ([tabs API reference](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage)).
- Your own access to the iloxx shipping form.
- A shop that implements the three endpoints described under "Shop API contract". No reference implementation is included.

## Installation (unpacked extension)

There is no store release. Load the folder as an unpacked extension, as described in the [Chrome extensions getting started guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world):

1. Open `chrome://extensions` in a new tab.
2. Enable Developer mode with the toggle next to "Developer mode".
3. Click "Load unpacked" (German Chrome: "Entpackte Erweiterung laden") and select the folder that contains `manifest.json`.

## Setup

1. Open the settings: click the gear icon in the popup, or use the extension's options page in `chrome://extensions`.
2. Enter the API URL, for example `https://shop.example.com` (base URL without trailing slash) and the API key.
3. Click "Speichern". Chrome asks whether the extension may access that address. Allow it. The extension requests only the origin of your API URL, at runtime, because the manifest lists no shop address (`optional_host_permissions`). Chrome only accepts this request from a user action such as the click on the save button.
4. If you decline, the settings are still saved and the page tells you that access was denied. Without access the extension can only reach a shop that sends CORS headers itself; otherwise requests fail with "Failed to fetch". Save again and allow the access. Access granted for an earlier API URL is not revoked automatically; remove it under chrome://extensions if you change shops.
5. "Verbindung testen" calls the test endpoint and reports the result.

Only `https` URLs are accepted. `http` is accepted for `localhost` and `127.0.0.1` so that you can develop against a local shop. URLs with user name, password, query or fragment are rejected. "Verbindung testen" asks for the same access as "Speichern".


## Shop API contract

The extension calls three endpoints below the configured API URL. The API URL is used as a prefix, so it may contain a path, for example `https://shop.example.com/shop`. Any shop that answers like this can be used.

Rules for all endpoints:

- Every request carries the header `X-Api-Key: <key>` (`src/popup/popup.js:126`, `src/popup/popup.js:255`, `src/options/options.js:117`).
- `order` and `shipped` responses must have a `Content-Type` that contains `application/json`. Otherwise the popup shows "Server liefert kein JSON" (`src/popup/popup.js:129-133`, `src/popup/popup.js:264-268`).
- Errors are any non-2xx status with a JSON body of the form `{"error": "message"}`. The popup shows the text of `error` (`src/popup/popup.js:137-139`, `src/popup/popup.js:272-274`, `src/options/options.js:125`).
- With the granted host access, requests from the extension pages are not subject to CORS, according to the [Chrome documentation on network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). Your shop does not need to send CORS headers for this. This was not tested against a real browser prompt (see "Tested").

### GET /api_shipping/test

Connection test, called from the options page (`src/options/options.js:115-117`).

Success is HTTP 2xx with a JSON body `{"status": "ok"}` (`src/options/options.js:122`). Anything else is shown as an error.

```json
{ "status": "ok" }
```

### GET /api_shipping/order/{orderId}

Returns the delivery data for one order (`src/popup/popup.js:124-127`, `src/popup/popup.js:566-569`).

Use digits only for `orderId`. The popup rejects other manual input before the request (`src/popup/popup.js:110`). Order numbers that come back from the shop (history buttons, `shipped`) are put into the URL path as they are, without further checks or URL encoding.

Response fields, all read from the top level of the JSON object:

| Field | Meaning and use | Source |
|---|---|---|
| `order_id` | Order number, digits only (a string order number breaks the history buttons, which go through the manual input check). Shown as "Bestellung #...", written into the reference field of the form, used in the URL of the `shipped` endpoint and as key of the local history. Keep its type stable between calls, the history compares it with `===`. | `src/popup/popup.js:156`, `src/popup/popup.js:252`, `src/popup/popup.js:430`, `src/content/content.js:223` |
| `anrede` | Salutation. `herr` or `frau`, case-insensitive. Anything else or a missing value selects "no salutation". | `src/content/content.js:211-213` |
| `vorname`, `nachname` | First and last name. | `src/popup/popup.js:157`, `src/content/content.js:186` |
| `firma` | Company, optional. | `src/popup/popup.js:158`, `src/content/content.js:186` |
| `strasse`, `hausnummer` | Street and house number as separate fields. | `src/popup/popup.js:159`, `src/content/content.js:186` |
| `adresszusatz` | Address line 2, optional. | `src/content/content.js:186` |
| `plz`, `stadt` | Postal code and city. The form fill sets the postal code first and waits 600 ms for the iloxx page to react, then overwrites the city. | `src/popup/popup.js:160`, `src/content/content.js:168-181` |
| `land` | Country. Either one of the German names in the built-in map (`Deutschland`, `Oesterreich`, `Schweiz`, `Frankreich`, `Niederlande`, `Belgien`, `Luxemburg`, `Italien`, `Spanien`, `Polen`, `Tschechien`, `Daenemark`, `Schweden`) or a value that matches the value or the text of an option in the iloxx country select, for example an ISO 3166-1 alpha-3 code. A missing value becomes `DEU`. | `src/content/content.js:14-28`, `src/content/content.js:154`, `src/content/content.js:92-103` |
| `telefon`, `email` | Phone number and e-mail address, optional. | `src/popup/popup.js:162-163`, `src/content/content.js:186` |
| `kundennummer` | Customer number for the iloxx form, optional. Skipped when empty or `"0"`. Written even if the field is disabled on the page. | `src/content/content.js:201-206`, `src/content/content.js:119-124` |
| `status` | Order status as a string. Shown in the preview. The value `shipped` makes the popup warn that the order is already marked as shipped. | `src/popup/popup.js:164`, `src/popup/popup.js:217` |

Send every key, using an empty string for unknown values. The preview joins `vorname`, `nachname`, `strasse`, `hausnummer`, `plz` and `stadt` without checking for missing values, so an absent key appears as the text "undefined" (`src/popup/popup.js:157-160`).

```json
{
  "order_id": 10042,
  "status": "paid",
  "anrede": "frau",
  "vorname": "Erika",
  "nachname": "Mustermann",
  "firma": "",
  "strasse": "Musterstrasse",
  "hausnummer": "12a",
  "adresszusatz": "",
  "plz": "12345",
  "stadt": "Musterstadt",
  "land": "Deutschland",
  "telefon": "+49 123 456789",
  "email": "erika.mustermann@example.com",
  "kundennummer": ""
}
```

Error example:

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{ "error": "Order not found" }
```

### POST /api_shipping/shipped/{orderId}

Reports the tracking number for an order (`src/popup/popup.js:252-262`). `orderId` is the `order_id` from the order response.

Headers: `X-Api-Key` and `Content-Type: application/json`.

Request body:

```json
{
  "tracking_number": "AB12CD34",
  "shipping_provider": "GLS"
}
```

- `tracking_number` is the text from the input field, a free string (`src/popup/popup.js:259`).
- `shipping_provider` is the fixed text `GLS` (`src/popup/popup.js:260`).

Success is any 2xx status with a JSON body. The extension does not read any field of a success response; it shows "Tracking-Nummer an den Shop uebermittelt. Status: shipped." and sets the local order status to `shipped` (`src/popup/popup.js:277`, `src/popup/popup.js:291`). Whatever your shop does with the order (set a status, send a shipping mail) is up to the shop.

The history in the popup has an "Erneut" button that sends a corrected tracking number for an order again (`src/popup/popup.js:498`). The endpoint should therefore accept repeated calls for the same order.

### Quick check with curl

```bash
curl -H "X-Api-Key: YOUR_KEY" https://shop.example.com/api_shipping/test
curl -H "X-Api-Key: YOUR_KEY" https://shop.example.com/api_shipping/order/10042
curl -X POST -H "X-Api-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"tracking_number":"AB12CD34","shipping_provider":"GLS"}' \
  https://shop.example.com/api_shipping/shipped/10042
```

## Privacy

What is stored, in `chrome.storage.local` of your browser profile (not synced between devices):

- API URL and API key (`src/options/options.js`).
- A history of up to 20 orders with order number, customer name, tracking number, provider and timestamps. The popup shows the latest 10 (`src/popup/popup.js:441-442`, `src/popup/popup.js:487`).
- The complete order record as received from the shop (including address, phone number and e-mail) as "pending order" after a form fill. It is removed after the tracking number was sent, or when it is older than 24 hours and the extension checks it (`src/popup/popup.js:27-35`, `src/popup/popup.js:45`, `src/background/service-worker.js:21-27`).
- The internal iloxx order book ID, when the content script finds it on the confirmation page. It is only stored with the pending order and not sent anywhere (`src/content/content.js:421-448`, `src/background/service-worker.js:51-57`).

Chrome removes this data when the extension is uninstalled.

Where data goes:

- To your shop: the API key header on every request, the order number in the URL, and on "An Shop senden" the tracking number and the text `GLS`. These are the only network requests in the code (`fetch` in `src/popup/popup.js` and `src/options/options.js`). There is no analytics and no other server.
- To iloxx: the extension writes the address into the form fields in your browser. The iloxx page reacts to changes of country and postal code with its own server round trips (ASP.NET postbacks), and the extension triggers them on purpose (`src/content/content.js:153-172`). The form content entered up to that point therefore reaches iloxx before you submit, even if you cancel afterwards.

What the extension reads from pages:

- The content script runs only on `https://iloxx.de/*` and `https://www.iloxx.de/*`. It reads the page text to look for a tracking number and the hidden order book field.
- The magnifier button runs a small script in the active tab, on any site, and reads the visible text of that page to look for a tracking number (`src/popup/popup.js:344-388`). This happens only when you click the button. The script returns just the match to the popup.
- The content script writes the order number, postal code, country code, found tracking numbers, the order book ID and the page URL to the console of the iloxx tab (for example `src/content/content.js:151`, `:160`, `:173`, `:435`, `:464`).

Permissions in the manifest:

| Permission | Use |
|---|---|
| `storage` | Settings, history, pending order |
| `activeTab`, `scripting` | Tracking number search in the active tab |
| `tabs` | Reading the URL of the active tab to check for iloxx.de and browser-internal pages |
| host access to `iloxx.de` and `www.iloxx.de` | Form fill and tracking detection |
| optional host access, requested at runtime | Only the origin of the API URL you enter. The manifest allows `https://*/*`, `http://localhost/*` and `http://127.0.0.1/*` as candidates. |

## Limits

- The form fill depends on the markup of the iloxx page. It looks fields up by element ID with the prefix `ContentPlaceHolder1_` and a fallback ID per field (`src/content/content.js:11-65`). If iloxx renames fields, the field is skipped. For first name, last name, company, street, house number, address line 2, phone and e-mail the console shows "Field not found" (`src/content/content.js:186-196`). Country, postal code, city, customer number, salutation, reference and content fields are skipped without a message.
- Waits for the iloxx page are fixed at 600 ms after the country and after the postal code (`src/content/content.js:161`, `src/content/content.js:174`). On a slow connection this can be too short.
- Tracking number detection is text matching. It looks for labelled numbers of 11 to 14 digits and for 8-character alphanumeric IDs, and it can pick the wrong number. Check the value before you send it. The patterns and the fixed provider name `GLS` assume parcels tracked with GLS numbers.
- The country map has 13 entries (`src/content/content.js:14-28`). Other values must match an option in the iloxx country select.
- The default content text of the parcel is `Waren`. Change `DEFAULT_PACKAGE_CONTENT` in `src/content/content.js` to fit your range of goods.
- The interface language is German.

## Tested

Checked with Chrome for Testing 139 in headless mode, with the extension loaded unpacked:

- The extension loads from the manifest, the service worker starts and the options page renders without script errors.
- The popup, against a local mock shop that follows the contract above: order lookup with the API key header, preview, tracking submit with the JSON body, and display of the `error` field.
- The content script, against a simulated iloxx page that serves elements with the expected IDs. The simulated page is not the real iloxx site, so the selectors were not checked against the live site in this test.
- The save button starts the runtime permission request from the click (the prompt itself cannot be answered in headless mode, so grant and deny paths were not exercised in a browser).

## Development

There is no build step and no dependency. Plain JavaScript, loaded as is.

```
manifest.json
src/background/service-worker.js   badge for orders waiting for a tracking number, order book ID storage
src/content/content.js             form fill and tracking detection on iloxx.de
src/popup/                         order lookup, preview, tracking submit, history
src/options/                       API URL and API key, connection test, host access request
src/icons/
```

Content script messages are logged with the prefix `[iloxx-autofill]`. Open DevTools on an iloxx page to see them. The popup console is reachable through "Inspect popup" in the context menu of the extension icon.

## License

MIT, see [LICENSE](LICENSE).
