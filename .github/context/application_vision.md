# Apex Inspector Project Context

Welcome to the Apex Inspector Chrome DevTools extension project! This document provides essential context, design decisions, and helpful information for new contributors or anyone working on this app.

## What is Apex Inspector?
A Chrome DevTools extension for Salesforce that live-inspects network requests to the `/aura` endpoint, parses Apex actions, and displays them in a sortable/filterable React/Tailwind table in a custom DevTools tab. It robustly parses and displays all relevant Apex/network data, including full HTTP request/response, context, and performance summaries, with a modern, user-friendly, and responsive UI.

## Key Features
- Live-inspects `/aura` network requests in Salesforce Lightning.
- Parses Apex actions, including class/method, parameters, and responses.
- Displays actions in a sortable, filterable table (React + Tailwind).
- Expanded row shows full request/response, context, and performance data.
- Copy-to-clipboard for all JSON sections, with a "Copied!" toast.
- Expanded row persists across filtering/sorting using unique Salesforce action id.
- Responsive, modern UI for DevTools panel.

## Project Structure
- `src/devtools/DevtoolsPanel.tsx`: Main React panel, table, and UI logic.
- `devtools.js`, `devtools.html`, `panel.html`: Chrome DevTools extension glue.
- `manifest.json`: Chrome extension manifest (permissions, panel, etc).
- `local.css`: Custom styles

## Design/Implementation Notes
- Uses window.postMessage for DevTools <-> panel communication.
- Buffers network events until the panel is shown.
- Robustly parses both URL-encoded and JSON POST data.
- Uses `react18-json-view` for pretty JSON rendering.
- Copy-to-clipboard uses the legacy textarea + `execCommand('copy')` for DevTools compatibility.
- All UI is React 18 + Tailwind CSS.

## For New Contributors
- See `README.md` for setup and build instructions.
- See `src/devtools/DevtoolsPanel.tsx` for main logic and UI.


## Helpful Links
- [Salesforce Lightning Network API docs](https://developer.salesforce.com/docs/atlas.en-us.lightning.meta/lightning/controllers_server_actions.htm)
- [Chrome DevTools Extension Docs](https://developer.chrome.com/docs/extensions/mv3/devtools/)
- [react18-json-view](https://github.com/PHIAR/react18-json-view)


