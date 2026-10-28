import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { AiAnalysis, AiStatusResult, ProcessRequest, ProcessResult, ShortcutStatus } from './types';

export const native = {
  process(request: ProcessRequest): Promise<ProcessResult> {
    return invoke<ProcessResult>('process_text', { request });
  },
  readClipboard(): Promise<string> {
    return readText();
  },
  writeClipboard(text: string): Promise<void> {
    return writeText(text);
  },
  shortcutStatus(): Promise<ShortcutStatus> {
    return invoke<ShortcutStatus>('shortcut_status');
  },
  checkAiStatus(): Promise<AiStatusResult> {
    return invoke<AiStatusResult>('check_ai_status');
  },
  analyzeLogs(evidence: string): Promise<AiAnalysis> {
    return invoke<AiAnalysis>('analyze_logs', { evidence });
  },
  exit(): Promise<void> {
    return invoke<void>('exit_app');
  },
  onCloseRequested(handler: () => void | Promise<void>) {
    return getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await handler();
      await getCurrentWindow().hide();
    });
  },
  onClearSession(handler: () => void) {
    return getCurrentWindow().listen('clear-session', handler);
  },
};
