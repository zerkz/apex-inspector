import React, { useEffect, useState, useMemo } from "react";
import React18JsonView from 'react18-json-view';
import 'react18-json-view/src/style.css';
import { useOptionsSettings } from '../chrome-extension/options/useOptionsSettings';
import type { FullRequest, FullResponse } from './networkTypes';

// Simple UUID generator for boxcar grouping
function generateBoxcarId() {
  return 'boxcar-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Store last generated color for contrast checking and cache colors per boxcarId
let lastGeneratedHue: number | null = null;
const boxcarColorCache = new Map<string, string>();

// Calculate color difference for contrast (hue distance on color wheel)
function calculateHueDistance(hue1: number, hue2: number): number {
  const diff = Math.abs(hue1 - hue2);
  return Math.min(diff, 360 - diff); // Account for circular nature of hue
}

// Generate random colors for truck icons with high contrast from previous color
function generateTruckColor(boxcarId: string): string {
  // Check if we already have a color for this boxcarId
  if (boxcarColorCache.has(boxcarId)) {
    return boxcarColorCache.get(boxcarId)!;
  }
  
  // Use boxcarId as seed for consistent colors per boxcar group
  let hash = 0;
  for (let i = 0; i < boxcarId.length; i++) {
    const char = boxcarId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Generate base hue from hash
  let hue = Math.abs(hash) % 360;
  
  // Ensure high contrast with last generated color (minimum 60° difference)
  if (lastGeneratedHue !== null) {
    let attempts = 0;
    while (calculateHueDistance(hue, lastGeneratedHue) < 60 && attempts < 10) {
      // Adjust hue to create more contrast
      hash = (hash * 1103515245 + 12345) & 0x7fffffff; // Linear congruential generator
      hue = Math.abs(hash) % 360;
      attempts++;
    }
  }
  
  // Store this hue as the last generated for next comparison (only for new boxcarIds)
  lastGeneratedHue = hue;
  
  // Generate saturation and lightness with good visibility
  // TODO: Add user preference options for brightness control:
  // - allowBrightColors: boolean (default: true)
  // - maxLightness: number (default: 65, could be reduced to 55 for dimmer colors)
  // - minLightness: number (default: 45, could be increased to 35 for darker colors)
  const saturation = 65 + (Math.abs(hash) % 25); // 65-90%
  const lightness = 45 + (Math.abs(hash) % 20); // 45-65%
  
  const color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  
  // Cache the color for this boxcarId so all rows in the group get the same color
  boxcarColorCache.set(boxcarId, color);
  
  return color;
}

// Dynamic colored truck SVG component
function TruckIcon({ boxcarId, size = 16 }: { boxcarId: string; size?: number }) {
  const color = generateTruckColor(boxcarId);
  
  return (
    <img 
      src="/images/boxcar_truck.svg" 
      width={size} 
      height={size} 
      style={{ 
        filter: `brightness(0) saturate(100%) ${getColorFilter(color)}`,
        display: 'inline-block',
        verticalAlign: 'middle'
      }}
      alt="Truck icon"
    />
  );
}

// Helper function to convert HSL color to CSS filter
function getColorFilter(hslColor: string): string {
  // Extract hue, saturation, lightness from hsl(h, s%, l%) format
  const hslMatch = hslColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!hslMatch) return '';
  
  const hue = parseInt(hslMatch[1]);
  const saturation = parseInt(hslMatch[2]);
  const lightness = parseInt(hslMatch[3]);
  
  // Convert to CSS filter values
  // hue-rotate for hue, saturate for saturation, brightness for lightness
  return `hue-rotate(${hue}deg) saturate(${saturation / 100 + 0.5}) brightness(${lightness / 50})`;
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
  const { theme, jsonViewTheme, minRawDataHeight = 320, apexClassMappingsJson = '', alwaysExpandedJson = false } = settings;
  const [actions, setActions] = useState<ApexAction[]>([]);
  // Use expandedId as the only source of truth for expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortableKeys>("timestamp");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [filter, setFilter] = useState<Partial<Record<SortableKeys, string>>>({});
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [bodySearch, setBodySearch] = useState("");

  const jsonViewDark = theme === 'dark';
  // Calculate collapsed value: if alwaysExpandedJson is true, show everything (50 levels), otherwise default to 2
  const jsonViewCollapsed = alwaysExpandedJson ? 50 : 2;

  // Parse apex class mappings from settings
  const apexClassMappings = useMemo(() => {
    return parseApexClassMappings(apexClassMappingsJson);
  }, [apexClassMappingsJson]);

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
      if (event.data && (event.data.type === "network" || event.data.type === "lightning" || event.data.type === "community" || event.data.type === "vfremoting") && event.data.request) {
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
              console.debug('[Apex Inspector] Response is not JSON or missing, will process request-only. Content-Type:', contentType);
            }
          } catch (responseError) {
            console.debug('[Apex Inspector] Failed to parse response as JSON, will process request-only:', responseError);
            resJson = null;
          }

          console.debug('[Apex Inspector] Parsed postData:', reqPostData);
          console.debug('[Apex Inspector] Parsed response:', resJson);
          
          // Check if this is a webruntime/community call (different structure)
          const isWebruntimeCall = request.request.url.includes('/webruntime/api/apex/execute');
          
          // Skip processing if we don't have valid request data
          if (!reqPostData || typeof reqPostData !== 'object') {
            console.debug('[Apex Inspector] No valid request data found, skipping action processing');
            return;
          }

          if (isWebruntimeCall) {
            // Handle Community/Webruntime calls - completely different structure
            console.debug('[Apex Inspector] Processing webruntime/community call');
            
            // For webruntime calls, the request data is directly in reqPostData
            const webruntimeReq = reqPostData as {
              namespace?: string;
              classname?: string;
              method?: string;
              params?: Record<string, unknown>;
            };
            
            const originalApexClass = webruntimeReq.classname || '[Unknown Class]';
            const apexMethod = webruntimeReq.method || '[Unknown Method]';
            const namespace = webruntimeReq.namespace;
            
            // Check if this is an obfuscated Community Cloud class name (starts with @)
            const isObfuscated = originalApexClass.startsWith('@') && originalApexClass.includes('/');
            let actualClassName = originalApexClass;
            let helpTextInfo = null;
            
            if (isObfuscated) {
              // Extract the ID part (after the /)
              const idPart = originalApexClass.split('/')[1];
              
              // Try to resolve using the mappings
              if (idPart && apexClassMappings.has(idPart)) {
                actualClassName = apexClassMappings.get(idPart)!;
                console.debug(`[Apex Inspector] Resolved obfuscated class ${originalApexClass} to ${actualClassName}`);
              } else {
                // Show the ID part but indicate it's obfuscated
                actualClassName = idPart || originalApexClass;
                helpTextInfo = {
                  originalClassName: originalApexClass,
                  note: 'Class name is obfuscated in Community Cloud. Configure Apex Class Mappings in settings to see real names.',
                  needsMapping: true
                };
                console.debug(`[Apex Inspector] Could not resolve obfuscated class ${originalApexClass}, no mapping found for ID ${idPart}`);
              }
            }
            
            const fullClassName = namespace ? `${namespace}.${actualClassName}` : actualClassName;
            
            // Handle webruntime response which is typically direct JSON
            let responseObj: Record<string, unknown> = {};
            let error: string | null = null;
            
            if (resJson && typeof resJson === 'object') {
              const webResponse = resJson as Record<string, unknown>;
              responseObj = webResponse;
              
              // Check for errors in webruntime response
              if (webResponse.error || webResponse.errors || webResponse.isError) {
                error = 'Webruntime API error occurred';
                if (typeof webResponse.error === 'string') {
                  error = webResponse.error;
                } else if (Array.isArray(webResponse.errors) && webResponse.errors.length > 0) {
                  error = String(webResponse.errors[0]);
                }
              }
            }
            
            setActions((prev) => [
              ...prev,
              {
                id: `webruntime-${request.requestId || request.request.url}-${Date.now()}`,
                timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                apexClass: fullClassName,
                method: apexMethod,
                latency: request.time,
                request: webruntimeReq.params || {},
                response: responseObj,
                rawRequest: reqPostData,
                rawResponse: resJson || {},
                context: helpTextInfo || {},
                network: {
                  requestId: request.requestId || request.request.url,
                  url: request.request.url,
                  latency: request.time,
                },
                fullResponse: resJson as Record<string, unknown>,
                fullRequest: request,
                error,
                // No boxcarId for webruntime calls as they are typically single actions
              },
            ]);
            return; // Exit early for webruntime calls
          }

          // Check if this is a VisualForce Remoting call (different structure)
          const isVfRemotingCall = request.request.url.includes('/apexremote');
          
          if (isVfRemotingCall) {
            // Handle VisualForce Remoting calls
            console.debug('[Apex Inspector] Processing VisualForce Remoting call');
            
            // VisualForce Remoting request structure is an array of requests:
            // [
            //   {
            //     "action": "TestApexController",           // Apex class name
            //     "method": "simpleRemoteMethod",          // Method name
            //     "data": ["Hello World"],                 // Method parameters (array)
            //     "type": "rpc",                          // Always "rpc" for remoting
            //     "tid": 3,                               // Transaction ID
            //     "ctx": { ... }                          // Context (ignored per requirements)
            //   },
            //   // ... more requests
            // ]
            
            // Handle both single VF call and batch VF calls
            let vfRequests: unknown[] = [];
            if (Array.isArray(reqPostData)) {
              // Multiple VF remoting calls (batch)
              vfRequests = reqPostData;
            } else if (reqPostData && typeof reqPostData === 'object') {
              // Single VF remoting call - check if it has the VF structure
              const singleVfReq = reqPostData as Record<string, unknown>;
              if (singleVfReq.action && singleVfReq.method && singleVfReq.type === 'rpc') {
                // This is a single VF remoting call
                vfRequests = [reqPostData];
              } else {
                // Not a VF remoting call structure
                console.debug('[Apex Inspector] Request data does not match VF remoting structure:', reqPostData);
                return;
              }
            }
            
            console.debug('[Apex Inspector] Found VF Remoting requests:', vfRequests.length);
            
            // Parse response - can be single object or array depending on request
            let vfResponses: unknown[] = [];
            if (resJson && Array.isArray(resJson)) {
              // Multiple responses (corresponds to batch requests)
              vfResponses = resJson;
            } else if (resJson && typeof resJson === 'object') {
              // Single response (corresponds to single request)
              vfResponses = [resJson];
            }
            
            // Determine if this is a boxcarred request (more than one VF call)
            let boxcarId: string | undefined = undefined;
            if (vfRequests.length > 1) {
              boxcarId = generateBoxcarId();
            }
            
            // Process each VF remoting request
            vfRequests.forEach((vfReqItem: unknown, idx: number) => {
              if (vfReqItem && typeof vfReqItem === 'object') {
                const vfReq = vfReqItem as {
                  action?: string;
                  method?: string;
                  data?: unknown;
                  type?: string;
                  tid?: number;
                  ctx?: Record<string, unknown>; // We ignore this as per instructions
                };
                
                const apexClass = vfReq.action || '[Unknown Class]';
                const apexMethod = vfReq.method || '[Unknown Method]';
                const requestData = vfReq.data || {};
                
                console.debug(`[Apex Inspector] VF Remoting [${idx}] parsed - Class:`, apexClass, 'Method:', apexMethod, 'Data:', requestData);
                
                // Handle VF remoting response for this specific request
                let responseObj: Record<string, unknown> = {};
                let error: string | null = null;
                
                // Get the corresponding response for this request (by index)
                const vfResponse = vfResponses[idx];
                if (vfResponse && typeof vfResponse === 'object') {
                  const vfRespObj = vfResponse as Record<string, unknown>;
                  
                  // Check if response has an 'error' field indicating an error occurred
                  if (vfRespObj.error) {
                    error = 'VisualForce Remoting error occurred';
                    if (typeof vfRespObj.error === 'string') {
                      error = vfRespObj.error;
                    } else if (typeof vfRespObj.error === 'object' && vfRespObj.error !== null) {
                      const errorObj = vfRespObj.error as Record<string, unknown>;
                      if (errorObj.message && typeof errorObj.message === 'string') {
                        error = errorObj.message;
                      }
                    }
                    responseObj = vfRespObj;
                  } else {
                    // For successful VF remoting calls, the response often contains a 'result' field
                    // or the data might be directly in the response - we'll store the whole response
                    responseObj = vfRespObj;
                  }
                }
                
                setActions((prev) => [
                  ...prev,
                  {
                    id: `vfremoting-${request.requestId || request.request.url}-${idx}-${Date.now()}`,
                    timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                    apexClass: apexClass,
                    method: apexMethod,
                    latency: request.time,
                    request: requestData as Record<string, unknown>,
                    response: responseObj,
                    rawRequest: vfReq,
                    rawResponse: vfResponse || {},
                    context: {
                      isVfRemoting: true,
                      tid: vfReq.tid,
                      requestType: vfReq.type,
                    }, // We don't include ctx as per instructions
                    network: {
                      requestId: request.requestId || request.request.url,
                      url: request.request.url,
                      latency: request.time,
                    },
                    fullResponse: resJson as Record<string, unknown>,
                    fullRequest: request,
                    error,
                    boxcarId, // Present if multiple VF remoting calls in one request
                  },
                ]);
              }
            });
            return; // Exit early for VF remoting calls
          }

          // Check if this is a GraphQL call (different structure)
          const isGraphQLCall = request.request.url.includes('/aura') && 
                               (request.request.url.includes('aura.RecordUi.executeGraphQL') ||
                                request.request.url.includes('executeGraphQL'));
          
          if (isGraphQLCall) {
            // Handle GraphQL calls
            console.debug('[Apex Inspector] Processing GraphQL call');
            
            // GraphQL request structure is similar to aura but contains GraphQL queries
            // The request might have actions with GraphQL queries in the params
            let actionsArr: unknown[] = [];
            if (
              reqPostData &&
              typeof reqPostData === 'object' &&
              reqPostData !== null &&
              Array.isArray((reqPostData as { actions?: unknown[] }).actions)
            ) {
              actionsArr = (reqPostData as { actions: unknown[] }).actions;
              console.debug('[Apex Inspector] Found GraphQL actions array:', actionsArr);
              
              actionsArr.forEach((action: unknown, idx: number) => {
                console.debug('[Apex Inspector] Processing GraphQL action:', action);
                if (typeof action === "object" && action !== null) {
                  const actionObj = action as Record<string, unknown>;
                  const paramsObj = actionObj.params || {};
                  console.debug('[Apex Inspector] GraphQL Params object:', paramsObj);
                  
                  // Extract GraphQL query information
                  let graphqlQuery = '[Unknown Query]';
                  let graphqlVariables: Record<string, unknown> = {};
                  let operationType = 'query'; // Default to query
                  
                  // Try to extract GraphQL query from various possible locations
                  if (typeof paramsObj === 'object' && paramsObj !== null) {
                    const params = paramsObj as Record<string, unknown>;
                    
                    // Look for query in queryInput.query (Salesforce GraphQL structure)
                    if (typeof params.queryInput === 'object' && params.queryInput !== null) {
                      const queryInput = params.queryInput as Record<string, unknown>;
                      if (typeof queryInput.query === 'string') {
                        graphqlQuery = queryInput.query;
                      }
                      
                      // Extract variables from queryInput if present
                      if (typeof queryInput.variables === 'object' && queryInput.variables !== null) {
                        graphqlVariables = queryInput.variables as Record<string, unknown>;
                      }
                    }
                    // Fallback to common GraphQL parameter locations
                    else if (typeof params.query === 'string') {
                      graphqlQuery = params.query;
                    } else if (typeof params.graphQL === 'string') {
                      graphqlQuery = params.graphQL;
                    } else if (typeof params.gql === 'string') {
                      graphqlQuery = params.gql;
                    }
                    
                    // Extract variables if present at top level (fallback)
                    if (Object.keys(graphqlVariables).length === 0 && 
                        typeof params.variables === 'object' && params.variables !== null) {
                      graphqlVariables = params.variables as Record<string, unknown>;
                    }
                    
                    // Try to determine operation type from query
                    if (graphqlQuery.trim().toLowerCase().startsWith('mutation')) {
                      operationType = 'mutation';
                    } else if (graphqlQuery.trim().toLowerCase().startsWith('subscription')) {
                      operationType = 'subscription';
                    }
                  }
                  
                  console.debug('[Apex Inspector] Extracted GraphQL query:', graphqlQuery);
                  console.debug('[Apex Inspector] GraphQL variables:', graphqlVariables);
                  console.debug('[Apex Inspector] Operation type:', operationType);
                  console.debug('[Apex Inspector] Query length:', graphqlQuery.length);
                  
                  // Handle GraphQL response
                  let responseObj: Record<string, unknown> = {};
                  let error: string | null = null;
                  
                  if (resJson && typeof resJson === 'object') {
                    const resJsonObj = resJson as Record<string, unknown>;
                    const actionsResponse = resJsonObj.actions;
                    
                    if (Array.isArray(actionsResponse)) {
                      const actionResponse = actionsResponse[idx];
                      
                      if (actionResponse && typeof actionResponse === 'object') {
                        const actionRespObj = actionResponse as Record<string, unknown>;
                        
                        // Check for GraphQL errors
                        if (actionRespObj.state === 'ERROR') {
                          error = 'GraphQL error occurred';
                          if (Array.isArray(actionRespObj.error) && actionRespObj.error.length > 0) {
                            const errorObj = actionRespObj.error[0];
                            if (typeof errorObj === 'object' && errorObj !== null && 'message' in errorObj) {
                              error = String(errorObj.message);
                            }
                          }
                          responseObj = actionRespObj;
                        } else {
                          // For successful GraphQL calls, extract the return value
                          const returnValue = actionRespObj.returnValue;
                          if (returnValue && typeof returnValue === 'object') {
                            responseObj = returnValue as Record<string, unknown>;
                          } else {
                            responseObj = actionRespObj;
                          }
                        }
                      }
                    }
                  }
                  
                  setActions((prev) => [
                    ...prev,
                    {
                      id: `graphql-${request.requestId || request.request.url}-${idx}-${Date.now()}`,
                      timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                      apexClass: 'GraphQL',
                      method: operationType,
                      latency: request.time,
                      request: {
                        query: graphqlQuery,
                        variables: graphqlVariables,
                        ...paramsObj as Record<string, unknown>
                      },
                      response: responseObj,
                      rawRequest: action,
                      rawResponse: Array.isArray((resJson as Record<string, unknown>)?.actions) 
                        ? ((resJson as Record<string, unknown>).actions as unknown[])[idx] || {}
                        : {},
                      context: {
                        isGraphQL: true,
                        operationType: operationType,
                        queryLength: graphqlQuery.length
                      },
                      network: {
                        requestId: request.requestId || request.request.url,
                        url: request.request.url,
                        latency: request.time,
                      },
                      fullResponse: resJson as Record<string, unknown>,
                      fullRequest: request,
                      error,
                      // No boxcarId for GraphQL calls as they are typically single operations
                    },
                  ]);
                }
              });
            }
            return; // Exit early for GraphQL calls
          }

          // Handle uiRecordApi calls (e.g., getRecordWithFields, updateRecord, createRecord, etc.)
          const isUiRecordApiCall = request.request.url.includes('/aura') && (
            // Method 1: URL-based detection (e.g., aura.RecordUi.getRecordWithFields=1)
            request.request.url.includes('aura.RecordUi.') ||
            // Method 2: Descriptor-based detection in request data
            (reqPostData && 
             typeof reqPostData === 'object' && 
             reqPostData !== null &&
             (() => {
               // Parse the message if it's URL-encoded
               let dataToCheck = reqPostData as Record<string, unknown>;
               if (dataToCheck.message && typeof dataToCheck.message === 'string') {
                 try {
                   dataToCheck = JSON.parse(dataToCheck.message);
                 } catch (parseError) {
                   // If parsing fails, use original data
                   console.debug('[Apex Inspector] Failed to parse message in uiRecordApi detection:', parseError);
                 }
               }
               
               // Check if any action has RecordUiController descriptor
               if (dataToCheck.actions && Array.isArray(dataToCheck.actions)) {
                 return dataToCheck.actions.some((action: unknown) => {
                   if (action && typeof action === 'object') {
                     const actionObj = action as Record<string, unknown>;
                     const descriptor = actionObj.descriptor;
                     return typeof descriptor === 'string' && 
                            descriptor.includes('RecordUiController');
                   }
                   return false;
                 });
               }
               
               // Check descriptor at root level (fallback)
               const descriptor = dataToCheck.descriptor;
               return typeof descriptor === 'string' && descriptor.includes('RecordUiController');
             })())
          );
          
          if (isUiRecordApiCall) {
            console.debug('[Apex Inspector] Processing uiRecordApi call:', request.request.url);
            
            // Extract uiRecordApi method from URL or descriptor
            let uiMethod = 'unknown';
            if (request.request.url.includes('aura.RecordUi.')) {
              // Method 1: Extract from URL (e.g., aura.RecordUi.getRecordWithFields=1)
              const methodMatch = request.request.url.match(/aura\.RecordUi\.([^=&]+)/);
              if (methodMatch) {
                uiMethod = methodMatch[1];
              }
            } else {
              // Method 2: Extract from descriptor in request data
              let dataToProcess = reqPostData as Record<string, unknown>;
              
              // Parse message if URL-encoded
              if (dataToProcess.message && typeof dataToProcess.message === 'string') {
                try {
                  dataToProcess = JSON.parse(dataToProcess.message);
                } catch (parseError) {
                  console.debug('[Apex Inspector] Failed to parse message for method extraction:', parseError);
                }
              }
              
              // Look for descriptor in actions array
              if (dataToProcess.actions && Array.isArray(dataToProcess.actions) && dataToProcess.actions.length > 0) {
                const firstAction = dataToProcess.actions[0] as Record<string, unknown>;
                if (firstAction.descriptor && typeof firstAction.descriptor === 'string') {
                  const descriptor = firstAction.descriptor;
                  const methodMatch = descriptor.match(/ACTION\$([^"]+)/);
                  if (methodMatch) {
                    uiMethod = methodMatch[1];
                  }
                }
              }
              // Fallback: check descriptor at root level
              else if (dataToProcess.descriptor && typeof dataToProcess.descriptor === 'string') {
                const descriptor = dataToProcess.descriptor;
                const methodMatch = descriptor.match(/ACTION\$([^"]+)/);
                if (methodMatch) {
                  uiMethod = methodMatch[1];
                }
              }
            }

            // Extract parameters from request
            let recordId: string | undefined;
            let fields: string[] = [];
            let layoutType: string | undefined;
            let modes: string[] = [];
            let recordTypeId: string | undefined;
            let apiName: string | undefined;
            let recordInput: Record<string, unknown> | undefined;
            
            if (reqPostData && typeof reqPostData === 'object' && reqPostData !== null) {
              // Handle message-based requests (POST data with message parameter)
              let dataToProcess = reqPostData as Record<string, unknown>;
              
              // If there's a message parameter, parse it as JSON
              if (dataToProcess.message && typeof dataToProcess.message === 'string') {
                try {
                  const messageData = JSON.parse(dataToProcess.message);
                  dataToProcess = messageData;
                } catch (e) {
                  console.debug('[Apex Inspector] Failed to parse message parameter:', e);
                }
              }
              
              // Look for actions array (typical uiRecordApi structure)
              if (dataToProcess.actions && Array.isArray(dataToProcess.actions) && dataToProcess.actions.length > 0) {
                const firstAction = dataToProcess.actions[0] as Record<string, unknown>;
                if (firstAction.params && typeof firstAction.params === 'object') {
                  const params = firstAction.params as Record<string, unknown>;
                  
                  // Handle createRecord structure: params.recordInput.{apiName, fields}
                  if (params.recordInput && typeof params.recordInput === 'object') {
                    recordInput = params.recordInput as Record<string, unknown>;
                    apiName = recordInput.apiName as string;
                    if (recordInput.fields && typeof recordInput.fields === 'object') {
                      // For createRecord, fields is an object, not an array
                      const fieldsObj = recordInput.fields as Record<string, unknown>;
                      fields = Object.keys(fieldsObj);
                    }
                  }
                  // Handle other uiRecordApi calls (getRecordWithFields, etc.)
                  else {
                    recordId = params.recordId as string;
                    if (Array.isArray(params.fields)) {
                      fields = params.fields;
                    }
                    layoutType = params.layoutType as string;
                    if (Array.isArray(params.modes)) {
                      modes = params.modes;
                    }
                    recordTypeId = params.recordTypeId as string;
                  }
                }
              }
              // Fallback: try to get params directly from the root
              else if (dataToProcess.params && typeof dataToProcess.params === 'object') {
                const params = dataToProcess.params as Record<string, unknown>;
                
                // Handle createRecord structure at root level
                if (params.recordInput && typeof params.recordInput === 'object') {
                  recordInput = params.recordInput as Record<string, unknown>;
                  apiName = recordInput.apiName as string;
                  if (recordInput.fields && typeof recordInput.fields === 'object') {
                    const fieldsObj = recordInput.fields as Record<string, unknown>;
                    fields = Object.keys(fieldsObj);
                  }
                }
                // Handle other uiRecordApi calls
                else {
                  recordId = params.recordId as string;
                  if (Array.isArray(params.fields)) {
                    fields = params.fields;
                  }
                  layoutType = params.layoutType as string;
                  if (Array.isArray(params.modes)) {
                    modes = params.modes;
                  }
                  recordTypeId = params.recordTypeId as string;
                }
              }
            }

            // Handle uiRecordApi response
            let responseObj: Record<string, unknown> = {};
            let error: string | null = null;
            
            if (resJson && typeof resJson === 'object') {
              const uiResponse = resJson as Record<string, unknown>;
              
              // Check for uiRecordApi specific errors
              if (uiResponse.error) {
                error = 'uiRecordApi error occurred';
                if (typeof uiResponse.error === 'string') {
                  error = uiResponse.error;
                } else if (typeof uiResponse.error === 'object' && uiResponse.error !== null) {
                  error = JSON.stringify(uiResponse.error);
                }
                responseObj = uiResponse;
              } else if (uiResponse.errors && Array.isArray(uiResponse.errors) && uiResponse.errors.length > 0) {
                error = 'uiRecordApi errors occurred';
                error = JSON.stringify(uiResponse.errors);
                responseObj = uiResponse;
              } else {
                // For successful uiRecordApi calls, extract the meaningful response data
                if (uiResponse.actions && Array.isArray(uiResponse.actions) && uiResponse.actions.length > 0) {
                  // For uiRecordApi, the first action's returnValue contains the actual API response
                  const firstAction = uiResponse.actions[0] as Record<string, unknown>;
                  if (firstAction && firstAction.returnValue) {
                    // Use the returnValue as the main response since it contains the record data
                    responseObj = firstAction.returnValue as Record<string, unknown>;
                  } else {
                    // Fallback: keep the full action if no returnValue
                    responseObj = {
                      id: firstAction.id,
                      descriptor: firstAction.descriptor,
                      callingDescriptor: firstAction.callingDescriptor,
                      returnValue: firstAction.returnValue,
                      error: firstAction.error,
                      state: firstAction.state,
                    };
                  }
                } else {
                  // Fallback: store the whole response if no actions found
                  responseObj = uiResponse;
                }
              }
            }
            
            // Build request object with only non-empty/defined values
            const requestObj: Record<string, unknown> = {};
            if (recordId) requestObj.recordId = recordId;
            if (fields.length > 0) requestObj.fields = fields;
            if (layoutType) requestObj.layoutType = layoutType;
            if (modes.length > 0) requestObj.modes = modes;
            if (recordTypeId) requestObj.recordTypeId = recordTypeId;
            if (apiName) requestObj.apiName = apiName;
            if (recordInput) requestObj.recordInput = recordInput;
            
            setActions((prev) => [
              ...prev,
              {
                id: `uirecordapi-${request.requestId || request.request.url}-${Date.now()}`,
                timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                apexClass: 'uiRecordApi',
                method: uiMethod,
                latency: request.time,
                request: requestObj,
                response: responseObj,
                rawRequest: reqPostData,
                rawResponse: resJson || {},
                context: {
                  isUiRecordApi: true,
                  methodName: uiMethod,
                  recordId,
                  fieldsCount: fields.length,
                  hasLayoutType: !!layoutType,
                  apiName,
                },
                network: {
                  requestId: request.requestId || request.request.url,
                  url: request.request.url,
                  latency: request.time,
                },
                fullResponse: resJson as Record<string, unknown>,
                fullRequest: request,
                error,
                // No boxcarId for uiRecordApi calls as they are typically single operations
              },
            ]);
            return; // Exit early for uiRecordApi calls
          }

          // Handle Lightning/Aura calls (original logic)
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
            console.debug('[Apex Inspector] Found actions array:', actionsArr);
            if (actionsArr.length > 1) {
              // Only assign a boxcarId if more than one action
              boxcarId = generateBoxcarId();
            }
            actionsArr.forEach((action: unknown, idx: number) => {
              console.debug('[Apex Inspector] Processing action:', action);
              if (
                typeof action === "object" &&
                action !== null &&
                (action as { descriptor?: string }).descriptor === "aura://ApexActionController/ACTION$execute"
              ) {
                console.debug('[Apex Inspector] Found Apex action!', action);
                // Robustly extract Apex class and method (Salesforce can use 'classname' or 'className', 'method' or 'methodName')
                const paramsObj = (action as Record<string, unknown>).params || {};
                console.debug('[Apex Inspector] Params object:', paramsObj);
                
                let apexClass: string;
                let apexMethod: string;
                
                // Try to extract class name with fallbacks
                if (typeof (paramsObj as Record<string, unknown>)["classname"] === 'string') {
                  apexClass = (paramsObj as Record<string, unknown>)["classname"] as string;
                } else if (typeof (paramsObj as Record<string, unknown>)["className"] === 'string') {
                  apexClass = (paramsObj as Record<string, unknown>)["className"] as string;
                } else {
                  console.debug('[Apex Inspector] Could not find classname or className in params:', paramsObj);
                  apexClass = '[Unknown Class]';
                }
                
                // Try to extract method name with fallbacks
                if (typeof (paramsObj as Record<string, unknown>)["method"] === 'string') {
                  apexMethod = (paramsObj as Record<string, unknown>)["method"] as string;
                } else if (typeof (paramsObj as Record<string, unknown>)["methodName"] === 'string') {
                  apexMethod = (paramsObj as Record<string, unknown>)["methodName"] as string;
                } else {
                  console.debug('[Apex Inspector] Could not find method or methodName in params:', paramsObj);
                  apexMethod = '[Unknown Method]';
                }
                
                console.debug('[Apex Inspector] Extracted class:', apexClass, 'method:', apexMethod);
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
          } else {
            console.debug('[Apex Inspector] No actions array found in request data. reqPostData:', reqPostData);
            // Fallback: try to create a generic entry for unrecognized Lightning/Aura calls
            const fallbackRequest = reqPostData as Record<string, unknown>;
            setActions((prev) => [
              ...prev,
              {
                id: `fallback-${request.requestId || request.request.url}-${Date.now()}`,
                timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
                apexClass: '[Unknown Format]',
                method: '[Unknown]',
                latency: request.time,
                request: fallbackRequest,
                response: (resJson as Record<string, unknown>) || {},
                rawRequest: reqPostData,
                rawResponse: resJson || {},
                context: {},
                network: {
                  requestId: request.requestId || request.request.url,
                  url: request.request.url,
                  latency: request.time,
                },
                fullResponse: resJson as Record<string, unknown>,
                fullRequest: request,
                error: 'Could not parse request format. See raw data.',
              },
            ]);
          }
        } catch (err) {
          // Debug: log parse errors
          console.error('[Apex Inspector] Error parsing network event:', err, event.data);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [apexClassMappings]);

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

  // Keyboard navigation for left/right arrows and delete/backspace
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (filteredSorted.length === 0) return;
      
      if ((e.key === 'Delete' || e.key === 'Backspace') && expandedId) {
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
      
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(json).then(() => {
          // Show toast if requested
          if (toastId && evt) {
            const rect = (evt.target as HTMLElement).getBoundingClientRect();
            setCopiedToast({ id: toastId, x: rect.left + rect.width / 2, y: rect.top });
            setTimeout(() => setCopiedToast(null), 1200);
          }
        }).catch(() => {
          // Fall back to legacy method
          fallbackCopyToClipboard(json, toastId, evt);
        });
      } else {
        // Fall back to legacy method
        fallbackCopyToClipboard(json, toastId, evt);
      }
    } catch {
      // Do nothing on failure
    }
  }

  function fallbackCopyToClipboard(text: string, toastId?: string, evt?: React.MouseEvent) {
    try {
      // Legacy workaround: use textarea + execCommand('copy')
      const textarea = document.createElement('textarea');
      textarea.value = text;
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
            {/* JSON View Controls Group */}
            <div className="flex items-center gap-2 px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <label className="text-xs text-gray-500 dark:text-gray-300 flex-shrink-0 font-medium">JSON View:</label>
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
              <button
                className={`px-2 py-1 rounded text-xs border transition-colors duration-200 flex-shrink-0 ${alwaysExpandedJson ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : (theme === 'dark' ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600' : 'bg-white text-gray-900 border-gray-300 hover:bg-gray-100')}`}
                onClick={() => saveSettings({ alwaysExpandedJson: !alwaysExpandedJson })}
                title={`${alwaysExpandedJson ? 'Disable' : 'Enable'} always expanded JSON mode (depth limit 50)`}
              >
                {alwaysExpandedJson ? '📄 Expanded' : '📋 Collapsed'}
              </button>
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
                {selectedRow.context && typeof selectedRow.context === 'object' && 'needsMapping' in selectedRow.context && Boolean(selectedRow.context.needsMapping) && (
                  <div className="relative group inline-block align-middle">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-orange-500 cursor-help">
                      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                      <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
                    </svg>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Community Cloud obfuscated class name<br />
                      Configure "Apex Class Mappings JSON" in settings to see real names
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                    </div>
                  </div>
                )}
                {selectedRow.boxcarId && (
                  <div className="relative group inline-block align-middle">
                    <span className="text-indigo-600 dark:text-indigo-400 cursor-help">
                      <TruckIcon boxcarId={selectedRow.boxcarId} />
                    </span>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Boxcarred Request<br />ID: {selectedRow.boxcarId}
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span>Time: {new Date(selectedRow.timestamp).toLocaleTimeString([], { timeZoneName: 'short' })}</span>
                <span>Latency: {selectedRow.latency}ms</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors duration-200"
                onClick={() => {
                  setExpandedId(null);
                  setSelectedIdx(null);
                }}
                title="Close detail view (Delete or Backspace key)"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">(Del/⌫)</span>
            </div>
          </div>

          {/* Detail content */}
          <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            {selectedRow.apexClass === '[Unparsed] ApexAction' && selectedRow.method === '[Unparsed] execute' ? (
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3">Raw Apex Action Data</h3>
                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm overflow-x-auto border dark:border-gray-700" style={{ minHeight: minRawDataHeight }}>
                  <React18JsonView 
                    src={{ rawRequest: selectedRow.rawRequest, rawResponse: selectedRow.rawResponse, fullRequest: selectedRow.fullRequest, fullResponse: selectedRow.fullResponse }} 
                    collapsed={jsonViewCollapsed} 
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
                      <React18JsonView src={selectedRow.request} collapsed={jsonViewCollapsed} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
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
                      <React18JsonView src={selectedRow.response} collapsed={jsonViewCollapsed} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                    </div>
                  </div>
                </div>

                {/* Timing/Performance section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* Timing Table */}
                  <div className="overflow-visible">
                    <h3 className="text-lg font-semibold mb-3">Timing</h3>
                    <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg overflow-hidden relative">
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
                              <td className="border px-3 py-2 font-semibold bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
                                Total Latency
                              </td>
                              <td className="border px-3 py-2 dark:border-gray-700">{selectedRow.latency} ms</td>
                            </tr>
                          ) : null}
                          {selectedRow.boxcarId && (
                            <tr>
                              <td className="border px-3 py-2 text-xs text-gray-600 dark:text-gray-400 italic dark:border-gray-700" colSpan={2}>
                                This latency represents the total time for all actions in this boxcarred request, not just the current action being viewed.
                              </td>
                            </tr>
                          )}
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
                      const allActions = perfSummary.actions && typeof perfSummary.actions === 'object' ? perfSummary.actions : {};
                      
                      // Filter to show only the current action's performance data
                      const currentActionId = selectedRow.id;
                      const currentActionPerf = currentActionId && currentActionId in allActions ? { [currentActionId]: allActions[currentActionId] } : {};
                      
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
                          {Object.keys(currentActionPerf).length > 0 ? (
                            <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg overflow-hidden">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr>
                                    <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">Action ID</th>
                                    <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">Total (ms)</th>
                                    <th className="border px-3 py-2 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-left">DB (ms)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(currentActionPerf).map(([actKey, actVal]) => {
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
                          ) : (
                            <div className="text-sm text-gray-500 dark:text-gray-400">No performance data available for this action</div>
                          )}
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
                      <React18JsonView src={selectedRow.fullRequest} collapsed={jsonViewCollapsed} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">Full HTTP Response:</h4>
                      <React18JsonView src={selectedRow.fullResponse} collapsed={jsonViewCollapsed} enableClipboard={false} dark={jsonViewDark} theme={jsonViewTheme} />
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
                    <div className="flex items-center gap-1">
                      <div className="truncate" title={row.apexClass}>{row.apexClass}</div>
                      {row.context && typeof row.context === 'object' && 'needsMapping' in row.context && Boolean(row.context.needsMapping) && (
                        <div className="relative group inline-block align-middle flex-shrink-0">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-orange-500 cursor-help">
                            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                            <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
                          </svg>
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 max-w-xs">
                            Community Cloud obfuscated class name.<br />
                            Configure "Apex Class Mappings JSON" in settings to see real names.
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 min-w-0">
                    <div className="truncate" title={row.method}>{row.method}</div>
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 w-20">
                    <div className="truncate">{row.latency}</div>
                  </td>
                  <td className="border px-2 py-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 text-center w-20">
                    {row.boxcarId && (
                      <div className="relative group inline-block align-middle">
                        <span className="text-indigo-600 dark:text-indigo-400 cursor-help">
                          <TruckIcon boxcarId={row.boxcarId} />
                        </span>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                          Boxcarred Request<br />ID: {row.boxcarId}
                          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                        </div>
                      </div>
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

// Helper function to parse apex class mappings from SF CLI JSON output
function parseApexClassMappings(apexClassMappingsJson: string): Map<string, string> {
  const mappings = new Map<string, string>();
  
  if (!apexClassMappingsJson.trim()) {
    return mappings;
  }
  
  try {
    const parsed = JSON.parse(apexClassMappingsJson);
    const records = parsed?.result?.records;
    
    if (Array.isArray(records)) {
      records.forEach((record: { Id?: string; Name?: string }) => {
        if (record.Id && record.Name && typeof record.Id === 'string' && typeof record.Name === 'string') {
          // Store both full ID and potential truncated versions for matching
          mappings.set(record.Id, record.Name);
          
          // Also store truncated version (first 15 chars) since Community Cloud seems to truncate IDs
          if (record.Id.length > 15) {
            const truncatedId = record.Id.substring(0, 15);
            mappings.set(truncatedId, record.Name);
          }
        }
      });
    }
  } catch (error) {
    console.debug('[Apex Inspector] Failed to parse Apex Class mappings JSON:', error);
  }
  
  return mappings;
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
