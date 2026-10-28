import type { LogMetadataOptions } from './types';

export const DEFAULT_LOG_METADATA: LogMetadataOptions = {
  keepTimestamp: true,
  keepLogLevel: true,
  keepTraceId: true,
  keepUsername: true,
  keepPid: true,
};

const KEY = 'local-text-workbench.log-metadata.v1';

export function loadLogMetadata(): LogMetadataOptions {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (!value || typeof value !== 'object') return { ...DEFAULT_LOG_METADATA };
    const candidate = value as Record<string, unknown>;
    if (!Object.keys(DEFAULT_LOG_METADATA).every((key) => typeof candidate[key] === 'boolean')) {
      return { ...DEFAULT_LOG_METADATA };
    }
    return { ...DEFAULT_LOG_METADATA, ...candidate } as LogMetadataOptions;
  } catch {
    return { ...DEFAULT_LOG_METADATA };
  }
}

export function saveLogMetadata(value: LogMetadataOptions): void {
  localStorage.setItem(KEY, JSON.stringify(value));
}
