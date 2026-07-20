import type { FullRequest, FullResponse } from './networkTypes';

// Which wire format produced a captured row. Drives export/codegen behavior;
// do not infer call shape from id prefixes.
export type ApexCallType =
  | 'aura'          // @AuraEnabled via aura://ApexActionController
  | 'community'     // /webruntime/api/apex/execute
  | 'vfremoting'    // /apexremote @RemoteAction
  | 'graphql'       // executeGraphQL over /aura
  | 'uirecordapi'   // aura.RecordUi.*
  | 'apexrest'      // /services/apexrest/*
  | 'unknown';      // unparsed/fallback rows

export interface ApexAction {
  id: string;
  timestamp: number;
  callType: ApexCallType;
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
  fullResponse?: Record<string, unknown> | FullResponse;
  fullRequest?: unknown | FullRequest;
  error?: string | null;
  boxcarId?: string;
}
