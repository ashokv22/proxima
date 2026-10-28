export type Action = 'Sanitize' | 'Clean Logs' | 'Sanitize + Clean';

export interface GlobalOptions {
  maskIps: boolean;
  maskEmails: boolean;
  maskPhones: boolean;
  removeThreads: boolean;
  removeLoggers: boolean;
}

export interface LogMetadataOptions {
  keepTimestamp: boolean;
  keepLogLevel: boolean;
  keepTraceId: boolean;
  keepUsername: boolean;
  keepPid: boolean;
}

export interface ProcessRequest {
  text: string;
  action: Action;
  globalOptions: GlobalOptions;
  logMetadata: LogMetadataOptions;
}

export interface ProcessResult {
  text: string;
  changes: Record<string, number>;
  warnings: string[];
  /** Sanitized, in-memory-only evidence retaining fields needed by Pretty View. */
  prettyEvidence?: string;
}

export interface ShortcutStatus {
  shortcut: string | null;
  available: boolean;
}

export interface AiStatusResult {
  connected: boolean;
}

export interface AiAnalysis {
  content: string;
  evidenceLines: number;
  evidenceBytes: number;
  truncated: boolean;
}

export type AiViewStatus = 'Connected' | 'Not running' | 'Analyzing' | 'Error';
