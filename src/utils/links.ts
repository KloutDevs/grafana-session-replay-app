import { PLUGIN_BASE_URL, ROUTES } from '../constants';

export interface ReplayLinkOptions {
  /** Milliseconds on the browser clock since the start of the session. */
  t?: number;
  from?: number;
  to?: number;
}

export function sessionsPath(): string {
  return `${PLUGIN_BASE_URL}/${ROUTES.Sessions}`;
}

export function replayPath(sessionId: string, options: ReplayLinkOptions = {}): string {
  const params = new URLSearchParams();
  if (options.t !== undefined) {
    params.set('t', String(Math.round(options.t)));
  }
  if (options.from !== undefined) {
    params.set('from', String(Math.round(options.from)));
  }
  if (options.to !== undefined) {
    params.set('to', String(Math.round(options.to)));
  }
  const query = params.toString();
  return `${PLUGIN_BASE_URL}/${ROUTES.Session}/${encodeURIComponent(sessionId)}${query ? `?${query}` : ''}`;
}

/** A finite number from a URL parameter, or undefined. */
export function numberParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
