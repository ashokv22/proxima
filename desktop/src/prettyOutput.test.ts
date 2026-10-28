import { describe, expect, it } from 'vitest';
import { parseApiActivity } from './prettyOutput';

describe('Pretty View API activity parser', () => {
  it('correlates a real Spring request and retains its internal activity as one record', () => {
    const output = [
      '2026-10-28 10:00:00.000 [http-nio-8080-exec-1] INFO [request-42,alice] [701] --- c.p.api.RequestLogger : REQ START method=GET uri=/api/customers/42',
      '2026-10-28 10:00:00.040 [http-nio-8080-exec-1] INFO [request-42,alice] [701] --- c.p.CustomerService : Loading customer 42',
      '2026-10-28 10:00:00.125 [http-nio-8080-exec-1] INFO [request-42,alice] [701] --- c.p.api.RequestLogger : REQ END status=200 duration=125ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.records).toHaveLength(1);
    expect(activity.records[0]).toMatchObject({
      state: 'completed',
      method: 'GET',
      uri: '/api/customers/42',
      status: 200,
      durationMs: 125,
    });
    expect(activity.records[0]?.details).toHaveLength(3);
  });

  it('pairs correlated GET and POST requests and summarizes failures', () => {
    const output = [
      '2026-10-28 09:00:00.000 INFO traceId=req-a REQ START method=GET uri=/api/customers',
      '2026-10-28 09:00:00.125 INFO traceId=req-a REQ END method=GET uri=/api/customers status=200 duration=125ms',
      '2026-10-28 09:01:00.000 INFO requestId=req-b REQ START POST /api/orders',
      '2026-10-28 09:01:01.500 ERROR requestId=req-b REQ END POST /api/orders status=503 took=1.5s',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.summary).toMatchObject({ completed: 2, failed: 1, slowestMs: 1500 });
    expect(activity.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', uri: '/api/customers', status: 200, durationMs: 125, state: 'completed' }),
      expect.objectContaining({ method: 'POST', uri: '/api/orders', status: 503, durationMs: 1500, state: 'completed' }),
    ]));
  });

  it('uses REQ END duration and timestamp fields without calculating or inventing values', () => {
    const output = [
      '2026-10-28 10:00:00.000 INFO correlationId=req-1 REQ START GET /slow',
      '2026-10-28 10:00:09.000 INFO correlationId=req-1 REQ END status=204 duration=275ms',
      '2026-10-28 10:01:00.000 INFO REQ END method=GET uri=/unknown status=200',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.records[0]).toMatchObject({
      method: 'GET', uri: '/slow', status: 204, durationMs: 275,
      timestamp: '2026-10-28 10:00:00.000', completedTimestamp: '2026-10-28 10:00:09.000',
    });
    expect(activity.records[1]).toMatchObject({ method: 'GET', uri: '/unknown', status: 200, state: 'completed' });
    expect(activity.records[1]?.durationMs).toBeUndefined();
  });

  it('supports compact bracketed request records', () => {
    const output = [
      'INFO traceId=bracket-1 REQ START [POST] [/api/imports]',
      'INFO traceId=bracket-1 REQ END [POST] [/api/imports] [201] [48 ms]',
    ].join('\n');
    expect(parseApiActivity(output).records[0]).toMatchObject({
      method: 'POST', uri: '/api/imports', status: 201, durationMs: 48, state: 'completed',
    });
  });

  it('does not merge concurrent or sequential requests by method and URI alone', () => {
    const output = [
      'INFO REQ START GET /same',
      'INFO REQ START GET /same',
      'INFO REQ END GET /same status=200 duration=10ms',
      'INFO REQ END GET /same status=500 duration=20ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.records).toHaveLength(4);
    expect(activity.records.filter((record) => record.state === 'started')).toHaveLength(2);
    expect(activity.records.filter((record) => record.state === 'completed')).toHaveLength(2);
  });

  it('pairs interleaved requests only by reliable identifiers', () => {
    const output = [
      'INFO traceId=alpha REQ START GET /same',
      'INFO traceId=beta REQ START GET /same',
      'INFO traceId=beta REQ END status=404 duration=40ms',
      'INFO traceId=alpha REQ END status=200 duration=80ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.records).toHaveLength(2);
    expect(activity.records.find((record) => record.correlationId === 'alpha')).toMatchObject({ status: 200, durationMs: 80 });
    expect(activity.records.find((record) => record.correlationId === 'beta')).toMatchObject({ status: 404, durationMs: 40 });
  });

  it('correlates concurrent same-URI requests and assigns interleaved logs by context', () => {
    const output = [
      '2026-10-28 11:00:00.000 [http-nio-1] INFO [trace-a,alice] [701] --- c.p.RequestLogger : REQ START GET /api/shared',
      '2026-10-28 11:00:00.010 [http-nio-2] INFO [trace-b,bob] [701] --- c.p.RequestLogger : REQ START GET /api/shared',
      '2026-10-28 11:00:00.020 [http-nio-2] DEBUG [trace-b,bob] [701] --- c.p.Service : beta work',
      '2026-10-28 11:00:00.030 [http-nio-1] INFO [trace-a,alice] [701] --- c.p.Service : alpha work',
      '2026-10-28 11:00:00.080 [http-nio-2] ERROR [trace-b,bob] [701] --- c.p.RequestLogger : REQ END status=500 duration=70ms',
      '2026-10-28 11:00:00.100 [http-nio-1] INFO [trace-a,alice] [701] --- c.p.RequestLogger : REQ END status=200 duration=100ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.records).toHaveLength(2);
    expect(activity.summary).toMatchObject({ matched: 2, unmatchedStart: 0, unmatchedEnd: 0, associatedLogs: 2 });
    expect(activity.records.find((record) => record.correlationId === 'trace-a')?.details.map((detail) => detail.text)).toContainEqual(expect.stringContaining('alpha work'));
    expect(activity.records.find((record) => record.correlationId === 'trace-b')?.details.map((detail) => detail.text)).toContainEqual(expect.stringContaining('beta work'));
  });

  it('handles reused threads sequentially without using URI as correlation', () => {
    const output = [
      'INFO [http-nio-7] c.p.RequestLogger : REQ START GET /same',
      'INFO [http-nio-7] c.p.RequestLogger : REQ END status=200 duration=10ms',
      'INFO [http-nio-7] c.p.RequestLogger : REQ START GET /same',
      'INFO [http-nio-7] c.p.RequestLogger : REQ END status=201 duration=20ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.records).toHaveLength(2);
    expect(activity.summary.matched).toBe(2);
    expect(activity.records.map((record) => record.status)).toEqual([200, 201]);
  });

  it('prefers explicit request IDs when requests share a trace', () => {
    const output = [
      'INFO requestId=req-a traceId=shared REQ START GET /api/a',
      'INFO requestId=req-b traceId=shared REQ START GET /api/b',
      'DEBUG requestId=req-b traceId=shared beta work',
      'INFO requestId=req-b traceId=shared REQ END status=201 duration=12ms',
      'INFO requestId=req-a traceId=shared REQ END status=200 duration=15ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.summary).toMatchObject({ matched: 2, associatedLogs: 1 });
    expect(activity.records.find((record) => record.correlationId === 'req-b')).toMatchObject({ status: 201, internalLogCount: 1 });
  });

  it('keeps missing starts and ends explicit instead of fabricating relationships', () => {
    const output = [
      'INFO traceId=pending-1 REQ START POST /api/pending',
      'INFO traceId=orphan-end REQ END DELETE /api/orphan status=204 duration=8ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.records).toHaveLength(2);
    expect(activity.records[0]).toMatchObject({ state: 'started', startKnown: true, uri: '/api/pending' });
    expect(activity.records[1]).toMatchObject({ state: 'completed', startKnown: false, uri: '/api/orphan', status: 204 });
    expect(activity.summary).toMatchObject({ matched: 0, unmatchedStart: 1, unmatchedEnd: 1 });
  });

  it('keeps application logs outside request spans in the unassigned section', () => {
    const output = [
      'INFO c.p.Scheduler : background before request',
      'INFO traceId=req-1 REQ START GET /api/one',
      'INFO traceId=req-1 REQ END status=200 duration=5ms',
      'WARN c.p.Scheduler : background after request',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.summary.matched).toBe(1);
    expect(activity.unassignedLogs.map((detail) => detail.text)).toEqual([
      'INFO c.p.Scheduler : background before request',
      'WARN c.p.Scheduler : background after request',
    ]);
  });

  it('uses thread context to disambiguate a shared trace and leaves unsafe logs unassigned', () => {
    const output = [
      'INFO [http-nio-1] [shared-trace,user] c.p.RequestLogger : REQ START GET /api/a',
      'INFO [http-nio-2] [shared-trace,user] c.p.RequestLogger : REQ START GET /api/b',
      'INFO [shared-trace,user] c.p.Service : ambiguous work',
      'INFO [http-nio-1] [shared-trace,user] c.p.Service : alpha work',
      'INFO [http-nio-2] [shared-trace,user] c.p.Service : beta work',
      'INFO [http-nio-2] [shared-trace,user] c.p.RequestLogger : REQ END status=200 duration=20ms',
      'INFO [http-nio-1] [shared-trace,user] c.p.RequestLogger : REQ END status=200 duration=30ms',
    ].join('\n');

    const activity = parseApiActivity(output);
    expect(activity.summary).toMatchObject({ matched: 2, associatedLogs: 2 });
    expect(activity.unassignedLogs).toHaveLength(1);
    expect(activity.unassignedLogs[0]?.text).toContain('ambiguous work');
  });

  it('keeps multiline exceptions with the assigned request in chronological order', () => {
    const output = [
      '2026-10-28 12:00:00.000 [http-nio-3] INFO [trace-error,user] c.p.RequestLogger : REQ START POST /api/fail',
      '2026-10-28 12:00:00.010 [http-nio-3] ERROR [trace-error,user] c.p.Service : Processing failed',
      'java.lang.IllegalStateException: boom',
      '\tat com.proxima.Service.run(Service.java:42)',
      '2026-10-28 12:00:00.050 [http-nio-3] ERROR [trace-error,user] c.p.RequestLogger : REQ END status=500 duration=50ms',
    ].join('\n');

    const record = parseApiActivity(output).records[0]!;
    expect(record.internalLogCount).toBe(1);
    expect(record.details.map((detail) => detail.kind)).toEqual(['start', 'log', 'stack', 'stack', 'end']);
    expect(record.details[1]).toMatchObject({ level: 'ERROR', relativeMs: 10 });
  });

  it('correlates with retained evidence while displaying metadata-filtered masked lines', () => {
    const evidence = [
      '2026-10-28 13:00:00.000 [http-nio-4] INFO [trace-private,user] c.p.RequestLogger : REQ START GET /users/[REDACTED_EMAIL]',
      '2026-10-28 13:00:00.010 [http-nio-4] INFO [trace-private,user] c.p.Service : Loaded [REDACTED_EMAIL]',
      '2026-10-28 13:00:00.020 [http-nio-4] INFO [trace-private,user] c.p.RequestLogger : REQ END status=200 duration=20ms',
    ].join('\n');
    const display = [
      'REQ START GET /users/[REDACTED_EMAIL]',
      'Loaded [REDACTED_EMAIL]',
      'REQ END status=200 duration=20ms',
    ].join('\n');

    const activity = parseApiActivity(evidence, display);
    expect(activity.records).toHaveLength(1);
    expect(activity.records[0]).toMatchObject({ state: 'completed', internalLogCount: 1 });
    expect(activity.records[0]?.details.map((detail) => detail.text)).toEqual(display.split('\n'));
    expect(activity.records[0]?.details.map((detail) => detail.text).join('\n')).not.toContain('trace-private');
  });

  it('ignores malformed lines and handles large samples linearly', () => {
    const malformed = ['REQ START', 'REQ END nonsense', 'ordinary cleaned log line'];
    const requests = Array.from({ length: 2_000 }, (_, index) => [
      `INFO requestId=id-${index} REQ START GET /items/${index}`,
      `INFO requestId=id-${index} REQ END status=200 duration=${index % 250}ms`,
    ]).flat();

    const activity = parseApiActivity([...malformed, ...requests].join('\n'));
    expect(activity.records).toHaveLength(2_000);
    expect(activity.summary.completed).toBe(2_000);
    expect(activity.summary.failed).toBe(0);
    expect(activity.summary.slowestMs).toBe(249);
  });

  it('keeps sanitized evidence unchanged in record details', () => {
    const output = [
      'INFO traceId=req-sanitized REQ START GET /users/[REDACTED_EMAIL]',
      'INFO traceId=req-sanitized REQ END status=200 duration=4ms',
    ].join('\n');
    const activity = parseApiActivity(output);
    expect(activity.records[0]?.details.map((detail) => detail.text).join('\n')).toBe(output);
    expect(activity.records[0]?.uri).toBe('/users/[REDACTED_EMAIL]');
  });
});
