import type { ApexAction } from '../apexAction';

// Serializes captured requests to Markdown (AI-paste friendly, human readable)
// and JSON (programmatic). fullRequest/fullResponse are never exported: they
// hold the raw HAR with headers/cookies, which is large and potentially sensitive.

export const EXPORT_FORMAT_VERSION = '1';

const MAX_MD_BLOCK_CHARS = 200_000;

export interface ExportMeta {
  exportedAt: string;
  source: string;
  filtered: boolean;
}

export function buildExportMeta(actions: ApexAction[], filtered: boolean): ExportMeta {
  let source = '';
  if (actions.length > 0) {
    try {
      source = new URL(actions[0].network.url).origin;
    } catch {
      source = actions[0].network.url;
    }
  }
  return { exportedAt: new Date().toISOString(), source, filtered };
}

function jsonBlock(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    text = String(value);
  }
  if (text.length > MAX_MD_BLOCK_CHARS) {
    const totalKb = Math.round(text.length / 1024);
    text = text.slice(0, MAX_MD_BLOCK_CHARS) + `\n... [truncated, ${totalKb} KB total - use the JSON export for full data]`;
  }
  // Widen the fence if the payload itself contains backtick fences
  const fence = text.includes('```') ? '````' : '```';
  return `${fence}json\n${text}\n${fence}`;
}

function isEmptyValue(value: unknown): boolean {
  return value == null || (typeof value === 'object' && Object.keys(value as object).length === 0);
}

export function toMarkdown(actions: ApexAction[], meta: ExportMeta): string {
  const errorCount = actions.filter(a => a.error).length;
  const lines = [
    '# Apex Inspector Export',
    '',
    `- Exported: ${meta.exportedAt}`,
    `- Source: ${meta.source || '(unknown)'}`,
    `- Requests: ${actions.length}${errorCount > 0 ? ` (${errorCount} error${errorCount === 1 ? '' : 's'})` : ''}`,
    `- Filter active: ${meta.filtered ? 'yes (results reflect the current table filter)' : 'no'}`,
  ];

  const boxcarCounts = new Map<string, number>();
  actions.forEach(a => {
    if (a.boxcarId) boxcarCounts.set(a.boxcarId, (boxcarCounts.get(a.boxcarId) ?? 0) + 1);
  });
  const boxcarSeen = new Map<string, number>();

  actions.forEach((action, idx) => {
    lines.push('', '---', '', `### ${idx + 1}. ${action.apexClass}.${action.method}`);
    lines.push(`- Type: ${action.callType} | Timestamp: ${new Date(action.timestamp).toISOString()} | Latency: ${action.latency ?? '?'} ms`);
    lines.push(`- Status: ${action.error ? `ERROR - ${action.error}` : 'OK'}`);
    if (action.boxcarId) {
      const pos = (boxcarSeen.get(action.boxcarId) ?? 0) + 1;
      boxcarSeen.set(action.boxcarId, pos);
      lines.push(`- Boxcar: ${action.boxcarId} (call ${pos} of ${boxcarCounts.get(action.boxcarId)})`);
    }
    lines.push(`- URL: ${action.network.url}`);
    lines.push('', '**Request parameters**', '');
    lines.push(isEmptyValue(action.request) ? '_(empty)_' : jsonBlock(action.request));
    lines.push('', '**Response**', '');
    lines.push(isEmptyValue(action.response) ? '_(empty)_' : jsonBlock(action.response));
  });

  return lines.join('\n') + '\n';
}

export function toJsonExport(actions: ApexAction[], meta: ExportMeta, opts?: { includeRaw?: boolean }): string {
  const includeRaw = opts?.includeRaw ?? false;
  return JSON.stringify(
    {
      exportedAt: meta.exportedAt,
      source: meta.source,
      version: EXPORT_FORMAT_VERSION,
      generator: 'Apex Inspector',
      filtered: meta.filtered,
      requests: actions.map(a => ({
        id: a.id,
        timestamp: new Date(a.timestamp).toISOString(),
        timestampEpochMs: a.timestamp,
        callType: a.callType,
        apexClass: a.apexClass,
        method: a.method,
        latency: a.latency,
        error: a.error ?? null,
        boxcarId: a.boxcarId ?? null,
        url: a.network.url,
        request: a.request,
        response: a.response,
        context: a.context,
        ...(includeRaw ? { rawRequest: a.rawRequest, rawResponse: a.rawResponse } : {}),
      })),
    },
    null,
    2
  );
}

function timestampSlug(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function exportFilename(ext: 'md' | 'json', single?: ApexAction): string {
  if (single) {
    const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
    return `apex-${sanitize(single.apexClass)}-${sanitize(single.method)}-${timestampSlug(new Date(single.timestamp))}.${ext}`;
  }
  return `apex-inspector-export-${timestampSlug(new Date())}.${ext}`;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
