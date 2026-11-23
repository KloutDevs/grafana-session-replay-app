import pluginJson from './plugin.json';

export const PLUGIN_ID = pluginJson.id;
export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Sessions = 'sessions',
  Session = 'session',
}

export const LOOKBACKS = [
  { label: 'Last 15 minutes', value: '15m', ms: 15 * 60_000 },
  { label: 'Last hour', value: '1h', ms: 3_600_000 },
  { label: 'Last 6 hours', value: '6h', ms: 6 * 3_600_000 },
  { label: 'Last 24 hours', value: '24h', ms: 24 * 3_600_000 },
  { label: 'Last 7 days', value: '7d', ms: 7 * 86_400_000 },
] as const;

/** Time a session is searched for when a link carries no time range. */
export const SESSION_LOOKBACK_MS = 7 * 86_400_000;
/** Longest span read for one session when a link carries no time range. */
export const SESSION_SPAN_MS = 24 * 3_600_000;
/** Seconds before an event at which a jump to the event starts. */
export const JUMP_LEAD_MS = 3000;
