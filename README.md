# Apex Inspector Chrome DevTools Extension ![apex inspector logo](public/images/icon48.png)

Apex Inspector is a Chrome DevTools extension for Salesforce developers that provides deep visibility into Apex HTTP calls and Salesforce API activity across multiple platforms. It supports calls made via the `/aura` endpoint (Lightning/Aura), `/webruntime/api/apex/execute` (Experience Cloud/Communities), `/apexremote` (VisualForce Remoting), GraphQL API calls, and Lightning Data Service operations. It is designed to help you debug, inspect, and analyze Salesforce network activity directly from your browser's DevTools.

[Chrome Extension Store Link / Install](https://chromewebstore.google.com/detail/apex-inspector/nibklfbhlmfngbjjpnbhbdjfllddppdm?hl=en)

![apex-inspector-example](https://github.com/user-attachments/assets/d836282b-4dc6-42c2-8941-e60efb61afa4)

## Features

- **Automatic Capture of Apex Calls:**
  - Monitors network requests across multiple Salesforce platforms:
    - `/aura` endpoint for Lightning/Aura calls containing `aura.ApexAction.execute`
    - `/webruntime/api/apex/execute` for Experience Cloud/Communities calls
    - `/apexremote` for VisualForce Remoting calls (including bulkified/boxcarred batches)
    - GraphQL API calls (`/services/data/*/graphql`)
    - Lightning Data Service calls (`uiRecordApi` @wire methods like `getRecord`, `updateRecord`, `createRecord`)
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

## Apex Class Mapping
For some APIs, you might see an Apex Class ID as the name. This means that the API is calling the Apex endpoint via ID. Visit the options page to learn how to provide ID -> Name mappings for the tool!


## Keybindings/Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| ← | Navigate to previous row | Table view or detail view |
| → | Navigate to next row | Table view or detail view |
| Del/⌫ | Close detail view and return to table | Detail view only |
| Click | Open/close detail view for selected row | Table view |

**Note:** Arrow key navigation automatically opens the detail view for the selected row.

## Who is this for?
- Salesforce developers and admins working with Lightning components, Experience Cloud sites, VisualForce pages, Apex controllers, and Lightning Data Service operations.
- Anyone needing to debug or analyze Salesforce network traffic, API calls, and data operations in detail.

## Why does this require "Read and change all your data on all websites"? 
Unfortunately since this is a devtools extension, there's no way around it. Other similar tools, like the [React Devtools Extension](https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi?hl=en) require the same permission. 

Thankfully you have the source code here to review if you have security concerns!
