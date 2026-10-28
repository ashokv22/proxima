import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorPane } from './components/EditorPane';
import { ClipboardIcon, CopyIcon, PlayIcon, ShieldIcon, TrashIcon } from './components/Icon';
import { OutputPane } from './components/OutputPane';
import { ToggleChip } from './components/ToggleChip';
import { native } from './native';
import { loadLogMetadata, saveLogMetadata } from './preferences';
import type { AiAnalysis, AiViewStatus, Action, GlobalOptions, LogMetadataOptions, ProcessResult } from './types';

const ACTIONS: Action[] = ['Sanitize', 'Clean Logs', 'Sanitize + Clean'];
const DEFAULT_GLOBAL: GlobalOptions = {
  maskIps: true,
  maskEmails: true,
  maskPhones: false,
  removeThreads: true,
  removeLoggers: true,
};

const metadataLabels: Array<[keyof LogMetadataOptions, string]> = [
  ['keepTimestamp', 'Keep timestamp'],
  ['keepLogLevel', 'Keep log level'],
  ['keepTraceId', 'Keep trace ID'],
  ['keepUsername', 'Keep username'],
  ['keepPid', 'Keep process ID (PID)'],
];

const globalLabels: Array<[keyof GlobalOptions, string]> = [
  ['maskIps', 'Mask IPs'],
  ['maskEmails', 'Mask emails'],
  ['maskPhones', 'Mask phone candidates'],
  ['removeThreads', 'Remove threads'],
  ['removeLoggers', 'Remove logger names'],
];

const SAFE_PROCESS_ERRORS: Record<string, string> = {
  'Unsupported processing action.': 'Unsupported processing action',
};

const AI_ERRORS: Record<string, string> = {
  AI_NOT_RUNNING: 'llama.cpp is not running at 127.0.0.1:8000.',
  AI_TIMEOUT: 'The local model did not respond before the timeout.',
  AI_HTTP_ERROR: 'llama.cpp returned an unsuccessful response.',
  AI_INVALID_RESPONSE: 'llama.cpp returned an invalid response.',
  AI_INPUT_TOO_LARGE: 'The sanitized output is too large to analyze.',
  AI_NO_EVIDENCE: 'There is no sanitized evidence to analyze.',
};

function aiErrorCode(error: unknown): string {
  return typeof error === 'string' ? error : error instanceof Error ? error.message : '';
}

function processErrorStatus(error: unknown): string {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const safeMessage = SAFE_PROCESS_ERRORS[message];
  return safeMessage
    ? `Processing failed: ${safeMessage} · input unchanged`
    : 'Processing failed · input unchanged';
}

export default function App() {
  const [action, setAction] = useState<Action>('Sanitize');
  const [globalOptions, setGlobalOptions] = useState(DEFAULT_GLOBAL);
  const [logMetadata, setLogMetadata] = useState(loadLogMetadata);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [status, setStatus] = useState('Ready');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiViewStatus>('Not running');
  const [aiInsights, setAiInsights] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const editorArea = useRef<HTMLDivElement>(null);

  const clearSession = useCallback((message = 'Ready') => {
    setInput('');
    setOutput('');
    setResult(null);
    setStatus(message);
    setDetailsOpen(false);
    setAiInsights('');
    setAiError('');
    setAiAnalysis(null);
  }, []);

  const checkAiStatus = useCallback(async () => {
    try {
      const next = await native.checkAiStatus();
      setAiStatus(next.connected ? 'Connected' : 'Not running');
      setAiError(next.connected ? '' : 'llama.cpp is not running at 127.0.0.1:8000.');
    } catch {
      setAiStatus('Error');
      setAiError('Unable to check the local AI server.');
    }
  }, []);

  useEffect(() => saveLogMetadata(logMetadata), [logMetadata]);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    void native.shortcutStatus().then((shortcut) => {
      if (!disposed && !shortcut.available) setStatus('Global shortcut unavailable');
    }).catch(() => undefined);
    void native.onCloseRequested(() => clearSession()).then((unlisten) => cleanups.push(unlisten));
    void native.onClearSession(() => clearSession()).then((unlisten) => cleanups.push(unlisten));
    void checkAiStatus();
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [checkAiStatus, clearSession]);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const rect = editorArea.current?.getBoundingClientRect();
      if (!rect) return;
      const next = ((event.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(72, Math.max(28, next)));
    };
    const stop = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [dragging]);

  const processText = useCallback(async () => {
    if (!input.trim()) {
      setStatus('Input is empty');
      return;
    }
    setProcessing(true);
    try {
      const next = await native.process({ text: input, action, globalOptions, logMetadata });
      setOutput(next.text);
      setResult(next);
      setAiInsights('');
      setAiError('');
      setAiAnalysis(null);
      const total = Object.values(next.changes).reduce((sum, count) => sum + count, 0);
      setStatus(`${total} ${total === 1 ? 'change' : 'changes'}`);
    } catch (error) {
      setStatus(processErrorStatus(error));
    } finally {
      setProcessing(false);
    }
  }, [action, globalOptions, input, logMetadata]);

  const analyzeLogs = useCallback(async () => {
    if (!output) {
      setAiStatus('Error');
      setAiError('Process text before requesting AI insights.');
      return;
    }
    setAiStatus('Analyzing');
    setAiError('');
    setAiInsights('');
    setAiAnalysis(null);
    try {
      // Deliberately send only deterministic processor output, never `input`.
      const analysis = await native.analyzeLogs(output);
      setAiAnalysis(analysis);
      setAiInsights(analysis.content);
      setAiStatus('Connected');
    } catch (error) {
      const code = aiErrorCode(error);
      setAiStatus(code === 'AI_NOT_RUNNING' ? 'Not running' : 'Error');
      setAiError(AI_ERRORS[code] ?? 'Local AI analysis failed.');
    }
  }, [output]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        void processText();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [processText]);

  const paste = async () => {
    try {
      const text = await native.readClipboard();
      if (!text) {
        setStatus('Clipboard has no text');
        return;
      }
      if (text.length > 2_000_000) {
        setStatus('Clipboard text exceeds 2 million characters');
        return;
      }
      setInput(text);
      setOutput('');
      setResult(null);
      setAiInsights('');
      setAiError('');
      setAiAnalysis(null);
      setStatus(`${text.length.toLocaleString()} characters pasted`);
    } catch {
      setStatus('Unable to read the clipboard');
    }
  };

  const copy = async () => {
    if (!output) {
      setStatus('Nothing to copy');
      return;
    }
    try {
      await native.writeClipboard(output);
      setStatus('Output copied');
    } catch {
      setStatus('Unable to write to the clipboard');
    }
  };

  const detailText = useMemo(() => {
    if (!result) return 'No processing details yet.';
    const counts = Object.entries(result.changes).map(([label, count]) => `${label}: ${count}`).join(' · ');
    return [counts || 'No matching changes', ...result.warnings].join(' · ');
  }, [result]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-icon" aria-hidden="true"><ShieldIcon /></div>
        <div className="brand-copy">
          <h1>Local Text Workbench</h1>
          <div className="subtitle-row">
            <span>Private · Offline · Instant</span>
            <span className="shortcut-hint">Ctrl+Alt+Space</span>
          </div>
        </div>
        <div className="header-actions">
          <div className="local-badge"><ShieldIcon /> Local</div>
          <details className="app-menu">
            <summary aria-label="Application menu">•••</summary>
            <div className="menu-popover"><button type="button" onClick={() => void native.exit()}>Exit application</button></div>
          </details>
        </div>
      </header>

      <section className={`control-grid ${action === 'Clean Logs' ? 'with-options' : ''}`}>
        <label className="field">
          <span className="field-label">Action</span>
          <span className="select-wrap">
            <select value={action} onChange={(event) => setAction(event.target.value as Action)}>
              {ACTIONS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </span>
        </label>
        {action === 'Clean Logs' && (
          <div className="field">
            <span className="field-label">Options</span>
            <details className="options-dropdown">
              <summary>Clean Logs metadata</summary>
              <div className="options-popover">
                {metadataLabels.map(([key, label]) => (
                  <label key={key} className="metadata-option">
                    <input
                      type="checkbox"
                      checked={logMetadata[key]}
                      onChange={(event) => setLogMetadata((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
        )}
      </section>

      <section className="global-options" aria-labelledby="global-options-label">
        <h2 id="global-options-label">Global options</h2>
        <div className="chip-row">
          {globalLabels.map(([key, label]) => (
            <ToggleChip
              key={key}
              label={label}
              checked={globalOptions[key]}
              onChange={(checked) => setGlobalOptions((current) => ({ ...current, [key]: checked }))}
            />
          ))}
        </div>
      </section>

      <div
        ref={editorArea}
        className="editor-split"
        style={{ gridTemplateColumns: `minmax(0, ${split}fr) 8px minmax(0, ${100 - split}fr)` }}
      >
        <EditorPane id="input-editor" label="Input" value={input} placeholder="Paste logs, JSON, or text here…" onChange={setInput} />
        <button
          type="button"
          className="split-handle"
          aria-label="Resize editors"
          onPointerDown={() => setDragging(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setSplit((value) => Math.max(28, value - 2));
            if (event.key === 'ArrowRight') setSplit((value) => Math.min(72, value + 2));
          }}
        />
        <OutputPane
          output={output}
          prettyEvidence={result?.prettyEvidence}
          aiStatus={aiStatus}
          aiInsights={aiInsights}
          aiError={aiError}
          aiAnalysis={aiAnalysis}
          onAnalyze={() => void analyzeLogs()}
          onCheckStatus={() => void checkAiStatus()}
        />
      </div>

      <footer className="bottom-region">
        <div className="action-bar">
          <div className="summary-block">
            <span className="summary-text" role="status">{status}</span>
            <span className="review-text">Review before sharing</span>
            <button className="details-button" type="button" onClick={() => setDetailsOpen((open) => !open)}>
              {detailsOpen ? 'Hide details' : 'Details'}
            </button>
          </div>
          <div className="button-row">
            <button className="button secondary" type="button" onClick={() => void paste()}><ClipboardIcon />Paste</button>
            <button className="button primary" type="button" disabled={processing} onClick={() => void processText()}><PlayIcon />{processing ? 'Processing' : 'Process'}</button>
            <button className="button secondary" type="button" onClick={() => void copy()}><CopyIcon />Copy</button>
            <button className="button secondary" type="button" onClick={() => clearSession('Cleared')}><TrashIcon />Clear</button>
          </div>
        </div>
        {detailsOpen && <div className="details-panel">{detailText}</div>}
      </footer>
    </main>
  );
}
