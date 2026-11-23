import type { Fields, LogFormat } from '../domain/types';

const LOGFMT_PAIR = /([A-Za-z_][\w.]*)=("(?:\\.|[^"\\])*"|[^\s"]*)/g;

function unquote(raw: string): string {
  if (!raw.startsWith('"')) {
    return raw;
  }
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.slice(1, -1);
  }
}

/** Parses one logfmt line (Go quoting: `\"`, `\\`, `\n`). */
export function parseLogfmt(line: string): Fields {
  const fields: Fields = {};
  for (const match of line.matchAll(LOGFMT_PAIR)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      fields[key] = unquote(value);
    }
  }
  return fields;
}

/** Parses one flat JSON line. Every value becomes a string. */
export function parseJsonLine(line: string): Fields | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const fields: Fields = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) {
      continue;
    }
    fields[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return fields;
}

export interface LogFormatAdapter {
  readonly id: LogFormat;
  /** LogQL parser stage name (`json` or `logfmt`). */
  readonly parseStage: 'json' | 'logfmt';
  /** Returns undefined when the line is not in this format. */
  parseLine(line: string): Fields | undefined;
  /** Text that appears in a line of this format when `kind` equals `value`. */
  kindText(value: string): string;
}

export const jsonAdapter: LogFormatAdapter = {
  id: 'json',
  parseStage: 'json',
  parseLine: parseJsonLine,
  kindText: (value) => `"kind":"${value}"`,
};

export const logfmtAdapter: LogFormatAdapter = {
  id: 'logfmt',
  parseStage: 'logfmt',
  parseLine(line) {
    const fields = parseLogfmt(line);
    return Object.keys(fields).length > 0 ? fields : undefined;
  },
  kindText: (value) => `kind=${value}`,
};

export function getAdapter(format: LogFormat): LogFormatAdapter {
  return format === 'json' ? jsonAdapter : logfmtAdapter;
}

/**
 * Browser time of a line. Faro writes `timestamp` as a Go time
 * (`2026-11-22 02:14:02.291 +0000 UTC`) or as ISO 8601. Returns undefined when
 * it cannot be read, so callers can fall back to the Loki time.
 */
export function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const go = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) ([+-]\d{2})(\d{2}) /.exec(value);
  const iso = go ? `${go[1]}T${go[2]}${go[3]}:${go[4]}` : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}
