// Types for Chrome DevTools HAR-like network request/response objects used in Apex Inspector

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion?: string;
  headers: HarHeader[];
  queryString?: HarHeader[];
  cookies?: unknown[];
  headersSize?: number;
  bodySize?: number;
  postData?: {
    mimeType?: string;
    text?: string;
  };
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion?: string;
  headers: HarHeader[];
  cookies?: unknown[];
  content?: {
    size?: number;
    mimeType?: string;
    text?: string;
    encoding?: string;
  };
  redirectURL?: string;
  headersSize?: number;
  bodySize?: number;
}

export interface FullRequest {
  request: HarRequest;
  response: HarResponse;
  requestId?: string;
  startedDateTime?: string;
  time?: number;
  _resourceType?: string;
  timings?: Record<string, number>;
}

export interface FullResponse {
  response: HarResponse;
  perfSummary?: Record<string, unknown>;
}
