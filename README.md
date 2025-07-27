# Apex Inspector Chrome DevTools Extension ![apex inspector logo](icon48.png)

Apex Inspector is a Chrome DevTools extension for Salesforce developers that provides deep visibility into Apex HTTP calls across multiple Salesforce platforms. It supports calls made via the `/aura` endpoint (Lightning/Aura), `/webruntime/api/apex/execute` (Experience Cloud/Communities), and `/apexremote` (VisualForce Remoting). It is designed to help you debug, inspect, and analyze Apex network activity directly from your browser's DevTools.

[Chrome Extension Store Link / Install](https://chromewebstore.google.com/detail/apex-inspector/nibklfbhlmfngbjjpnbhbdjfllddppdm?hl=en)

![apex-inspector-example](https://github.com/user-attachments/assets/d836282b-4dc6-42c2-8941-e60efb61afa4)

## Features

- **Automatic Capture of Apex Calls:**
  - Monitors network requests across multiple Salesforce platforms:
    - `/aura` endpoint for Lightning/Aura calls containing `aura.ApexAction.execute`
    - `/webruntime/api/apex/execute` for Experience Cloud/Communities calls
    - `/apexremote` for VisualForce Remoting calls
  - Supports both single and boxcarred (batched) Apex actions.
  - Calls can be sorted, or filtered via the request body or response body contents.

- **Tabular View of Calls:**
  - Displays a table of captured Apex calls, including:
    - Timestamp
    - Apex class
    - Method
    - Latency (ms)
    - Visual grouping for boxcarred requests

- **Expandable Details:**
  - Click any row to expand and view:
    - Request body 
    - Response body 
    - Timing/Performance tables
    - Raw Data

- **Responsive UI** 
  - Useful no matter what screen size you are on.
  - Dark/Light themes available, along with numerous JSON themes.

## Usage

1. **Install the Extension:**
   * Install the extension from the Chrome Extension store!  
    OR
   * Load the extension as an unpacked extension in Chrome via `chrome://extensions`.

2. **Trigger Apex Calls:**
   - Open DevTools and select the "Apex Inspector" panel.
   - Use your Salesforce app as normal (Lightning, Experience Cloud, or VisualForce pages). Apex Inspector will automatically capture and display relevant network activity.

3. **Inspect and Debug:**
   - Click rows to expand details, view parameters, responses, and raw requests.
   - Use the debug log for troubleshooting extension behavior.

## Keybindings/Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| ← | Navigate to previous row | Table view or detail view |
| → | Navigate to next row | Table view or detail view |
| Del/⌫ | Close detail view and return to table | Detail view only |
| Click | Open/close detail view for selected row | Table view |

**Note:** Arrow key navigation automatically opens the detail view for the selected row.

## Who is this for?
- Salesforce developers and admins working with Lightning components, Experience Cloud sites, VisualForce pages, and Apex controllers.
- Anyone needing to debug or analyze Salesforce network traffic in detail.

## Why does this require "Read and change all your data on all websites"? 
Unfortunately since this is a devtools extension, there's no way around it. Other similar tools, like the [React Devtools Extension](https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi?hl=en) require the same permission. 

Thankfully you have the source code here to review if you have security concerns!
