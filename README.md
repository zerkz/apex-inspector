# Apex Inspector Chrome DevTools Extension

Apex Inspector is a Chrome DevTools extension for Salesforce developers that provides deep visibility into Apex HTTP calls made via the `/aura` endpoint, specifically those using `aura.ApexAction.execute`. It is designed to help you debug, inspect, and analyze Salesforce Lightning network activity directly from your browser's DevTools.

## Features

- **Automatic Capture of Apex Calls:**
  - Monitors all network requests to `/aura` and filters for those containing `aura.ApexAction.execute`.
  - Supports both single and boxcarred (batched) Apex actions.

- **Tabular View of Calls:**
  - Displays a table of captured Apex calls, including:
    - Timestamp
    - Apex class
    - Method
    - Latency (ms)
    - Visual grouping for boxcarred requests

- **Expandable Details:**
  - Click any row to expand and view:
    - Request parameters (pretty-printed JSON)
    - Response, with collapsible sections for `actions` and `context`
    - Raw request object (toggleable)

- **Debug Log:**
  - Toggleable debug log area to view internal extension messages and errors.
  - Log is cleared with the "Clear" button.

- **Boxcarred Request Support:**
  - Each action in a boxcarred request is shown as its own row, grouped visually.
  - Grouping is indicated with a color and icon.

- **Clear Button:**
  - Instantly clears all captured calls and debug logs.

- **No Build Tools Required:**
  - The extension is implemented in plain JavaScript and HTML for maximum compatibility and ease of maintenance.

## Usage

1. **Install the Extension:**
   - Load the extension as an unpacked extension in Chrome via `chrome://extensions`.

2. **Trigger Apex Calls:**
   - Open DevTools and select the "Apex Inspector" panel.
   - Use your Salesforce Lightning app as normal. Apex Inspector will automatically capture and display relevant network activity.

3. **Inspect and Debug:**
   - Click rows to expand details, view parameters, responses, and raw requests.
   - Use the debug log for troubleshooting extension behavior.

## Who is this for?
- Salesforce developers and admins working with Lightning components and Apex controllers.
- Anyone needing to debug or analyze Salesforce network traffic in detail.



---

**Tip:** Chrome DevTools extensions require a full DevTools window reload to pick up changes to the panel UI or logic. For fastest feedback, keep DevTools open and reload the panel after each change.

---

**Note:** This extension does not require any build tools or frameworks. All logic and UI are implemented in plain JavaScript and HTML for simplicity and reliability.
