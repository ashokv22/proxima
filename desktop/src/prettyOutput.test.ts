import { describe, expect, it } from 'vitest';
import { buildPrettyLines } from './prettyOutput';

describe('Pretty View output model', () => {
  it('recognizes Spring metadata, Feign calls, headers, JSON, and stack frames', () => {
    const output = [
      '2026-10-15 11:04:14.992 DEBUG [trace-id,anonymous] [2649128] [IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '{"status":"ok","attempt":2}',
      'java.lang.RuntimeException: failed',
      '\tat com.example.Service.run(Service.java:42)',
    ].join('\n');

    const lines = buildPrettyLines(output);
    expect(lines.map((line) => line.tokens.map((token) => token.text).join('')).join('\n')).toBe(output);
    expect(lines.map((line) => line.kind)).toEqual(['log', 'header', 'json', 'stack', 'stack']);
    expect(lines[0]?.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'timestamp' }),
      expect.objectContaining({ kind: 'level', level: 'debug' }),
      expect.objectContaining({ kind: 'metadata', text: '[trace-id,anonymous]' }),
      expect.objectContaining({ kind: 'feign', text: '[IvrOtpClient#searchOtp]' }),
      expect.objectContaining({ kind: 'http', text: 'HTTP/1.1' }),
    ]));
    expect(lines[1]?.tokens[0]).toMatchObject({ kind: 'header-name', text: 'Content-Type' });
    expect(lines[2]?.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'json-key', text: '"status"' }),
      expect.objectContaining({ kind: 'json-string', text: '"ok"' }),
      expect.objectContaining({ kind: 'json-number', text: '2' }),
    ]));
    expect(lines[4]?.tokens[0]?.kind).toBe('stack');
  });

  it('pretty-prints a complete JSON document without changing its values', () => {
    const lines = buildPrettyLines('{"message":"hello","enabled":true}');
    expect(lines).toHaveLength(4);
    expect(lines[1]?.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'json-key', text: '"message"' }),
      expect.objectContaining({ kind: 'json-string', text: '"hello"' }),
    ]));
    expect(lines[2]?.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'json-literal', text: 'true' }),
    ]));
  });
});
