// DevTools page logic for Apex Inspector
console.log('Apex Inspector DevTools page loaded');

chrome.devtools.panels.create(
  "Apex Inspector",
  "icon16.png",
  "panel.html",
  function(panel) {
    let panelWindow = null;
    panel.onShown.addListener(function(win) {
      panelWindow = win;
      // Send all buffered requests to the panel when it is first shown
      if (window._apexInspectorBufferedRequests) {
        window._apexInspectorBufferedRequests.forEach((msg) => {
          panelWindow.postMessage(msg, "*");
        });
        window._apexInspectorBufferedRequests = [];
      }
    });
    // Buffer requests if panelWindow is not ready
    function postToPanel(msg) {
      if (panelWindow) {
        panelWindow.postMessage(msg, "*");
      } else {
        window._apexInspectorBufferedRequests = window._apexInspectorBufferedRequests || [];
        window._apexInspectorBufferedRequests.push(msg);
      }
    }
    chrome.devtools.network.onRequestFinished.addListener((request) => {
      if (request.request && request.request.url) {
        // Handle Aura requests
        if (request.request.url.includes("/aura")) {
          request.getContent((body) => {
            const requestWithContent = {
              ...request,
              response: {
                ...request.response,
                content: { text: body }
              }
            };
            postToPanel({ type: "lightning", request: requestWithContent });
          });
        }

        // Handle Salesforce Communities/Experience/Sites Apex requests
        if (request.request.url.includes("/webruntime/api/apex/execute")) {
          request.getContent((body) => {
            const requestWithContent = {
              ...request,
              response: {
                ...request.response,
                content: { text: body }
              }
            };
            postToPanel({ type: "community", request: requestWithContent });
          });
        }
      }
    });
  }
);
