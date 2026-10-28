import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  readClipboard: vi.fn(),
  writeClipboard: vi.fn(),
  shortcutStatus: vi.fn(),
  checkAiStatus: vi.fn(),
  analyzeLogs: vi.fn(),
  exit: vi.fn(),
  onCloseRequested: vi.fn(),
  onClearSession: vi.fn(),
}));

vi.mock('./native', () => ({ native: mocks }));

const inputEditor = () => screen.getByRole('textbox', { name: 'Input' });
const outputEditor = () => screen.getByRole('textbox', { name: 'Output' });

describe('Local Text Workbench shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shortcutStatus.mockResolvedValue({ available: true, shortcut: 'Ctrl+Alt+Space' });
    mocks.checkAiStatus.mockResolvedValue({ connected: true });
    mocks.analyzeLogs.mockResolvedValue({
      content: 'Observations\n- A timeout occurred.',
      evidenceLines: 2,
      evidenceBytes: 48,
      truncated: false,
    });
    mocks.onCloseRequested.mockResolvedValue(vi.fn());
    mocks.onClearSession.mockResolvedValue(vi.fn());
    mocks.process.mockResolvedValue({
      text: 'email=[REDACTED_EMAIL]',
      changes: { emails: 1 },
      warnings: ['Review before sharing externally.'],
    });
  });

  it('renders the three actions, dark editors, and five global controls', () => {
    render(<App />);
    const action = screen.getByLabelText('Action') as HTMLSelectElement;
    expect(Array.from(action.options).map((option) => option.text)).toEqual([
      'Sanitize', 'Clean Logs', 'Sanitize + Clean',
    ]);
    expect(inputEditor()).toHaveClass('editor');
    expect(outputEditor()).toHaveClass('editor');
    expect(screen.getAllByRole('switch')).toHaveLength(5);
    expect(screen.queryByText('Clean Logs metadata')).not.toBeInTheDocument();
  });

  it('shows metadata options only for Clean Logs and persists them', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Action'), 'Clean Logs');
    await user.click(screen.getByText('Clean Logs metadata'));
    const trace = screen.getByLabelText('Keep trace ID');
    expect(trace).toBeChecked();
    await user.click(trace);
    expect(trace).not.toBeChecked();
    expect(localStorage.getItem('local-text-workbench.log-metadata.v1')).toContain('"keepTraceId":false');
    await user.selectOptions(screen.getByLabelText('Action'), 'Sanitize');
    expect(screen.queryByText('Clean Logs metadata')).not.toBeInTheDocument();
  });

  it('sends action and toggle state to Rust and renders output statistics', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(inputEditor(), 'email=a@example.com');
    await user.click(screen.getByRole('switch', { name: 'Mask IPs' }));
    await user.click(screen.getByRole('button', { name: /^Process$/ }));
    await waitFor(() => expect(mocks.process).toHaveBeenCalledOnce());
    expect(mocks.process.mock.calls[0][0]).toMatchObject({
      text: 'email=a@example.com',
      action: 'Sanitize',
      globalOptions: { maskIps: false, maskEmails: true },
    });
    expect(outputEditor()).toHaveValue('email=[REDACTED_EMAIL]');
    expect(screen.getByRole('status')).toHaveTextContent('1 change');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/emails: 1/)).toBeInTheDocument();
  });

  it('sends all three processing actions through the native boundary', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(inputEditor(), 'password=hunter2');
    for (const action of ['Sanitize', 'Clean Logs', 'Sanitize + Clean']) {
      await user.selectOptions(screen.getByLabelText('Action'), action);
      await user.click(screen.getByRole('button', { name: /^Process$/ }));
    }
    await waitFor(() => expect(mocks.process).toHaveBeenCalledTimes(3));
    expect(mocks.process.mock.calls.map(([request]) => request.action)).toEqual([
      'Sanitize', 'Clean Logs', 'Sanitize + Clean',
    ]);
  });

  it('shows only allow-listed processing errors and never echoes rejected input', async () => {
    const user = userEvent.setup();
    mocks.process.mockRejectedValueOnce('Unsupported processing action.');
    render(<App />);
    await user.type(inputEditor(), 'password=do-not-display');
    await user.click(screen.getByRole('button', { name: /^Process$/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Processing failed: Unsupported processing action · input unchanged',
    );
    expect(outputEditor()).toHaveValue('');

    mocks.process.mockRejectedValueOnce(new Error('password=do-not-display'));
    await user.click(screen.getByRole('button', { name: /^Process$/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Processing failed · input unchanged'));
    expect(screen.getByRole('status')).not.toHaveTextContent('do-not-display');
  });

  it('connects paste, copy, clear, and Ctrl+Enter', async () => {
    const user = userEvent.setup();
    mocks.readClipboard.mockResolvedValue('email=a@example.com');
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(inputEditor()).toHaveValue('email=a@example.com');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mocks.process).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(mocks.writeClipboard).toHaveBeenCalledWith('email=[REDACTED_EMAIL]');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(inputEditor()).toHaveValue('');
    expect(outputEditor()).toHaveValue('');
  });

  it('never analyzes automatically and sends only sanitized output after explicit Analyze', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(inputEditor(), 'password=hunter2');
    await user.click(screen.getByRole('button', { name: /^Process$/ }));
    await waitFor(() => expect(mocks.process).toHaveBeenCalledOnce());
    expect(mocks.analyzeLogs).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'AI Insights' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Analyze$/ }));
    await waitFor(() => expect(mocks.analyzeLogs).toHaveBeenCalledOnce());
    expect(mocks.analyzeLogs).toHaveBeenCalledWith('email=[REDACTED_EMAIL]');
    expect(mocks.analyzeLogs.mock.calls[0][0]).not.toContain('hunter2');
    expect(await screen.findByText(/A timeout occurred/)).toBeInTheDocument();
  });

  it.each([
    ['AI_NOT_RUNNING', 'Not running', 'llama.cpp is not running'],
    ['AI_TIMEOUT', 'Error', 'did not respond before the timeout'],
    ['AI_HTTP_ERROR', 'Error', 'unsuccessful response'],
    ['AI_INVALID_RESPONSE', 'Error', 'invalid response'],
  ])('shows safe AI failure state for %s', async (code, status, message) => {
    const user = userEvent.setup();
    mocks.analyzeLogs.mockRejectedValueOnce(code);
    render(<App />);
    await user.type(inputEditor(), 'sanitized evidence');
    await user.click(screen.getByRole('button', { name: /^Process$/ }));
    await user.click(screen.getByRole('tab', { name: 'AI Insights' }));
    await user.click(screen.getByRole('button', { name: /^Analyze$/ }));
    expect(await screen.findByText(status)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('keeps Text available and shows a useful Pretty View empty state without API records', async () => {
    const user = userEvent.setup();
    mocks.process.mockResolvedValueOnce({
      text: '{"status":"ok"}',
      changes: {},
      warnings: [],
    });
    render(<App />);
    fireEvent.change(inputEditor(), { target: { value: '{"status":"ok"}' } });
    await user.click(screen.getByRole('button', { name: /^Process$/ }));
    await waitFor(() => expect(outputEditor()).toHaveValue('{"status":"ok"}'));
    await user.click(screen.getByRole('tab', { name: 'Pretty View' }));
    expect(screen.getByText('No supported API activity found')).toBeInTheDocument();
    expect(mocks.analyzeLogs).not.toHaveBeenCalled();
  });

  it('renders correlated API activity as compact Pretty View records', async () => {
    const user = userEvent.setup();
    mocks.process.mockResolvedValueOnce({
      text: [
        'REQ START GET /api/customers',
        'Loaded customer',
        'REQ END status=200 duration=125ms',
        'REQ START POST /api/orders',
        'Order service unavailable',
        'REQ END status=503 duration=1.5s',
      ].join('\n'),
      prettyEvidence: [
        '2026-10-28 09:00:00.000 [http-nio-1] INFO traceId=req-a REQ START GET /api/customers',
        '2026-10-28 09:00:00.050 [http-nio-1] INFO traceId=req-a Loaded customer',
        '2026-10-28 09:00:00.125 [http-nio-1] INFO traceId=req-a REQ END status=200 duration=125ms',
        '2026-10-28 09:01:00.000 [http-nio-2] INFO traceId=req-b REQ START POST /api/orders',
        '2026-10-28 09:01:00.500 [http-nio-2] ERROR traceId=req-b Order service unavailable',
        '2026-10-28 09:01:01.500 [http-nio-2] ERROR traceId=req-b REQ END status=503 duration=1.5s',
      ].join('\n'),
      changes: {},
      warnings: [],
    });
    render(<App />);
    await user.type(inputEditor(), 'sanitized log fixture');
    await user.click(screen.getByRole('button', { name: /^Process$/ }));
    await waitFor(() => expect((outputEditor() as HTMLTextAreaElement).value).toContain('REQ START'));
    await user.click(screen.getByRole('tab', { name: 'Pretty View' }));

    const summary = screen.getByLabelText('API activity summary');
    expect(summary).toHaveTextContent('Completed requests2');
    expect(summary).toHaveTextContent('Failed requests1');
    expect(summary).toHaveTextContent('Slowest response1.50 s');
    expect(screen.getByText('/api/customers', { selector: '.api-uri' })).toBeInTheDocument();
    expect(screen.getByText('/api/orders', { selector: '.api-uri' })).toBeInTheDocument();
    expect(screen.getByText('503', { selector: '.api-status' })).toHaveClass('api-status-server-error');
    expect(screen.getByText('1.50 s', { selector: '.api-duration' })).toBeInTheDocument();
    expect(screen.getAllByText('1 internal log')).toHaveLength(2);
    expect(mocks.analyzeLogs).not.toHaveBeenCalled();
  });

  it('clears sensitive DOM state before close and hotkey reopen', async () => {
    let closeHandler: (() => void) | undefined;
    let clearHandler: (() => void) | undefined;
    mocks.onCloseRequested.mockImplementation(async (handler: () => void) => {
      closeHandler = handler;
      return vi.fn();
    });
    mocks.onClearSession.mockImplementation(async (handler: () => void) => {
      clearHandler = handler;
      return vi.fn();
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(inputEditor(), 'sensitive clipboard text');
    await waitFor(() => expect(closeHandler).toBeDefined());
    closeHandler?.();
    await waitFor(() => expect(inputEditor()).toHaveValue(''));
    await user.type(inputEditor(), 'another secret');
    clearHandler?.();
    await waitFor(() => expect(inputEditor()).toHaveValue(''));
    expect(JSON.stringify(localStorage)).not.toContain('another secret');
  });

  it('connects the application Exit command', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText('Application menu'));
    await user.click(screen.getByRole('button', { name: 'Exit application' }));
    expect(mocks.exit).toHaveBeenCalledOnce();
  });
});
