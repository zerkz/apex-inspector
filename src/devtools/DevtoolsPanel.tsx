import React, { useEffect, useState, useMemo } from "react";
import React18JsonView from 'react18-json-view';
import 'react18-json-view/src/style.css';
import { useOptionsSettings } from '../chrome-extension/options/useOptionsSettings';
import type { FullRequest, FullResponse } from './networkTypes';

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
          if (request.request.postData?.mimeType?.includes('application/x-www-form-urlencoded')) {
            // Parse URL-encoded form data
            const params = new URLSearchParams(request.request.postData.text || '');
            const message = params.get('message');
            if (message) {
              reqPostData = JSON.parse(message);
            }
          } else {
            // Try to parse as JSON directly
            reqPostData = JSON.parse(request.request.postData?.text || 'null');
          }
          const resJson = JSON.parse(request.response?.content?.text || "null");
          console.debug('[Apex Inspector] Parsed postData:', reqPostData);
          console.debug('[Apex Inspector] Parsed response:', resJson);
          // Type guard for reqPostData
          if (
            reqPostData &&
            typeof reqPostData === 'object' &&
            reqPostData !== null &&
            Array.isArray((reqPostData as { actions?: unknown[] }).actions)
          ) {
            const actionsArr = (reqPostData as { actions: unknown[] }).actions;
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
                let responseObj = resJson.actions?.[idx]?.returnValue || {};
                const rawResp = resJson.actions?.[idx] || {};
                if (rawResp && typeof rawResp === 'object') {
                  if (rawResp.state === 'ERROR') {
                    // Extract all error details, not just the message
                    let errorDetails: Record<string, unknown> = {};
                    let errorMsg = 'Unknown Apex error';
                    
                    // Handle error array (most common Salesforce format)
                    if (Array.isArray(rawResp.error) && rawResp.error.length > 0) {
                      const errorObj = rawResp.error[0];
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
                    else if (Array.isArray(rawResp.errors) && rawResp.errors.length > 0) {
                      const errorObj = rawResp.errors[0];
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
                    else if (rawResp.error && typeof rawResp.error === 'object') {
                      errorDetails = { ...rawResp.error };
                      if ('message' in rawResp.error && typeof rawResp.error.message === 'string') {
                        errorMsg = rawResp.error.message;
                      }
                    }
                    // Handle string error
                    else if (typeof rawResp.error === 'string') {
                      errorMsg = rawResp.error;
                      errorDetails = { message: errorMsg };
                    }
                    // Fallback
                    else {
                      errorDetails = { message: errorMsg };
                    }
                    
                    error = errorMsg;
                    // Compose the response object with all error details flattened at the top level
                    responseObj = { ...errorDetails, ...resJson.actions?.[idx]?.returnValue };
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
                        getApexActionUniqueId(action, resJson.actions?.[idx], resJson.perfSummary) ||
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
                      rawResponse: resJson.actions?.[idx] || {},
                      context: resJson.context || {},
                      network: {
                        requestId: request.requestId || request.request.url,
                        url: request.request.url,
                        latency: request.time,
                      },
                      fullResponse: resJson, // Store the full HTTP response
                      fullRequest: request, // Store the full HTTP request
                      error, // Add error property
                    },
                  ]);
                } else {
                  // Could not parse class/method, but still show a row with raw data only
                  setActions((prev) => [
                    ...prev,
                    {
                      id:
                        getApexActionUniqueId(action, resJson.actions?.[idx], resJson.perfSummary) ||
                        (request.requestId || request.request.url) + "-" + idx,
                      timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                      apexClass: '[Unparsed] ApexAction',
                      method: '[Unparsed] execute',
                      latency: request.time,
                      request: {},
                      response: {},
                      rawRequest: action,
                      rawResponse: resJson.actions?.[idx] || {},
                      context: {},
                      network: {
                        requestId: request.requestId || request.request.url,
                        url: request.request.url,
                        latency: request.time,
                      },
                      fullResponse: resJson,
                      fullRequest: request,
                      error: 'Could not parse Apex class/method. See raw data.',
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

  // Keyboard navigation for left/right
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (filteredSorted.length === 0) return;
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
  }, [filteredSorted]);

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

  return (
    <div className={
      'p-4 bg-white dark:bg-gray-900 min-h-screen transition-colors duration-300 text-gray-900 dark:text-gray-100'
    }>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
        <div className="flex items-center gap-4 flex-1">
          <h1 className="text-2xl font-bold mb-2 md:mb-0">Apex Inspector</h1>
          {/* Visual/Aesthetic Controls Grouped Left */}
          <div className="flex items-center gap-2 ml-2">
            {/* Theme toggle */}
            <button
              className={`px-2 py-1 rounded text-xs border transition-colors duration-200 ${theme === 'dark' ? 'bg-gray-800 text-white border-gray-600 hover:bg-gray-700' : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-300'}`}
              onClick={() => saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
            {/* JSON View Theme Dropdown */}
            <label className="ml-2 text-xs text-gray-500 dark:text-gray-300" htmlFor="json-theme-select">JSON View Theme:</label>
            <select
              id="json-theme-select"
              className="ml-1 px-2 py-1 rounded text-xs border dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-gray-100 text-gray-900 border-gray-300"
              value={jsonViewTheme}
              onChange={e => saveSettings({ jsonViewTheme: e.target.value as typeof jsonViewTheme })}
              style={{ minWidth: 120 }}
            >
              {["default", "a11y", "github", "vscode", "atom", "winter-is-coming"].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {/* Min Height for Raw Data */}
            {/* Replace min height input with All Settings button */}
            <button
              className={`ml-2 px-3 py-2 rounded-lg text-sm border font-medium shadow-sm focus:outline-none focus:ring-2 transition-colors duration-200
                ${theme === 'dark'
                  ? 'bg-slate-700 text-white border-slate-500 hover:bg-indigo-700 focus:ring-indigo-500'
                  : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 focus:ring-indigo-400'
                }`}
              onClick={() => {
                if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
                  chrome.runtime.openOptionsPage();
                } else {
                  window.open('options.html', '_blank');
                }
              }}
              title="Open all settings in a new tab"
            >
              All Settings
            </button>
          </div>
        </div>
        {/* Navigation/Row Counter and Clear Button Grouped Right, plus Search right-aligned */}
        <div className="flex items-center gap-4 mt-2 md:mt-0">
          {/* Search Request/Response input right-aligned */}
          <div className="flex items-center gap-2">
            <label htmlFor="body-search" className="text-xs text-gray-500 dark:text-gray-300">Search Request/Response:</label>
            <input
              id="body-search"
              type="text"
              className="px-2 py-1 rounded text-xs border dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-gray-100 text-gray-900 border-gray-300 min-w-[200px]"
              placeholder="Search request or response body..."
              value={bodySearch}
              onChange={e => setBodySearch(e.target.value)}
            />
          </div>
          {/* Navigation/Row Counter and Clear Button */}
          <button
            className={`px-2 py-1 rounded text-xs border transition-colors duration-200 ${theme === 'dark' ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600' : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-300'}`}
            onClick={() => setSelectedIdx((idx) => idx !== null ? Math.max(0, idx - 1) : 0)}
            disabled={selectedIdx === null || selectedIdx === 0}
          >
            ←
          </button>
          <button
            className={`px-2 py-1 rounded text-xs border transition-colors duration-200 ${theme === 'dark' ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600' : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-300'}`}
            onClick={() => setSelectedIdx((idx) => idx !== null ? Math.min(filteredSorted.length - 1, idx + 1) : 0)}
            disabled={selectedIdx === null || selectedIdx === filteredSorted.length - 1}
          >
            →
          </button>
          <span className="text-xs text-gray-500">Row {selectedIdx !== null ? selectedIdx + 1 : ''} / {filteredSorted.length}</span>
          {/* Clear button */}
          <button
            className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 ml-2"
            onClick={() => setActions([])}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border dark:border-gray-700">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="border px-2 py-1 cursor-pointer select-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                  onClick={() => {
                    setSortKey(col.key);
                    setSortAsc((asc) => (sortKey === col.key ? !asc : true));
                  }}
                >
                  {col.label}
                  {sortKey === col.key ? (sortAsc ? " ▲" : " ▼") : null}
                  <div>
                    <input
                      className="w-full text-xs border rounded px-1 mt-1 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"
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
              <th className="border px-2 py-1 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((row, i) => (
              <React.Fragment key={row.id}>
                <tr
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
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 flex items-center gap-1">
                    {row.error && <span title="Apex Error" className="inline-block align-middle text-red-600 dark:text-red-400">⛔</span>}
                    {new Date(row.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100">{row.apexClass}</td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100">{row.method}</td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100">{row.latency}</td>
                  <td className="border px-2 py-1 text-blue-600 underline dark:bg-gray-900 dark:border-gray-700 dark:text-blue-300">{expandedId === row.id ? "Hide" : "View"}</td>
                </tr>
                {/* Only expand if expandedId is present in filteredSorted */}
                {expandedId && row.id === expandedId && (
                  <tr>
                    <td colSpan={columns.length + 1} className="bg-gray-50 border-t p-2 dark:bg-gray-800 dark:border-gray-700">
                      {/* Error details if present */}
                      {row.apexClass === '[Unparsed] ApexAction' && row.method === '[Unparsed] execute' ? (
                        <div className="mb-2">
                          <strong>Raw Apex Action Data:</strong>
                          <div className="bg-gray-200 p-2 rounded text-xs overflow-x-auto max-h-60 min-h-[220px] dark:bg-gray-800 dark:text-gray-100 border dark:border-gray-700">
                            <React18JsonView src={{ rawRequest: row.rawRequest, rawResponse: row.rawResponse, fullRequest: row.fullRequest, fullResponse: row.fullResponse }} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                          </div>
                        </div>
                      ) : (
                        /* Responsive grid layout for row panel */
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                          {/* Request Parameters */}
                          <div>
                            <strong>Request Parameters:</strong>
                            <button
                              className="ml-2 align-middle text-gray-500 hover:text-blue-600 relative"
                              title="Copy JSON to clipboard"
                              onClick={e => copyJsonToClipboard(row.request, row.id + '-req', e)}
                              style={{ verticalAlign: 'middle' }}
                            >
                              <svg width="16" height="16" fill="none" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor"/><path d="M6 2.75A1.25 1.25 0 0 1 7.25 1.5h3.5A1.25 1.25 0 0 1 12 2.75v3.5" stroke="currentColor"/></svg>
                            </button>
                            {copiedToast && copiedToast.id === row.id + '-req' && (
                              <span className="absolute z-50 text-xs bg-black text-white rounded px-2 py-1 left-8 top-0 animate-fade-in-out" style={{ pointerEvents: 'none' }}>Copied!</span>
                            )}
                            <div className="bg-gray-100 p-2 rounded text-xs overflow-x-auto max-h-40 min-h-[220px] dark:bg-gray-800 dark:text-gray-100 border dark:border-gray-700">
                              <React18JsonView src={row.request} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                            </div>
                          </div>
                          {/* Response - Focused summary for errors */}
                          <div>
                            <strong>Response:</strong>
                            <button
                              className="ml-2 align-middle text-gray-500 hover:text-blue-600 relative"
                              title="Copy JSON to clipboard"
                              onClick={e => copyJsonToClipboard(row.response, row.id + '-resp', e)}
                              style={{ verticalAlign: 'middle' }}
                            >
                              <svg width="16" height="16" fill="none" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor"/><path d="M6 2.75A1.25 1.25 0 0 1 7.25 1.5h3.5A1.25 1.25 0 0 1 12 2.75v3.5" stroke="currentColor"/></svg>
                            </button>
                            {copiedToast && copiedToast.id === row.id + '-resp' && (
                              <span className="absolute z-50 text-xs bg-black text-white rounded px-2 py-1 left-8 top-0 animate-fade-in-out" style={{ pointerEvents: 'none' }}>Copied!</span>
                            )}
                            <div className="bg-gray-100 p-2 rounded text-xs overflow-x-auto max-h-40 min-h-[220px] dark:bg-gray-800 dark:text-gray-100 border dark:border-gray-700">
                              {/* Always show the integrated response object which includes error as a sibling property */}
                              <React18JsonView src={row.response} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Responsive grid for performance/timing/context */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                        {/* Timing Table (vertical) */}
                        <div>
                          <strong>Timing:</strong>
                          <table className="min-w-[300px] text-xs border mt-2 dark:border-gray-700">
                            <tbody>
                              {(() => {
                                const timingMap: { key: string; label: string; color: string }[] = [
                                  { key: 'blocked', label: 'Stalled', color: '#bdbdbd' },
                                  { key: 'dns', label: 'DNS Lookup', color: '#90caf9' },
                                  { key: 'connect', label: 'Initial connection', color: '#a5d6a7' },
                                  { key: 'ssl', label: 'SSL', color: '#fbc02d' },
                                  { key: 'send', label: 'Request sent', color: '#64b5f6' },
                                  { key: 'wait', label: 'Waiting for server response', color: '#81c784' },
                                  { key: 'receive', label: 'Content Download', color: '#ba68c8' },
                                ];
                                const req = row.fullRequest as { timings?: { [key: string]: number } };
                                const timings = req && req.timings && typeof req.timings === 'object' ? req.timings : undefined;
                                if (timings) {
                                  const max = Math.max(...timingMap.map(({ key }) => typeof timings[key] === 'number' && timings[key] >= 0 ? timings[key] : 0));
                                  return timingMap.map(({ key, label, color }) => {
                                    const val = timings[key];
                                    if (typeof val !== 'number' || val < 0) return null;
                                    const width = max > 0 ? Math.max(5, (val / max) * 100) : 5;
                                    return (
                                      <tr key={key}>
                                        <td className="border px-2 py-1 font-semibold bg-gray-100 w-48 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">{label}</td>
                                        <td className="border px-2 py-1 bg-white w-24 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">{val.toFixed(2)} ms</td>
                                        <td className="border px-2 py-1 bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">
                                          <div style={{ background: color, width: `${width}%`, height: 8, borderRadius: 2 }} />
                                        </td>
                                      </tr>
                                    );
                                  });
                                } else {
                                  return (
                                    <tr><td className="border px-2 py-1" colSpan={3}>No timing data</td></tr>
                                  );
                                }
                              })()}
                              {/* Also show latency if available */}
                              {typeof row.latency === 'number' ? (
                                <tr>
                                  <td className="border px-2 py-1 font-semibold bg-gray-100 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">Total Latency (ms)</td>
                                  <td className="border px-2 py-1 bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">{row.latency}</td>
                                  <td className="border px-2 py-1 bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"></td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                        {/* Initiator Table (JS call stack/entrypoint) */}
                        <div>
                          <strong>Initiator:</strong>
                          <div className="overflow-y-auto mt-2 border dark:border-gray-700 rounded bg-white dark:bg-gray-900" style={{ maxHeight: 220, minHeight: 120 }}>
                            <table className="min-w-[220px] text-xs w-full">
                              <thead>
                                <tr>
                                  <th className="border px-2 py-1 bg-gray-100 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 text-left">Function</th>
                                  <th className="border px-2 py-1 bg-gray-100 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 text-left">Source</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(() => {
                                  const req = row.fullRequest as Record<string, unknown> | undefined;
                                  let frames: Array<{ functionName?: string; url?: string; lineNumber?: number }> = [];
                                  // Support both _initiator and initiator (Salesforce/Chrome)
                                  const initiator = req && typeof req === 'object' && '_initiator' in req && req._initiator && typeof req._initiator === 'object'
                                    ? req._initiator as Record<string, unknown>
                                    : req && typeof req === 'object' && 'initiator' in req && req.initiator && typeof req.initiator === 'object'
                                    ? req.initiator as Record<string, unknown>
                                    : undefined;
                                  // Chrome DevTools HAR: initiator.stack.callFrames
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
                                  // Chrome HAR: initiator.callFrames
                                  if (!frames.length && initiator && 'callFrames' in initiator && Array.isArray(initiator.callFrames)) {
                                    frames = initiator.callFrames.map(f => ({
                                      functionName: typeof f.functionName === 'string' ? f.functionName : undefined,
                                      url: typeof f.url === 'string' ? f.url : undefined,
                                      lineNumber: typeof f.lineNumber === 'number' ? f.lineNumber : undefined,
                                    }));
                                  }
                                  // Some HARs: initiator.stackTrace.frames
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
                                  if (!frames.length) return <tr><td className="border px-2 py-1" colSpan={2}>No initiator data</td></tr>;
                                  return frames.map((frame, idx) => (
                                    <tr key={idx}>
                                      <td className="border px-2 py-1 font-mono">{frame.functionName || '(anonymous)'}</td>
                                      <td className="border px-2 py-1 font-mono">
                                        {frame.url ? (
                                          <a
                                            href={(() => {
                                              // Try to preserve Chrome DevTools file/line/col navigation if possible
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
                                              // Let Chrome DevTools handle chrome-extension://, webpack://, and file:// URLs (will open in Sources tab)
                                              if (frame.url) {
                                                e.preventDefault();
                                                // Use chrome.devtools.panels.openResource if available
                                                if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.panels && typeof chrome.devtools.panels.openResource === 'function') {
                                                  // Try to extract line number if present
                                                  let line = 1;
                                                  if (typeof frame.lineNumber === 'number') {
                                                    line = frame.lineNumber;
                                                  }
                                                  chrome.devtools.panels.openResource(frame.url, line, function () {});
                                                }
                                                return;
                                              }
                                              // Otherwise, open in new tab
                                              e.stopPropagation();
                                            }}
                                          >
                                            {frame.url}
                                            {typeof frame.lineNumber === 'number' ? `:${frame.lineNumber}` : ''}
                                          </a>
                                        ) : ''}
                                      </td>
                                    </tr>
                                  ));
                                })()}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                      {/* Context Table (full width) */}
                      <details className="mb-2" style={{marginBottom: '0.5rem'}}>
                        <summary className="cursor-pointer text-xs text-blue-600 underline flex items-center gap-2 font-bold">
                          Context Metadata
                        </summary>
                        <div>
                          <table className="min-w-[200px] text-xs border mt-2">
                            <tbody>
                              {row.context && typeof row.context === 'object' && row.context !== null ? (
                                Object.entries(row.context).filter(([key]) => key !== 'perf').map(([key, value]) => (
                                  <tr key={key}>
                                    <td className="border px-2 py-1 font-semibold bg-gray-100 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">{key}</td>
                                    <td className="border px-2 py-1 bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr><td className="border px-2 py-1" colSpan={2}>No context</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </details>
                      {/* Raw Data Link at the very bottom */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-blue-600 underline flex items-center gap-2 font-bold">
                          View Raw Data
                          <button
                            className="align-middle text-gray-500 hover:text-blue-600 relative"
                            title="Copy all raw data to clipboard"
                            onClick={e => {
                              e.stopPropagation();
                              copyJsonToClipboard({
                                fullRequest: row.fullRequest,
                                fullResponse: row.fullResponse
                              }, row.id + '-raw', e);
                            }}
                            style={{ verticalAlign: 'middle' }}
                          >
                            <svg width="16" height="16" fill="none" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor"/><path d="M6 2.75A1.25 1.25 0 0 1 7.25 1.5h3.5A1.25 1.25 0 0 1 12 2.75v3.5" stroke="currentColor"/></svg>
                          </button>
                          {copiedToast && copiedToast.id === row.id + '-raw' && (
                            <span className="absolute z-50 text-xs bg-black text-white rounded px-2 py-1 left-8 top-0 animate-fade-in-out" style={{ pointerEvents: 'none' }}>Copied!</span>
                          )}
                        </summary>
                        <div className="bg-gray-200 p-2 rounded text-xs overflow-x-auto max-h-60 dark:bg-gray-800 dark:text-gray-100 border dark:border-gray-700"
                          style={{ minHeight: minRawDataHeight }}
                        >
                          <strong>Full HTTP Request:</strong>
                          <React18JsonView src={row.fullRequest} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                          <strong className="mt-2 block">Full HTTP Response:</strong>
                          <React18JsonView src={row.fullResponse} collapsed={2} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                        </div>
                      </details>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

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
