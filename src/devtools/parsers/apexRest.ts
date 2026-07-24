import type { ApexAction } from '../apexAction';
import type { FullRequest, HarHeader } from '../networkTypes';

// Salesforce REST errors arrive as [{ "errorCode": "...", "message": "..." }]
function extractRestErrorMessage(body: unknown): string | null {
  if (Array.isArray(body) && body.length > 0) {
    const first = body[0];
    if (first && typeof first === 'object' && 'message' in first) {
      return String((first as Record<string, unknown>).message);
    }
  }
  return null;
}

function tryParseBody(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return Array.isArray(parsed) ? { items: parsed } : (parsed as Record<string, unknown>);
    }
    return { value: parsed };
  } catch {
    // ApexREST bodies can be XML or plain text
    return { rawBody: text };
  }
}

/** Parses a captured /services/apexrest/* HAR entry into an ApexAction, or null. */
export function parseApexRestRequest(request: FullRequest): ApexAction | null {
  const url = request.request?.url;
  if (!url) return null;

  const pathMatch = url.match(/\/services\/apexrest\/([^?]*)/);
  if (!pathMatch) return null;
  const restPath = '/' + pathMatch[1].replace(/\/+$/, '');
  const firstSegment = pathMatch[1].split('/')[0] || 'ApexREST';
  const httpMethod = (request.request.method || 'GET').toUpperCase();

  const queryParams: Record<string, string> = {};
  if (Array.isArray(request.request.queryString)) {
    request.request.queryString.forEach((q: HarHeader) => {
      queryParams[q.name] = q.value;
    });
  } else {
    try {
      new URL(url).searchParams.forEach((value, key) => {
        queryParams[key] = value;
      });
    } catch {
      // Ignore malformed URLs
    }
  }

  const requestBodyText = request.request.postData?.text;
  const requestObj = tryParseBody(requestBodyText);
  if (Object.keys(queryParams).length > 0) {
    requestObj.queryParams = queryParams;
  }

  const responseText = request.response?.content?.text;
  let responseParsed: unknown;
  try {
    responseParsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseParsed = null;
  }
  const responseObj: Record<string, unknown> = responseParsed && typeof responseParsed === 'object'
    ? (Array.isArray(responseParsed) ? { items: responseParsed } : (responseParsed as Record<string, unknown>))
    : (responseText ? { rawBody: responseText } : {});

  const status = request.response?.status ?? 0;
  let error: string | null = null;
  if (status >= 400) {
    error = `HTTP ${status} ${request.response?.statusText || ''}`.trim();
    const restError = extractRestErrorMessage(responseParsed);
    if (restError) error += `: ${restError}`;
  }

  const findHeader = (headers: HarHeader[] | undefined, name: string) =>
    headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

  return {
    id: `apexrest-${request.requestId || url}-${Date.now()}`,
    timestamp: request.startedDateTime ? new Date(request.startedDateTime).getTime() : Date.now(),
    callType: 'apexrest',
    apexClass: firstSegment,
    method: httpMethod,
    latency: request.time ?? 0,
    request: requestObj,
    response: responseObj,
    rawRequest: { method: httpMethod, path: restPath, queryParams, body: requestBodyText ?? null },
    rawResponse: responseParsed ?? (responseText || {}),
    context: {
      isApexRest: true,
      restPath,
      httpMethod,
      queryParams,
      requestContentType: findHeader(request.request.headers, 'content-type'),
      responseContentType: findHeader(request.response?.headers, 'content-type'),
      requestBodyText: requestBodyText ?? null,
    },
    network: {
      requestId: request.requestId || url,
      url,
      latency: request.time ?? 0,
    },
    fullResponse: request.response ? { response: request.response } : undefined,
    fullRequest: request,
    error,
  };
}
