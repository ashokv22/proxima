export const SLOW_REQUEST_MS = 1_000;

export type ApiActivityDetailKind = 'start' | 'log' | 'end' | 'stack';

export interface ApiActivityDetail {
  line: number;
  text: string;
  kind: ApiActivityDetailKind;
  level?: string;
  timestamp?: string;
  relativeMs?: number;
}

export interface ApiActivityRecord {
  id: string;
  state: 'started' | 'completed';
  startKnown: boolean;
  method?: string;
  uri?: string;
  status?: number;
  durationMs?: number;
  timestamp?: string;
  completedTimestamp?: string;
  correlationId?: string;
  internalLogCount: number;
  details: ApiActivityDetail[];
}

export interface ApiActivitySummary {
  completed: number;
  failed: number;
  slowestMs?: number;
  matched: number;
  unmatchedStart: number;
  unmatchedEnd: number;
  associatedLogs: number;
}

export interface ApiActivity {
  records: ApiActivityRecord[];
  unassignedLogs: ApiActivityDetail[];
  summary: ApiActivitySummary;
}

interface LineContext {
  requestId?: string;
  traceId?: string;
  thread?: string;
}

interface ParsedLine {
  line: number;
  evidence: string;
  display: string;
  timestamp?: string;
  timestampMs?: number;
  level?: string;
  context: LineContext;
  event?: ApiEvent;
  structured: boolean;
  stack: boolean;
}

interface ApiEvent {
  phase: 'start' | 'end';
  method?: string;
  uri?: string;
  status?: number;
  durationMs?: number;
}

interface MutableRecord extends ApiActivityRecord {
  context: LineContext;
  startTimestampMs?: number;
}

const TIMESTAMP = /^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)/;
const LOG_LEVEL = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/;
const REQUEST_MARKER = /\bREQ\s+(START|END)\b/i;
const HTTP_METHOD = '(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)';
const METHOD = new RegExp(`(?:\\bmethod\\s*[:=]\\s*|\\[?)${HTTP_METHOD}(?:\\]|\\b)`, 'i');
const DIRECT_METHOD_URI = new RegExp(
  `\\b${HTTP_METHOD}\\b\\]?\\s*(?:[-|:>]\\s*)*(\\[[/?][^\\]]+\\]|(?:https?://|/|\\?)[^\\s,;|]+)`,
  'i',
);
const URI_VALUE = /\b(?:uri|url|path)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|(\[[^\]]+\]|[^\s,;]+))/i;
const STATUS_VALUE = /\b(?:status|statusCode|httpStatus)\s*[:=]\s*\[?([1-5]\d{2})\b\]?/i;
const BRACKETED_STATUS = /\[([1-5]\d{2})\]/;
const HTTP_STATUS = /HTTP\/\d(?:\.\d)?\s+([1-5]\d{2})\b/i;
const DURATION_VALUE = /\b(?:duration|elapsed|response[-_]?time|execution[-_]?time|time[-_]?taken|time|took)\s*[:=]?\s*\[?\s*(\d+(?:\.\d+)?)\s*(ms|s|us|µs)\b\s*\]?/i;
const BOUNDED_DURATION = /[([](\d+(?:\.\d+)?)\s*(ms|s|us|µs)[)\]]/i;
const REQUEST_ID_VALUE = /\b(?:request[_-]?id|correlation[_-]?id|x-request-id)\b\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/i;
const TRACE_ID_VALUE = /\btrace[_-]?id\b\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/i;
const BRACKET_FIELD = /\[([^\]\r\n]+)\]/g;
const STACK_LINE = /^\s*(?:(?:at\s+|Caused by:|Suppressed:|\.\.\. \d+ more)|[\w.$]+(?:Exception|Error)(?::|$))/;
const THREAD_VALUE = /\[((?:tomcat-handler-|(?:https?-)?nio-|https-jsse-nio-|pool-|task-|async-|scheduling-|ForkJoinPool|reactor|XNIO|nioEventLoop|main\b)[^\]]*)\]/i;

function firstValue(match: RegExpMatchArray | null, startIndex = 1): string | undefined {
  if (!match) return undefined;
  for (let index = startIndex; index < match.length; index += 1) {
    const value = match[index];
    if (value) return value;
  }
  return undefined;
}

function cleanValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/^["']|["',;]$/g, '');
  if (cleaned.startsWith('[') && cleaned.endsWith(']') && !cleaned.includes('[REDACTED')) {
    return cleaned.slice(1, -1);
  }
  return cleaned || undefined;
}

function reliableCorrelation(value: string | undefined): string | undefined {
  const cleaned = cleanValue(value);
  if (!cleaned || /(?:redacted|masked|anonymous|unknown|null)/i.test(cleaned)) return undefined;
  return cleaned;
}

function mdcTraceId(text: string, thread: string | undefined): string | undefined {
  for (const match of text.matchAll(BRACKET_FIELD)) {
    const field = match[1]?.trim();
    if (!field || field === thread || field.includes('#') || /^\d+$/.test(field)) continue;
    const first = field.split(',')[0]?.trim();
    if (!first || first === field && /^(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)$/i.test(first)) continue;
    if (!field.includes(',') && !/^(?:[0-9a-f]{16,32}|[0-9a-f-]{36}|(?=[\w-]*\d)[\w-]{8,})$/i.test(first)) continue;
    const candidate = reliableCorrelation(first);
    if (candidate) return candidate;
  }
  return undefined;
}

function parseContext(text: string): LineContext {
  const thread = cleanValue(text.match(THREAD_VALUE)?.[1]);
  const requestId = reliableCorrelation(firstValue(text.match(REQUEST_ID_VALUE)));
  const explicitTrace = reliableCorrelation(firstValue(text.match(TRACE_ID_VALUE)));
  return {
    requestId,
    traceId: explicitTrace ?? mdcTraceId(text, thread),
    thread,
  };
}

function durationInMilliseconds(value: string | undefined, unit: string | undefined): number | undefined {
  if (!value || !unit) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  switch (unit.toLowerCase()) {
    case 's': return amount * 1_000;
    case 'us':
    case 'µs': return amount / 1_000;
    default: return amount;
  }
}

function timestampInMilliseconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(',', '.').replace(' ', 'T');
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) return parsed;
  const parts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!parts) return undefined;
  const fraction = Number(`0.${parts[7] ?? '0'}`) * 1_000;
  return Date.UTC(
    Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]),
    Number(parts[4]), Number(parts[5]), Number(parts[6]), fraction,
  );
}

function parseEvent(text: string): ApiEvent | undefined {
  const marker = text.match(REQUEST_MARKER);
  if (!marker || marker.index === undefined) return undefined;
  const message = text.slice(marker.index + marker[0].length);
  const method = firstValue(message.match(METHOD))?.toUpperCase();
  const keyedUri = firstValue(message.match(URI_VALUE));
  const directUri = method ? firstValue(message.match(DIRECT_METHOD_URI), 2) : undefined;
  const statusText = firstValue(message.match(STATUS_VALUE) ?? message.match(HTTP_STATUS) ?? message.match(BRACKETED_STATUS));
  const durationMatch = message.match(DURATION_VALUE) ?? message.match(BOUNDED_DURATION);
  return {
    phase: marker[1]?.toUpperCase() === 'START' ? 'start' : 'end',
    method,
    uri: cleanValue(keyedUri ?? directUri),
    status: statusText ? Number(statusText) : undefined,
    durationMs: durationInMilliseconds(durationMatch?.[1], durationMatch?.[2]),
  };
}

function parseLine(evidence: string, display: string, index: number): ParsedLine {
  const timestamp = evidence.match(TIMESTAMP)?.[1];
  const level = evidence.match(LOG_LEVEL)?.[1]?.toUpperCase();
  const context = parseContext(evidence);
  const parsedEvent = parseEvent(evidence);
  const event = parsedEvent
    && (parsedEvent.method || parsedEvent.uri || parsedEvent.status !== undefined
      || parsedEvent.durationMs !== undefined || context.requestId || context.traceId || context.thread)
    ? parsedEvent
    : undefined;
  const stack = STACK_LINE.test(evidence);
  return {
    line: index + 1,
    evidence,
    display,
    timestamp,
    timestampMs: timestampInMilliseconds(timestamp),
    level,
    context,
    event,
    structured: Boolean(timestamp || level || context.requestId || context.traceId || context.thread),
    stack,
  };
}

function detailFromLine(line: ParsedLine, kind: ApiActivityDetailKind, startMs?: number): ApiActivityDetail {
  const relative = startMs !== undefined && line.timestampMs !== undefined
    ? line.timestampMs - startMs
    : undefined;
  return {
    line: line.line,
    text: line.display,
    kind,
    level: line.level,
    timestamp: line.timestamp,
    relativeMs: relative !== undefined && relative >= 0 ? relative : undefined,
  };
}

function recordFromStart(line: ParsedLine): MutableRecord {
  const event = line.event!;
  return {
    id: `api-start-${line.line}`,
    state: 'started',
    startKnown: true,
    method: event.method,
    uri: event.uri,
    timestamp: line.timestamp,
    correlationId: line.context.requestId ?? line.context.traceId,
    internalLogCount: 0,
    details: [detailFromLine(line, 'start', line.timestampMs)],
    context: line.context,
    startTimestampMs: line.timestampMs,
  };
}

function recordFromUnmatchedEnd(line: ParsedLine): MutableRecord {
  const event = line.event!;
  return {
    id: `api-end-${line.line}`,
    state: 'completed',
    startKnown: false,
    method: event.method,
    uri: event.uri,
    status: event.status,
    durationMs: event.durationMs,
    completedTimestamp: line.timestamp,
    correlationId: line.context.requestId ?? line.context.traceId,
    internalLogCount: 0,
    details: [detailFromLine(line, 'end')],
    context: line.context,
  };
}

function applyCompletion(record: MutableRecord, line: ParsedLine): void {
  const event = line.event!;
  record.state = 'completed';
  record.method = event.method ?? record.method;
  record.uri = event.uri ?? record.uri;
  record.status = event.status;
  // REQ END is the only authoritative duration source. Never infer from timestamps.
  record.durationMs = event.durationMs;
  record.completedTimestamp = line.timestamp;
  record.details.push(detailFromLine(line, 'end', record.startTimestampMs));
}

function addIndex(index: Map<string, Set<number>>, value: string | undefined, recordIndex: number): void {
  if (!value) return;
  const matches = index.get(value) ?? new Set<number>();
  matches.add(recordIndex);
  index.set(value, matches);
}

function removeIndex(index: Map<string, Set<number>>, value: string | undefined, recordIndex: number): void {
  if (!value) return;
  const matches = index.get(value);
  matches?.delete(recordIndex);
  if (matches?.size === 0) index.delete(value);
}

function intersection(left: Set<number>, right: Set<number> | undefined): Set<number> {
  if (!right) return new Set();
  return new Set([...left].filter((value) => right.has(value)));
}

export function parseApiActivity(evidence: string, displayOutput = evidence): ApiActivity {
  const evidenceLines = evidence.split('\n');
  const displayLines = displayOutput.split('\n');
  const records: MutableRecord[] = [];
  const unassignedLogs: ApiActivityDetail[] = [];
  const open = new Set<number>();
  const byRequestId = new Map<string, Set<number>>();
  const byTraceId = new Map<string, Set<number>>();
  const byThread = new Map<string, Set<number>>();
  let lastLogAssignment: number | 'unassigned' | undefined;

  const openRecord = (recordIndex: number) => {
    const context = records[recordIndex]!.context;
    open.add(recordIndex);
    addIndex(byRequestId, context.requestId, recordIndex);
    addIndex(byTraceId, context.traceId, recordIndex);
    addIndex(byThread, context.thread, recordIndex);
  };
  const closeRecord = (recordIndex: number) => {
    const context = records[recordIndex]!.context;
    open.delete(recordIndex);
    removeIndex(byRequestId, context.requestId, recordIndex);
    removeIndex(byTraceId, context.traceId, recordIndex);
    removeIndex(byThread, context.thread, recordIndex);
  };
  const uniqueMatch = (context: LineContext): number | undefined => {
    let matches: Set<number> | undefined;
    if (context.requestId) {
      matches = byRequestId.get(context.requestId);
    } else if (context.traceId) {
      matches = byTraceId.get(context.traceId);
      if (matches && matches.size > 1 && context.thread) {
        matches = intersection(matches, byThread.get(context.thread));
      }
    } else if (context.thread) {
      matches = byThread.get(context.thread);
    }
    return matches?.size === 1 ? matches.values().next().value : undefined;
  };

  for (let index = 0; index < evidenceLines.length; index += 1) {
    const evidenceLine = evidenceLines[index] ?? '';
    const displayLine = displayLines[index] ?? evidenceLine;
    const line = parseLine(evidenceLine, displayLine, index);

    if (line.event?.phase === 'start') {
      const recordIndex = records.push(recordFromStart(line)) - 1;
      openRecord(recordIndex);
      lastLogAssignment = undefined;
      continue;
    }

    if (line.event?.phase === 'end') {
      const recordIndex = uniqueMatch(line.context);
      if (recordIndex === undefined) {
        records.push(recordFromUnmatchedEnd(line));
      } else {
        applyCompletion(records[recordIndex]!, line);
        closeRecord(recordIndex);
      }
      lastLogAssignment = undefined;
      continue;
    }

    if (line.stack && typeof lastLogAssignment === 'number' && open.has(lastLogAssignment)) {
      records[lastLogAssignment]!.details.push(
        detailFromLine(line, 'stack', records[lastLogAssignment]!.startTimestampMs),
      );
      continue;
    }

    if (!line.structured && !line.stack) {
      lastLogAssignment = undefined;
      continue;
    }

    if (open.size === 0) {
      unassignedLogs.push(detailFromLine(line, line.stack ? 'stack' : 'log'));
      lastLogAssignment = 'unassigned';
      continue;
    }

    const recordIndex = uniqueMatch(line.context);
    if (recordIndex === undefined) {
      const detail = detailFromLine(line, line.stack ? 'stack' : 'log');
      unassignedLogs.push(detail);
      lastLogAssignment = 'unassigned';
    } else {
      const record = records[recordIndex]!;
      record.details.push(detailFromLine(line, line.stack ? 'stack' : 'log', record.startTimestampMs));
      if (!line.stack) record.internalLogCount += 1;
      lastLogAssignment = recordIndex;
    }
  }

  let completed = 0;
  let failed = 0;
  let matched = 0;
  let unmatchedStart = 0;
  let unmatchedEnd = 0;
  let associatedLogs = 0;
  let slowestMs: number | undefined;
  for (const record of records) {
    associatedLogs += record.internalLogCount;
    if (record.state === 'started') {
      unmatchedStart += 1;
      continue;
    }
    completed += 1;
    if (record.startKnown) matched += 1;
    else unmatchedEnd += 1;
    if (record.status !== undefined && record.status >= 400) failed += 1;
    if (record.durationMs !== undefined && (slowestMs === undefined || record.durationMs > slowestMs)) {
      slowestMs = record.durationMs;
    }
  }

  return {
    records: records.map(({ context: _context, startTimestampMs: _startTimestampMs, ...record }) => record),
    unassignedLogs,
    summary: { completed, failed, slowestMs, matched, unmatchedStart, unmatchedEnd, associatedLogs },
  };
}
