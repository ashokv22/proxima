export type PrettyTokenKind =
  | 'text'
  | 'timestamp'
  | 'level'
  | 'metadata'
  | 'feign'
  | 'http'
  | 'header-name'
  | 'json-key'
  | 'json-string'
  | 'json-number'
  | 'json-literal'
  | 'stack';

export interface PrettyToken {
  text: string;
  kind: PrettyTokenKind;
  level?: string;
}

export interface PrettyLine {
  tokens: PrettyToken[];
  kind: 'log' | 'header' | 'json' | 'stack' | 'text' | 'blank';
}

interface TokenSpan {
  start: number;
  end: number;
  token: PrettyToken;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3,9})?(?:Z|[+-]\d{2}:?\d{2})?/;
const LEVEL = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/;
const STACK_LINE = /^\s*(?:(?:at\s+|Caused by:|Suppressed:|\.\.\. \d+ more)|[\w.$]+(?:Exception|Error)(?::|$))/;
const HEADER_LINE = /^(\s*)([!#$%&'*+\-.^_`|~0-9A-Za-z]+)(:\s*)(.*)$/;
const JSON_TOKEN = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

function textToken(text: string): PrettyToken {
  return { text, kind: 'text' };
}

function tokensFromSpans(line: string, spans: TokenSpan[]): PrettyToken[] {
  const ordered = spans.sort((left, right) => left.start - right.start || right.end - left.end);
  const tokens: PrettyToken[] = [];
  let cursor = 0;
  for (const span of ordered) {
    if (span.start < cursor) continue;
    if (span.start > cursor) tokens.push(textToken(line.slice(cursor, span.start)));
    tokens.push(span.token);
    cursor = span.end;
  }
  if (cursor < line.length) tokens.push(textToken(line.slice(cursor)));
  return tokens;
}

function jsonTokens(line: string): PrettyToken[] {
  const spans: TokenSpan[] = [];
  for (const match of line.matchAll(JSON_TOKEN)) {
    const text = match[0];
    const start = match.index;
    let kind: PrettyTokenKind = 'json-literal';
    if (text.startsWith('"')) {
      kind = /^\s*:/.test(line.slice(start + text.length)) ? 'json-key' : 'json-string';
    } else if (!/^(?:true|false|null)$/.test(text)) {
      kind = 'json-number';
    }
    spans.push({ start, end: start + text.length, token: { text, kind } });
  }
  return tokensFromSpans(line, spans);
}

function logTokens(line: string, timestamp: RegExpMatchArray | null, level: RegExpMatchArray | null): PrettyToken[] {
  const spans: TokenSpan[] = [];
  if (timestamp?.index !== undefined) {
    spans.push({
      start: timestamp.index,
      end: timestamp.index + timestamp[0].length,
      token: { text: timestamp[0], kind: 'timestamp' },
    });
  }
  if (level?.index !== undefined) {
    spans.push({
      start: level.index,
      end: level.index + level[0].length,
      token: { text: level[0], kind: 'level', level: level[1]?.toLowerCase() },
    });
  }
  for (const match of line.matchAll(/\[[^\]\r\n]*\]/g)) {
    const text = match[0];
    const start = match.index;
    spans.push({
      start,
      end: start + text.length,
      token: { text, kind: text.includes('#') ? 'feign' : 'metadata' },
    });
  }
  for (const match of line.matchAll(/<---|--->|HTTP\/\d(?:\.\d)?|\b[1-5]\d{2}\b/g)) {
    const start = match.index;
    spans.push({ start, end: start + match[0].length, token: { text: match[0], kind: 'http' } });
  }
  return tokensFromSpans(line, spans);
}

function isStandaloneJson(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function lineModel(line: string, jsonDocument: boolean): PrettyLine {
  if (!line) return { kind: 'blank', tokens: [] };
  if (jsonDocument || isStandaloneJson(line)) return { kind: 'json', tokens: jsonTokens(line) };
  if (STACK_LINE.test(line)) return { kind: 'stack', tokens: [{ text: line, kind: 'stack' }] };

  const timestamp = line.match(TIMESTAMP);
  const level = line.match(LEVEL);
  if (timestamp || (level?.index ?? Number.POSITIVE_INFINITY) < 12) {
    return { kind: 'log', tokens: logTokens(line, timestamp, level) };
  }

  const header = line.match(HEADER_LINE);
  if (header) {
    return {
      kind: 'header',
      tokens: [
        ...(header[1] ? [textToken(header[1])] : []),
        { text: header[2], kind: 'header-name' },
        textToken(`${header[3]}${header[4]}`),
      ],
    };
  }
  return { kind: 'text', tokens: [textToken(line)] };
}

export function buildPrettyLines(output: string): PrettyLine[] {
  if (!output) return [];
  let source = output;
  let jsonDocument = false;
  try {
    source = JSON.stringify(JSON.parse(output), null, 2);
    jsonDocument = true;
  } catch {
    // Mixed logs and malformed JSON remain byte-for-byte in their original line structure.
  }
  return source.split('\n').map((line) => lineModel(line, jsonDocument));
}
