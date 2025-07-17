import React, { useEffect, useState, useMemo } from "react";
import React18JsonView from 'react18-json-view';
import 'react18-json-view/src/style.css';
import { useOptionsSettings } from '../chrome-extension/options/useOptionsSettings';
import type { FullRequest, FullResponse } from './networkTypes';

// Simple UUID generator for boxcar grouping
function generateBoxcarId() {
  return 'boxcar-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Types for Apex Action
interface ApexAction {
  id: string;
  timestamp: number;
  apexClass: string;
  method: string;
  latency: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  rawRequest: unknown;
  rawResponse: unknown;
  context: Record<string, unknown>;
  network: {
    requestId: string;
    url: string;
    latency: number;
  };
  fullResponse?: Record<string, unknown> | FullResponse; // Add this field
  fullRequest?: unknown | FullRequest; // Add this field for the full HTTP request
  error?: string | null; // Add error property
  boxcarId?: string; // Add boxcarId for grouping
}

type SortableKeys = "timestamp" | "apexClass" | "method" | "latency";

const columns: { key: SortableKeys; label: string }[] = [
  { key: "timestamp", label: "Timestamp" },
  { key: "apexClass", label: "Apex Class" },
  { key: "method", label: "Method" },
  { key: "latency", label: "Latency (ms)" },
];

// Removed unused types: DevtoolsRequest, AuraRequestData, AuraResponseData

const DevtoolsPanel: React.FC = () => {
  const [settings, saveSettings] = useOptionsSettings();
  const { theme, jsonViewTheme, minRawDataHeight = 320 } = settings;
  const [actions, setActions] = useState<ApexAction[]>([]);
  // Use expandedId as the only source of truth for expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortableKeys>("timestamp");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [filter, setFilter] = useState<Partial<Record<SortableKeys, string>>>({});
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [bodySearch, setBodySearch] = useState("");

  const jsonViewDark = theme === 'dark';

  // Ensure <html> class is set for dark mode
  React.useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') html.classList.add('dark');
    else html.classList.remove('dark');
  }, [theme]);

  // Listen for messages from devtools.js via window.postMessage
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Debug: log all incoming messages
      console.debug('[Apex Inspector] Panel received message:', event.data);
      if (event.data && event.data.type === "network" && event.data.request) {
        try {
          const request = event.data.request;
          console.debug('[Apex Inspector] Panel processing network event:', request);
          // --- Begin robust postData parsing ---
          let reqPostData: unknown = null;
          try {
            if (request.request.postData?.mimeType?.includes('application/x-www-form-urlencoded')) {
              // Parse URL-encoded form data
              const params = new URLSearchParams(request.request.postData.text || '');
              const message = params.get('message');
              if (message) {
                reqPostData = JSON.parse(message);
              }
            } else if (request.request.postData?.text) {
              // Try to parse as JSON directly
              reqPostData = JSON.parse(request.request.postData.text);
            }
          } catch (postDataError) {
            console.debug('[Apex Inspector] Failed to parse request postData as JSON, skipping:', postDataError);
            reqPostData = null;
          }

          // --- Begin robust response parsing ---
          let resJson: unknown = null;
          try {
            const responseText = request.response?.content?.text;
            const contentType = request.response?.headers?.find((h: { name: string; value: string }) => h.name.toLowerCase() === 'content-type')?.value;
            
            if (responseText && contentType?.includes('application/json')) {
              resJson = JSON.parse(responseText);
            } else {
              console.debug('[Apex Inspector] Response is not JSON, skipping parse. Content-Type:', contentType);
            }
          } catch (responseError) {
            console.debug('[Apex Inspector] Failed to parse response as JSON, skipping:', responseError);
            resJson = null;
          }

          console.debug('[Apex Inspector] Parsed postData:', reqPostData);
          console.debug('[Apex Inspector] Parsed response:', resJson);
          
          // Skip processing if we don't have valid JSON response
          if (!resJson || typeof resJson !== 'object') {
            console.debug('[Apex Inspector] No valid JSON response found, skipping action processing');
            return;
          }

          // Determine if this is a boxcarred request (more than one action)
          let boxcarId: string | undefined = undefined;
          let actionsArr: unknown[] = [];
          if (
            reqPostData &&
            typeof reqPostData === 'object' &&
            reqPostData !== null &&
            Array.isArray((reqPostData as { actions?: unknown[] }).actions)
          ) {
            actionsArr = (reqPostData as { actions: unknown[] }).actions;
            if (actionsArr.length > 1) {
              // Only assign a boxcarId if more than one action
              boxcarId = generateBoxcarId();
            }
            actionsArr.forEach((action: unknown, idx: number) => {
              if (
                typeof action === "object" &&
                action !== null &&
                (action as { descriptor?: string }).descriptor === "aura://ApexActionController/ACTION$execute"
              ) {
                // Robustly extract Apex class and method (Salesforce can use 'classname' or 'className', 'method' or 'methodName')
                const paramsObj = (action as Record<string, unknown>).params || {};
                const apexClass = typeof (paramsObj as Record<string, unknown>)["classname"] === 'string'
                  ? (paramsObj as Record<string, unknown>)["classname"] as string
                  : (paramsObj as Record<string, unknown>)["className"] as string;
                const apexMethod = typeof (paramsObj as Record<string, unknown>)["method"] === 'string'
                  ? (paramsObj as Record<string, unknown>)["method"] as string
                  : (paramsObj as Record<string, unknown>)["methodName"] as string;
                // --- Error detection logic ---
                let error: string | null = null;
                const resJsonObj = resJson as Record<string, unknown>;
                const actionResponse = (resJsonObj.actions as unknown[])?.[idx];
                const initialReturnValue = actionResponse && typeof actionResponse === 'object' ? (actionResponse as Record<string, unknown>).returnValue : {};
                const initialReturnValueObj = initialReturnValue && typeof initialReturnValue === 'object' ? initialReturnValue as Record<string, unknown> : {};
                let responseObj = initialReturnValueObj;
                const rawResp = (resJsonObj.actions as unknown[])?.[idx] || {};
                if (rawResp && typeof rawResp === 'object') {
                  const rawRespObj = rawResp as Record<string, unknown>;
                  if (rawRespObj.state === 'ERROR') {
                    // Extract all error details, not just the message
                    let errorDetails: Record<string, unknown> = {};
                    let errorMsg = 'Unknown Apex error';
                    
                    // Handle error array (most common Salesforce format)
                    if (Array.isArray(rawRespObj.error) && rawRespObj.error.length > 0) {
                      const errorObj = rawRespObj.error[0];
                      console.debug('[Apex Inspector] Processing error object:', errorObj);
                      if (typeof errorObj === 'object' && errorObj !== null) {
                        // Include all error properties: message, exceptionType, stackTrace, isUserDefinedException, etc.
                        errorDetails = { ...errorObj };
                        console.debug('[Apex Inspector] Error details extracted:', errorDetails);
                        if ('message' in errorObj && typeof errorObj.message === 'string') {
                          errorMsg = errorObj.message;
                        }
                      } else {
                        errorMsg = String(errorObj);
                        errorDetails = { message: errorMsg };
                      }
                    }
                    // Handle errors array (alternative format)
                    else if (Array.isArray(rawRespObj.errors) && rawRespObj.errors.length > 0) {
                      const errorObj = rawRespObj.errors[0];
                      if (typeof errorObj === 'object' && errorObj !== null) {
                        errorDetails = { ...errorObj };
                        if ('message' in errorObj && typeof errorObj.message === 'string') {
                          errorMsg = errorObj.message;
                        }
                      } else {
                        errorMsg = String(errorObj);
                        errorDetails = { message: errorMsg };
                      }
                    }
                    // Handle single error object
                    else if (rawRespObj.error && typeof rawRespObj.error === 'object') {
                      errorDetails = { ...rawRespObj.error };
                      if ('message' in rawRespObj.error && typeof rawRespObj.error.message === 'string') {
                        errorMsg = rawRespObj.error.message;
                      }
                    }
                    // Handle string error
                    else if (typeof rawRespObj.error === 'string') {
                      errorMsg = rawRespObj.error;
                      errorDetails = { message: errorMsg };
                    }
                    // Fallback
                    else {
                      errorDetails = { message: errorMsg };
                    }
                    
                    error = errorMsg;
                    // Compose the response object with all error details flattened at the top level
                    const actionResponse = (resJsonObj.actions as unknown[])?.[idx];
                    const returnValue = actionResponse && typeof actionResponse === 'object' ? (actionResponse as Record<string, unknown>).returnValue : {};
                    const returnValueObj = returnValue && typeof returnValue === 'object' ? returnValue as Record<string, unknown> : {};
                    responseObj = { ...errorDetails, ...returnValueObj };
                    console.debug('[Apex Inspector] Final response object with error details:', responseObj);
                    console.debug('[Apex Inspector] Error message set to:', error);
                  }
                }
                if (
                  typeof apexClass === "string" &&
                  typeof apexMethod === "string"
                ) {
                  setActions((prev) => [
                    ...prev,
                    {
                      id:
                        getApexActionUniqueId(action, (resJsonObj.actions as unknown[])?.[idx], resJsonObj.perfSummary) ||
                        (request.requestId || request.request.url) + "-" + idx,
                      timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                      apexClass: typeof (paramsObj as Record<string, unknown>)["namespace"] === "string" && (paramsObj as Record<string, unknown>)["namespace"]
                        ? `${(paramsObj as Record<string, unknown>)["namespace"] as string}.${apexClass}`
                        : apexClass,
                      method: apexMethod,
                      latency: request.time,
                      request: paramsObj as Record<string, unknown>,
                      response: responseObj,
                      rawRequest: action,
                      rawResponse: (resJsonObj.actions as unknown[])?.[idx] || {},
                      context: (resJsonObj.context || {}) as Record<string, unknown>,
                      network: {
                        requestId: request.requestId || request.request.url,
                        url: request.request.url,
                        latency: request.time,
                      },
                      fullResponse: resJson as Record<string, unknown>, // Store the full HTTP response
                      fullRequest: request, // Store the full HTTP request
                      error, // Add error property
                      boxcarId, // Only present if boxcarred
                    },
                  ]);
                } else {
                  // Could not parse class/method, but still show a row with raw data only
                  setActions((prev) => [
                    ...prev,
                    {
                      id:
                        getApexActionUniqueId(action, (resJsonObj.actions as unknown[])?.[idx], resJsonObj.perfSummary) ||
                        (request.requestId || request.request.url) + "-" + idx,
                      timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                      apexClass: '[Unparsed] ApexAction',
                      method: '[Unparsed] execute',
                      latency: request.time,
                      request: {} as Record<string, unknown>,
                      response: {} as Record<string, unknown>,
                      rawRequest: action,
                      rawResponse: (resJsonObj.actions as unknown[])?.[idx] || {},
                      context: {} as Record<string, unknown>,
                      network: {
                        requestId: request.requestId || request.request.url,
                        url: request.request.url,
                        latency: request.time,
                      },
                      fullResponse: resJson as Record<string, unknown>,
                      fullRequest: request,
                      error: 'Could not parse Apex class/method. See raw data.',
                      boxcarId, // Only present if boxcarred
                    },
                  ]);
                }
              }
            });
          }
        } catch (err) {
          // Debug: log parse errors
          console.error('[Apex Inspector] Error parsing network event:', err, event.data);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Sorting and filtering
  const filteredSorted = useMemo(() => {
    let data = actions;
    (Object.entries(filter) as Array<[SortableKeys, string]>).forEach(([key, value]) => {
      if (value) data = data.filter((row) => String(row[key] ?? "").toLowerCase().includes(value.toLowerCase()));
    });
    // Filter by request/response body
    if (bodySearch.trim()) {
      const search = bodySearch.trim().toLowerCase();
      data = data.filter(row => {
        const reqStr = JSON.stringify(row.request).toLowerCase();
        const respStr = JSON.stringify(row.response).toLowerCase();
        return reqStr.includes(search) || respStr.includes(search);
      });
    }
    data = [...data].sort((a, b) => {
      if (a[sortKey] < b[sortKey]) return sortAsc ? -1 : 1;
      if (a[sortKey] > b[sortKey]) return sortAsc ? 1 : -1;
      return 0;
    });
    return data;
  }, [actions, filter, sortKey, sortAsc, bodySearch]);

  // Keyboard navigation for left/right arrows and escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (filteredSorted.length === 0) return;
      
      if (e.key === 'Escape' && expandedId) {
        setExpandedId(null);
        setSelectedIdx(null);
        return;
      }
      
      if (e.key === 'ArrowRight') {
        setSelectedIdx((idx) => {
          const newIdx = idx === null ? 0 : Math.min(filteredSorted.length - 1, idx + 1);
          setExpandedId(filteredSorted[newIdx]?.id || null);
          return newIdx;
        });
      } else if (e.key === 'ArrowLeft') {
        setSelectedIdx((idx) => {
          const newIdx = idx === null ? 0 : Math.max(0, idx - 1);
          setExpandedId(filteredSorted[newIdx]?.id || null);
          return newIdx;
        });
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filteredSorted, expandedId]);

  // When table changes, if expandedId is not present, set selectedIdx to null (but keep expandedId)
  useEffect(() => {
    if (expandedId && !filteredSorted.some(row => row.id === expandedId)) {
      setSelectedIdx(null);
    }
    // Do not update selectedIdx otherwise
  }, [filteredSorted, expandedId]);

  // Helper to extract a unique action id from the action or response/perfSummary
  function getApexActionUniqueId(action: unknown, response: unknown, perfSummary: unknown): string | undefined {
    // Try to get id from action (Salesforce often uses 'id' or 'actionId')
    if (action && typeof action === 'object') {
      const act = action as Record<string, unknown>;
      if ('id' in act && typeof act.id === 'string') return act.id;
      if ('actionId' in act && typeof act.actionId === 'string') return act.actionId;
    }
    // Try to get id from response (sometimes present)
    if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;
      if ('id' in resp && typeof resp.id === 'string') return resp.id;
      if ('actionId' in resp && typeof resp.actionId === 'string') return resp.actionId;
    }
    // Try to get id from perfSummary (sometimes present as a key)
    if (perfSummary && typeof perfSummary === 'object') {
      for (const key of Object.keys(perfSummary as object)) {
        if (/^[a-zA-Z0-9_-]{10,}$/.test(key)) return key;
      }
    }
    return undefined;
  }

  // Helper for copying JSON to clipboard (works in DevTools panel)
  // Shows a toast after copy
  const [copiedToast, setCopiedToast] = useState<{ id: string; x: number; y: number } | null>(null);
  function copyJsonToClipboard(data: unknown, toastId?: string, evt?: React.MouseEvent) {
    try {
      if (typeof data === 'undefined') {
        return;
      }
      const json = JSON.stringify(data, null, 2);
      // Legacy workaround: use textarea + execCommand('copy')
      const textarea = document.createElement('textarea');
      textarea.value = json;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      // Show toast if requested
      if (toastId && evt) {
        const rect = (evt.target as HTMLElement).getBoundingClientRect();
        setCopiedToast({ id: toastId, x: rect.left + rect.width / 2, y: rect.top });
        setTimeout(() => setCopiedToast(null), 1200);
      }
    } catch {
      // Do nothing on failure
    }
  }

  // Get the currently selected row for detail view
  const selectedRow = expandedId ? filteredSorted.find(row => row.id === expandedId) : null;

  return (
    <div className={
      'p-4 bg-white dark:bg-gray-900 min-h-screen transition-colors duration-300 text-gray-900 dark:text-gray-100 overflow-x-hidden'
    }>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-2 overflow-hidden">
        <div id='options-bar' className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-2 md:mb-0 flex-shrink-0">Apex Inspector</h1>
          {/* Visual/Aesthetic Controls Grouped Left */}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {/* Settings icon button */}
            <button
              className="p-2 rounded-lg text-sm border font-medium shadow-sm focus:outline-none focus:ring-2 transition-colors duration-200 bg-gray-500 text-white border-gray-500 hover:bg-gray-600 focus:ring-gray-400 flex-shrink-0"
              onClick={() => {
                if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
                  chrome.runtime.openOptionsPage();
                } else {
                  window.open('options.html', '_blank');
                }
              }}
              title="Open all settings in a new tab"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
                <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
              </svg>
            </button>
            {/* Theme toggle */}
            <button
              className={`px-2 py-1 rounded text-xs border transition-colors duration-200 flex-shrink-0 ${theme === 'dark' ? 'bg-gray-800 text-white border-gray-600 hover:bg-gray-700' : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-300'}`}
              onClick={() => saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
            {/* JSON View Theme Dropdown */}
            <div className="flex items-center gap-1 min-w-0">
              <label className="text-xs text-gray-500 dark:text-gray-300 flex-shrink-0" htmlFor="json-theme-select">JSON Theme:</label>
              <select
                id="json-theme-select"
                className="px-2 py-1 rounded text-xs border dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-gray-100 text-gray-900 border-gray-300 min-w-0"
                value={jsonViewTheme}
                onChange={e => saveSettings({ jsonViewTheme: e.target.value as typeof jsonViewTheme })}
                style={{ minWidth: 100, maxWidth: 120 }}
              >
                {["default", "a11y", "github", "vscode", "atom", "winter-is-coming"].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {/* Navigation/Row Counter and Clear Button Grouped Right, plus Search right-aligned */}
        <div className="flex items-center gap-2 mt-2 md:mt-0 flex-wrap min-w-0">
          {/* Search Request/Response input right-aligned */}
          <div className="flex items-center gap-2 min-w-0">
            <label htmlFor="body-search" className="text-xs text-gray-500 dark:text-gray-300 flex-shrink-0 hidden sm:block">Search:</label>
            <input
              id="body-search"
              type="text"
              className="px-2 py-1 rounded text-xs border dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-gray-100 text-gray-900 border-gray-300 min-w-0"
              placeholder="Search request or response..."
              value={bodySearch}
              onChange={e => setBodySearch(e.target.value)}
              style={{ minWidth: 150, maxWidth: 200 }}
            />
          </div>
          {/* Navigation/Row Counter and Clear Button */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              className={`px-2 py-1 rounded text-xs border transition-colors duration-200 ${theme === 'dark' ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600' : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-300'}`}
              onClick={() => {
                setSelectedIdx((idx) => {
                  const newIdx = idx !== null ? Math.max(0, idx - 1) : 0;
                  if (expandedId) {
                    setExpandedId(filteredSorted[newIdx]?.id || null);
                  }
                  return newIdx;
                });
              }}
              disabled={selectedIdx === null || selectedIdx === 0}
            >
              ←
            </button>
            <button
              className={`px-2 py-1 rounded text-xs border transition-colors duration-200 ${theme === 'dark' ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600' : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-300'}`}
              onClick={() => {
                setSelectedIdx((idx) => {
                  const newIdx = idx !== null ? Math.min(filteredSorted.length - 1, idx + 1) : 0;
                  if (expandedId) {
                    setExpandedId(filteredSorted[newIdx]?.id || null);
                  }
                  return newIdx;
                });
              }}
              disabled={selectedIdx === null || selectedIdx === filteredSorted.length - 1}
            >
              →
            </button>
            <span className="text-xs text-gray-500 whitespace-nowrap">Row {selectedIdx !== null ? selectedIdx + 1 : ''} / {filteredSorted.length}</span>
            {/* Clear button */}
            <button
              className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
              onClick={() => {
                setActions([]);
                setExpandedId(null);
                setSelectedIdx(null);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
      
      {/* Conditionally render table or detail view */}
      {selectedRow ? (
        // Detail View - Full overlay
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg shadow-lg">
          {/* Header with summary info and close button */}
          <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
            <div className="flex items-center gap-4 flex-1">
              <div className="flex items-center gap-2">
                {selectedRow.error && <span title="Apex Error" className="text-red-600 dark:text-red-400">⛔</span>}
                <h2 className="text-lg font-semibold">{selectedRow.apexClass}.{selectedRow.method}</h2>
                {selectedRow.boxcarId && (
                  <span
                    title={`Boxcarred Request\nID: ${selectedRow.boxcarId}`}
                    className="inline-block align-middle text-indigo-600 dark:text-indigo-400"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.2"/></svg>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span>Time: {new Date(selectedRow.timestamp).toLocaleTimeString([], { timeZoneName: 'short' })}</span>
                <span>Latency: {selectedRow.latency}ms</span>
                {selectedRow.error && <span className="text-red-600 dark:text-red-400">Error: {selectedRow.error}</span>}
              </div>
            </div>
            <button
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors duration-200"
              onClick={() => {
                setExpandedId(null);
                setSelectedIdx(null);
              }}
              title="Close detail view (Escape)"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Detail content */}
          <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            {selectedRow.apexClass === '[Unparsed] ApexAction' && selectedRow.method === '[Unparsed] execute' ? (
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3">Raw Apex Action Data</h3>
                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm overflow-x-auto border dark:border-gray-700" style={{ minHeight: minRawDataHeight }}>
                  <React18JsonView 
                    src={{ rawRequest: selectedRow.rawRequest, rawResponse: selectedRow.rawResponse, fullRequest: selectedRow.fullRequest, fullResponse: selectedRow.fullResponse }} 
                    collapsed={2} 
                    enableClipboard={false} 
                    dark={jsonViewDark} 
                    theme={jsonViewTheme} 
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Request/Response section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* Request Parameters */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-lg font-semibold">Request Parameters</h3>
                      <button
                        className="p-1 text-gray-500 hover:text-blue-600 transition-colors duration-200"
                        title="Copy JSON to clipboard"
                        onClick={e => copyJsonToClipboard(selectedRow.request, selectedRow.id + '-req', e)}
                      >
                        <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
                          <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor"/>
                          <path d="M6 2.75A1.25 1.25 0 0 1 7.25 1.5h3.5A1.25 1.25 0 0 1 12 2.75v3.5" stroke="currentColor"/>
                        </svg>
                      </button>
                      {copiedToast && copiedToast.id === selectedRow.id + '-req' && (
                        <span className="absolute z-50 text-xs bg-black text-white rounded px-2 py-1 animate-fade-in-out" style={{ pointerEvents: 'none' }}>Copied!</span>
                      )}
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm overflow-x-auto border dark:border-gray-700" style={{ minHeight: 300 }}>
                      <React18JsonView src={selectedRow.request} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                    </div>
                  </div>

                  {/* Response */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-lg font-semibold">Response</h3>
                      <button
                        className="p-1 text-gray-500 hover:text-blue-600 transition-colors duration-200"
                        title="Copy JSON to clipboard"
                        onClick={e => copyJsonToClipboard(selectedRow.response, selectedRow.id + '-resp', e)}
                      >
                        <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
                          <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor"/>
                          <path d="M6 2.75A1.25 1.25 0 0 1 7.25 1.5h3.5A1.25 1.25 0 0 1 12 2.75v3.5" stroke="currentColor"/>
                        </svg>
                      </button>
                      {copiedToast && copiedToast.id === selectedRow.id + '-resp' && (
                        <span className="absolute z-50 text-xs bg-black text-white rounded px-2 py-1 animate-fade-in-out" style={{ pointerEvents: 'none' }}>Copied!</span>
                      )}
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm overflow-x-auto border dark:border-gray-700" style={{ minHeight: 300 }}>
                      <React18JsonView src={selectedRow.response} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                    </div>
                  </div>
                </div>

                {/* Timing/Performance section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* Timing Table */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Timing</h3>
                    <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody>
                          {(() => {
                            const timingMap: { key: string; label: string }[] = [
                              { key: 'blocked', label: 'Stalled' },
                              { key: 'dns', label: 'DNS Lookup' },
                              { key: 'connect', label: 'Initial connection' },
                              { key: 'ssl', label: 'SSL' },
                              { key: 'send', label: 'Request sent' },
                              { key: 'wait', label: 'Waiting for server response' },
                              { key: 'receive', label: 'Content Download' },
                            ];
                            const req = selectedRow.fullRequest as { timings?: { [key: string]: number } };
                            const timings = req && req.timings && typeof req.timings === 'object' ? req.timings : undefined;
                            if (timings) {
                              return timingMap.map(({ key, label }) => {
                                const val = timings[key];
                                if (typeof val !== 'number' || val < 0) return null;
                                return (
                                  <tr key={key}>
                                    <td className="border px-3 py-2 font-semibold bg-gray-50 dark:bg-gray-800 dark:border-gray-700">{label}</td>
                                    <td className="border px-3 py-2 dark:border-gray-700">{val.toFixed(2)} ms</td>
                                  </tr>
                                );
                              });
                            } else {
                              return (
                                <tr><td className="border px-3 py-2 dark:border-gray-700" colSpan={2}>No timing data</td></tr>
                              );
                            }
                          })()}
                          {typeof selectedRow.latency === 'number' ? (
                            <tr>
                              <td className="border px-3 py-2 font-semibold bg-gray-50 dark:bg-gray-800 dark:border-gray-700">Total Latency</td>
                              <td className="border px-3 py-2 dark:border-gray-700">{selectedRow.latency} ms</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Performance Summary */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Performance Summary</h3>
                    {(() => {
                      const perfSummary = selectedRow.fullResponse && typeof selectedRow.fullResponse === 'object' && 'perfSummary' in selectedRow.fullResponse ? (selectedRow.fullResponse as Record<string, unknown>).perfSummary : undefined;
                      if (!isPerfSummary(perfSummary)) {
                        return <div className="text-sm text-gray-500 dark:text-gray-400">No performance summary data</div>;
                      }
                      const topFields: Array<{ key: keyof typeof perfSummary; label: string }> = [
                        { key: 'version', label: 'Version' },
                        { key: 'request', label: 'Request' },
                        { key: 'actionsTotal', label: 'Actions Total' },
                        { key: 'overhead', label: 'Overhead' },
                      ];
                      const actions = perfSummary.actions && typeof perfSummary.actions === 'object' ? perfSummary.actions : {};
                      return (
                        <div className="space-y-4">
                          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <tbody>
                                {topFields.map(({ key, label }) => (
                                  key in perfSummary ? (
                                    <tr key={label}>
                                      <td className="border px-3 py-2 font-semibold bg-gray-50 dark:bg-gray-800 dark:border-gray-700">{label}</td>
                                      <td className="border px-3 py-2 dark:border-gray-700">{String(perfSummary[key])}</td>
                                    </tr>
                                  ) : null
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr>
                                  <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">Action</th>
                                  <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">Total</th>
                                  <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">DB</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(actions).map(([actKey, actVal]) => {
                                  if (actVal && typeof actVal === 'object' && 'total' in actVal && 'db' in actVal) {
                                    return (
                                      <tr key={actKey}>
                                        <td className="border px-3 py-2 font-mono dark:border-gray-700">{actKey}</td>
                                        <td className="border px-3 py-2 dark:border-gray-700">{(actVal as { total?: number }).total ?? ''}</td>
                                        <td className="border px-3 py-2 dark:border-gray-700">{(actVal as { db?: number }).db ?? ''}</td>
                                      </tr>
                                    );
                                  }
                                  return null;
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Initiator section */}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-3">Initiator (Call Stack)</h3>
                  <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">Function</th>
                            <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const req = selectedRow.fullRequest as Record<string, unknown> | undefined;
                            let frames: Array<{ functionName?: string; url?: string; lineNumber?: number }> = [];
                            const initiator = req && typeof req === 'object' && '_initiator' in req && req._initiator && typeof req._initiator === 'object'
                              ? req._initiator as Record<string, unknown>
                              : req && typeof req === 'object' && 'initiator' in req && req.initiator && typeof req.initiator === 'object'
                              ? req.initiator as Record<string, unknown>
                              : undefined;
                            
                            if (initiator && 'stack' in initiator && initiator.stack && typeof initiator.stack === 'object') {
                              const stack = initiator.stack as Record<string, unknown>;
                              if ('callFrames' in stack && Array.isArray(stack.callFrames)) {
                                frames = stack.callFrames.map(f => ({
                                  functionName: typeof f.functionName === 'string' ? f.functionName : undefined,
                                  url: typeof f.url === 'string' ? f.url : undefined,
                                  lineNumber: typeof f.lineNumber === 'number' ? f.lineNumber : undefined,
                                }));
                              }
                            }
                            
                            if (!frames.length && initiator && 'callFrames' in initiator && Array.isArray(initiator.callFrames)) {
                              frames = initiator.callFrames.map(f => ({
                                functionName: typeof f.functionName === 'string' ? f.functionName : undefined,
                                url: typeof f.url === 'string' ? f.url : undefined,
                                lineNumber: typeof f.lineNumber === 'number' ? f.lineNumber : undefined,
                              }));
                            }
                            
                            if (!frames.length && initiator && 'stackTrace' in initiator && initiator.stackTrace && typeof initiator.stackTrace === 'object') {
                              const stackTrace = initiator.stackTrace as Record<string, unknown>;
                              if ('frames' in stackTrace && Array.isArray(stackTrace.frames)) {
                                frames = stackTrace.frames.map(f => ({
                                  functionName: typeof f.function === 'string' ? f.function : undefined,
                                  url: typeof f.url === 'string' ? f.url : undefined,
                                  lineNumber: typeof f.line === 'number' ? f.line : undefined,
                                }));
                              }
                            }
                            
                            if (!frames.length) return <tr><td className="border px-3 py-2 dark:border-gray-700" colSpan={2}>No initiator data</td></tr>;
                            
                            return frames.map((frame, idx) => (
                              <tr key={idx}>
                                <td className="border px-3 py-2 font-mono dark:border-gray-700">{frame.functionName || '(anonymous)'}</td>
                                <td className="border px-3 py-2 font-mono dark:border-gray-700">
                                  {frame.url ? (
                                    <a
                                      href={(() => {
                                        let url = frame.url;
                                        if (typeof frame.lineNumber === 'number') {
                                          url += `:${frame.lineNumber}`;
                                        }
                                        return url;
                                      })()}
                                      rel="noopener noreferrer"
                                      className="text-blue-600 underline hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-400"
                                      title={frame.url}
                                      onClick={e => {
                                        if (frame.url) {
                                          e.preventDefault();
                                          if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.panels && typeof chrome.devtools.panels.openResource === 'function') {
                                            let line = 1;
                                            if (typeof frame.lineNumber === 'number') {
                                              line = frame.lineNumber;
                                            }
                                            chrome.devtools.panels.openResource(frame.url, line, function () {});
                                          }
                                          return;
                                        }
                                        e.stopPropagation();
                                      }}
                                    >
                                      {frame.url}
                                      {typeof frame.lineNumber === 'number' ? `:${frame.lineNumber}` : ''}
                                    </a>
                                  ) : null}
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Context section - collapsible */}
                <details className="mb-6">
                  <summary className="cursor-pointer text-lg font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mb-3 flex items-center gap-2">
                    Context Metadata
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="transition-transform duration-200">
                      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                    </svg>
                  </summary>
                  <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {selectedRow.context && typeof selectedRow.context === 'object' && selectedRow.context !== null ? (
                          Object.entries(selectedRow.context).filter(([key]) => key !== 'perf').map(([key, value]) => (
                            <tr key={key}>
                              <td className="border px-3 py-2 font-semibold bg-gray-50 dark:bg-gray-800 dark:border-gray-700 w-1/4">{key}</td>
                              <td className="border px-3 py-2 dark:border-gray-700 font-mono text-xs">{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr><td className="border px-3 py-2 dark:border-gray-700" colSpan={2}>No context data</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>

                {/* Raw Data section - collapsible */}
                <details>
                  <summary className="cursor-pointer text-lg font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mb-3 flex items-center gap-2">
                    View Raw Data
                    <button
                      className="p-1 text-gray-500 hover:text-blue-600 transition-colors duration-200"
                      title="Copy all raw data to clipboard"
                      onClick={e => {
                        e.stopPropagation();
                        copyJsonToClipboard({
                          fullRequest: selectedRow.fullRequest,
                          fullResponse: selectedRow.fullResponse
                        }, selectedRow.id + '-raw', e);
                      }}
                    >
                      <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
                        <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor"/>
                        <path d="M6 2.75A1.25 1.25 0 0 1 7.25 1.5h3.5A1.25 1.25 0 0 1 12 2.75v3.5" stroke="currentColor"/>
                      </svg>
                    </button>
                    {copiedToast && copiedToast.id === selectedRow.id + '-raw' && (
                      <span className="absolute z-50 text-xs bg-black text-white rounded px-2 py-1 animate-fade-in-out" style={{ pointerEvents: 'none' }}>Copied!</span>
                    )}
                  </summary>
                  <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-xs overflow-x-auto border dark:border-gray-700" style={{ minHeight: minRawDataHeight }}>
                    <div className="mb-4">
                      <h4 className="font-semibold mb-2">Full HTTP Request:</h4>
                      <React18JsonView src={selectedRow.fullRequest} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">Full HTTP Response:</h4>
                      <React18JsonView src={selectedRow.fullResponse} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                    </div>
                  </div>
                </details>
              </>
            )}
          </div>
        </div>
      ) : (
        // Table View
        <div className="w-full overflow-hidden">
          <table className="w-full border dark:border-gray-700 table-auto">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="border px-2 py-1 cursor-pointer select-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 min-w-0"
                    onClick={() => {
                      setSortKey(col.key);
                      setSortAsc((asc) => (sortKey === col.key ? !asc : true));
                    }}
                  >
                    <div className="truncate">
                      {col.label}
                      {sortKey === col.key ? (sortAsc ? " ▲" : " ▼") : null}
                    </div>
                    <div>
                      <input
                        className="w-full text-xs border rounded px-1 mt-1 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 min-w-0"
                        placeholder={`Filter ${col.label}`}
                        value={filter[col.key] || ""}
                        onChange={(e) => setFilter((f) => ({ ...f, [col.key]: e.target.value }))}
                        onFocus={(e) => {
                          // Prevent row selection when focusing filter input
                          e.stopPropagation();
                        }}
                      />
                    </div>
                  </th>
                ))}
                <th className="border px-2 py-1 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 text-center w-20">
                  <div className="truncate">Boxcar</div>
                  <a
                    href="/info.html#boxcar-info"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 align-middle"
                    title="What is a boxcarred request?"
                    style={{ display: 'inline-block', verticalAlign: 'middle' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 2, marginBottom: 2, verticalAlign: 'middle' }}>
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="#fff" />
                      <text x="8" y="12" textAnchor="middle" fontSize="10" fill="#555">?</text>
                    </svg>
                  </a>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row, i) => (
                <tr
                  key={row.id}
                  tabIndex={-1}
                  className={`hover:bg-gray-100 cursor-pointer${selectedIdx === i ? ' bg-blue-50 dark:bg-gray-800' : ''}${row.error ? ' bg-red-50 dark:bg-red-900' : ''} dark:hover:bg-gray-800`}
                  onClick={() => {
                    // Set both expandedId and selectedIdx together
                    if (expandedId === row.id) {
                      setExpandedId(null);
                      setSelectedIdx(null);
                    } else {
                      setExpandedId(row.id);
                      setSelectedIdx(i);
                    }
                  }}
                >
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 min-w-0">
                    <div className="flex items-center gap-1 truncate">
                      {row.error && <span title="Apex Error" className="inline-block align-middle text-red-600 dark:text-red-400 flex-shrink-0">⛔</span>}
                      <span className="truncate">{new Date(row.timestamp).toLocaleTimeString([], { timeZoneName: 'short' })}</span>
                    </div>
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 min-w-0">
                    <div className="truncate" title={row.apexClass}>{row.apexClass}</div>
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 min-w-0">
                    <div className="truncate" title={row.method}>{row.method}</div>
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 w-20">
                    <div className="truncate">{row.latency}</div>
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 text-center w-20">
                    {row.boxcarId && (
                      <span
                        title={`Boxcarred Request\nID: ${row.boxcarId}`}
                        className="inline-block align-middle text-indigo-600 dark:text-indigo-400"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.2"/></svg>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Type guard for perfSummary
function isPerfSummary(obj: unknown): obj is {
  version?: unknown;
  request?: unknown;
  actionsTotal?: unknown;
  overhead?: unknown;
  actions?: Record<string, { total?: number; db?: number }>;
} {
  return !!obj && typeof obj === 'object' && 'actions' in obj;
}

export default DevtoolsPanel;

/* Add fade-in-out animation for the toast */
// In your CSS (e.g., local.css or global.css):
// .animate-fade-in-out {
//   animation: fadeInOut 1.2s;
// }
// @keyframes fadeInOut {
//   0% { opacity: 0; transform: translateY(-8px); }
//   10% { opacity: 1; transform: translateY(0); }
//   90% { opacity: 1; transform: translateY(0); }
//   100% { opacity: 0; transform: translateY(-8px); }
// }
