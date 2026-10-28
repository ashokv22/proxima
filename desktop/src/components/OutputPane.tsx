import { useMemo, useState } from 'react';
import { buildPrettyLines } from '../prettyOutput';
import type { AiAnalysis, AiViewStatus } from '../types';

type OutputTab = 'text' | 'pretty' | 'ai';

interface OutputPaneProps {
  output: string;
  aiStatus: AiViewStatus;
  aiInsights: string;
  aiError: string;
  aiAnalysis: AiAnalysis | null;
  onAnalyze: () => void;
  onCheckStatus: () => void;
}

export function OutputPane({
  output,
  aiStatus,
  aiInsights,
  aiError,
  aiAnalysis,
  onAnalyze,
  onCheckStatus,
}: OutputPaneProps) {
  const [tab, setTab] = useState<OutputTab>('text');
  const prettyLines = useMemo(() => buildPrettyLines(output), [output]);
  const analyzing = aiStatus === 'Analyzing';

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
        <div className="editor pretty-view" aria-label="Pretty View" role="region">
          {prettyLines.length ? prettyLines.map((line, lineIndex) => (
            <div className={`pretty-line pretty-line-${line.kind}`} key={lineIndex}>
              <span className="pretty-line-number" aria-hidden="true">{lineIndex + 1}</span>
              <code className="pretty-line-content">
                {line.tokens.length ? line.tokens.map((token, tokenIndex) => (
                  <span
                    className={`pretty-token pretty-token-${token.kind}${token.level ? ` pretty-level-${token.level}` : ''}`}
                    key={tokenIndex}
                  >
                    {token.text}
                  </span>
                )) : '\u00a0'}
              </code>
            </div>
          )) : <span className="empty-view">Processed text appears here</span>}
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
