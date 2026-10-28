import { useEffect, useMemo, useState } from 'react';
import { parseApiActivity, SLOW_REQUEST_MS } from '../prettyOutput';
import type { AiAnalysis, AiViewStatus } from '../types';

type OutputTab = 'text' | 'pretty' | 'ai';
const API_PAGE_SIZE = 250;

interface OutputPaneProps {
  output: string;
  prettyEvidence?: string;
  aiStatus: AiViewStatus;
  aiInsights: string;
  aiError: string;
  aiAnalysis: AiAnalysis | null;
  onAnalyze: () => void;
  onCheckStatus: () => void;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '—';
  if (durationMs >= 1_000) return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`;
  if (durationMs < 1) return `${Math.round(durationMs * 1_000)} µs`;
  return `${Number.isInteger(durationMs) ? durationMs : durationMs.toFixed(1)} ms`;
}

function formatRelative(relativeMs: number | undefined): string {
  if (relativeMs === undefined) return '';
  return `+${formatDuration(relativeMs)}`;
}

export function OutputPane({
  output,
  prettyEvidence,
  aiStatus,
  aiInsights,
  aiError,
  aiAnalysis,
  onAnalyze,
  onCheckStatus,
}: OutputPaneProps) {
  const [tab, setTab] = useState<OutputTab>('text');
  const [visibleApiRecords, setVisibleApiRecords] = useState(API_PAGE_SIZE);
  const apiActivity = useMemo(
    () => parseApiActivity(prettyEvidence ?? output, output),
    [output, prettyEvidence],
  );
  const analyzing = aiStatus === 'Analyzing';

  useEffect(() => setVisibleApiRecords(API_PAGE_SIZE), [output]);

  const loadMoreApiRecords = (element: HTMLDivElement) => {
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 240 && visibleApiRecords < apiActivity.records.length) {
      setVisibleApiRecords((current) => Math.min(current + API_PAGE_SIZE, apiActivity.records.length));
    }
  };

  return (
    <section className="editor-panel output-panel" aria-label="Output section">
      <header className="editor-header output-header">
        <nav className="output-tabs" aria-label="Output views">
          {([['text', 'Text'], ['pretty', 'Pretty View'], ['ai', 'AI Insights']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className="output-tab"
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="ai-status" data-status={aiStatus.toLowerCase().replace(' ', '-')}>{aiStatus}</span>
      </header>

      {tab === 'text' && (
        <textarea
          id="output-editor"
          className="editor"
          value={output}
          placeholder="Processed text appears here"
          readOnly
          wrap="off"
          spellCheck={false}
          aria-label="Output"
        />
      )}
      {tab === 'pretty' && (
        <div
          className="editor pretty-view"
          aria-label="Pretty View"
          role="region"
          onScroll={(event) => loadMoreApiRecords(event.currentTarget)}
        >
          {apiActivity.records.length ? (
            <>
              <div className="api-summary" aria-label="API activity summary">
                <div className="api-metric">
                  <span>Completed requests</span>
                  <strong>{apiActivity.summary.completed}</strong>
                </div>
                <div className={`api-metric${apiActivity.summary.failed ? ' api-metric-failed' : ''}`}>
                  <span>Failed requests</span>
                  <strong>{apiActivity.summary.failed}</strong>
                </div>
                <div className="api-metric">
                  <span>Slowest response</span>
                  <strong>{formatDuration(apiActivity.summary.slowestMs)}</strong>
                </div>
              </div>
              <div className="api-list" role="list" aria-label="API activity">
                {apiActivity.records.slice(0, visibleApiRecords).map((record) => {
                  const failed = record.status !== undefined && record.status >= 400;
                  const slow = record.durationMs !== undefined && record.durationMs >= SLOW_REQUEST_MS;
                  const statusClass = record.status === undefined
                    ? 'unknown'
                    : record.status >= 500
                      ? 'server-error'
                      : record.status >= 400
                        ? 'client-error'
                        : record.status >= 200
                          ? 'success'
                          : 'neutral';
                  const timestamp = record.timestamp;
                  return (
                    <details
                      className={`api-record${failed ? ' api-record-failed' : ''}${slow ? ' api-record-slow' : ''}`}
                      key={record.id}
                      role="listitem"
                    >
                      <summary>
                        <span className="api-card-primary">
                          <span className={`api-status api-status-${statusClass}`}>
                            {record.status ?? (record.state === 'started' ? 'Pending' : '—')}
                          </span>
                          <span className={`api-method api-method-${record.method?.toLowerCase() ?? 'unknown'}`}>
                            {record.method ?? '—'}
                          </span>
                          <span className="api-duration">{formatDuration(record.durationMs)}</span>
                        </span>
                        <span className="api-uri">{record.uri ?? 'URI unavailable'}</span>
                        <span className="api-card-footer">
                          <span className="api-timestamp">{timestamp ?? '—'}</span>
                          <span className="api-log-count">
                            {record.internalLogCount} {record.internalLogCount === 1 ? 'internal log' : 'internal logs'}
                          </span>
                          <span className="api-chevron" aria-hidden="true" />
                        </span>
                      </summary>
                      <div className="api-record-details">
                        <dl className="api-request-metadata">
                          {record.uri && <div><dt>Full URI</dt><dd><code>{record.uri}</code></dd></div>}
                          {record.method && <div><dt>HTTP method</dt><dd>{record.method}</dd></div>}
                          {record.status !== undefined && <div><dt>Status</dt><dd>{record.status}</dd></div>}
                          {record.durationMs !== undefined && <div><dt>Duration</dt><dd>{formatDuration(record.durationMs)}</dd></div>}
                          {timestamp && <div><dt>Start timestamp</dt><dd>{timestamp}</dd></div>}
                          {record.completedTimestamp && <div><dt>End timestamp</dt><dd>{record.completedTimestamp}</dd></div>}
                          {record.correlationId && <div><dt>Correlation ID</dt><dd><code>{record.correlationId}</code></dd></div>}
                        </dl>
                        <ol className="api-timeline" aria-label="Request activity">
                          {record.details.map((detail) => (
                            <li
                              className={`api-timeline-entry api-timeline-${detail.kind}${detail.level ? ` api-level-${detail.level.toLowerCase()}` : ''}`}
                              key={`${detail.line}-${detail.kind}`}
                            >
                              <span className="api-timeline-meta">
                                <span>{detail.kind === 'start' ? 'Request start' : detail.kind === 'end' ? 'Request end' : detail.kind === 'stack' ? 'Stack trace' : detail.level ?? 'Log'}</span>
                                <span className="api-timeline-times">
                                  {detail.timestamp && <time>{detail.timestamp}</time>}
                                  {detail.relativeMs !== undefined && <time>{formatRelative(detail.relativeMs)}</time>}
                                </span>
                              </span>
                              <code>{detail.text}</code>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </details>
                  );
                })}
                {visibleApiRecords < apiActivity.records.length && (
                  <div className="api-more" aria-live="polite">
                    Showing {visibleApiRecords.toLocaleString()} of {apiActivity.records.length.toLocaleString()} · Scroll for more
                  </div>
                )}
                {apiActivity.unassignedLogs.length > 0 && (
                  <details className="api-unassigned">
                    <summary>
                      <span>Unassigned Logs</span>
                      <span>{apiActivity.unassignedLogs.length}</span>
                    </summary>
                    <ol className="api-timeline" aria-label="Unassigned logs">
                      {apiActivity.unassignedLogs.map((detail) => (
                        <li
                          className={`api-timeline-entry api-timeline-${detail.kind}${detail.level ? ` api-level-${detail.level.toLowerCase()}` : ''}`}
                          key={`${detail.line}-${detail.kind}`}
                        >
                          <span className="api-timeline-meta"><span>{detail.level ?? 'Log'}</span></span>
                          <code>{detail.text}</code>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            </>
          ) : (
            <div className="pretty-empty">
              <strong>No supported API activity found</strong>
              <span>Pretty View recognizes cleaned REQ START and REQ END records. The complete output remains available in Text.</span>
            </div>
          )}
        </div>
      )}
      {tab === 'ai' && (
        <div className="ai-view" aria-label="AI Insights view">
          <div className="ai-toolbar">
            <div>
              <strong>Local AI Insights</strong>
              <p>Only a bounded subset of the sanitized output is sent to llama.cpp.</p>
            </div>
            <div className="ai-actions">
              <button type="button" className="details-button" onClick={onCheckStatus}>Check connection</button>
              <button
                type="button"
                className="button primary analyze-button"
                disabled={!output || analyzing}
                onClick={onAnalyze}
              >
                {analyzing ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
          </div>
          {aiError && <div className="ai-error" role="alert">{aiError}</div>}
          {aiInsights ? (
            <div className="ai-response">
              <pre>{aiInsights}</pre>
              {aiAnalysis && (
                <p className="ai-evidence-meta">
                  Used {aiAnalysis.evidenceLines} lines · {aiAnalysis.evidenceBytes.toLocaleString()} bytes
                  {aiAnalysis.truncated ? ' · subset truncated' : ''}
                </p>
              )}
            </div>
          ) : (
            <div className="ai-empty">
              {output ? 'Select Analyze when you want local, evidence-based observations.' : 'Process text before requesting AI insights.'}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
