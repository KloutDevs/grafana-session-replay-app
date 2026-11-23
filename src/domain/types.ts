export type LogFormat = 'json' | 'logfmt';

export interface PluginSettings {
  /** Uid of the Loki datasource that holds the Faro data. */
  lokiUid: string;
  /** LogQL stream selector, for example `{service_name="frontend"}`. */
  selector: string;
  /** Format of the log lines. */
  format: LogFormat;
  /** Seconds added around a chunk when querying Loki (ingestion delay). */
  clockPadSeconds: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  lokiUid: 'loki',
  selector: '{service_name="frontend"}',
  format: 'json',
  clockPadSeconds: 30,
};

/** Fields of one parsed log line. Values are always strings. */
export type Fields = Record<string, string>;

export interface Session {
  sessionId: string;
  appName: string;
  appEnvironment: string;
  /** Browser clock of the first recording marker, epoch ms (for display). */
  startedAtMs: number;
  /** Loki time of that marker, epoch ms (for queries: never mix it with the browser clock). */
  lokiStartMs: number;
  browser: string;
  userId: string;
  pageLoads: number;
  /** Undefined while the count is not known. */
  errorCount: number | undefined;
}

/** One checkout of one recording: starts with a Meta event and a full snapshot. */
export interface Chunk {
  key: string;
  recordingId: string;
  gen: number;
  /** Browser clock (rrweb timestamp) of the first event, epoch ms. */
  startMs: number;
  /** Browser clock of the end of the recorded part, epoch ms. */
  endMs: number;
  /** Loki time window that contains the chunk's lines, epoch ms. */
  lokiFromMs: number;
  lokiToMs: number;
  /** Page address of the Meta event, when known. */
  href: string;
}

export interface Gap {
  fromMs: number;
  toMs: number;
}

export interface Timeline {
  sessionId: string;
  /** Browser clock of the first recorded event. */
  startMs: number;
  endMs: number;
  chunks: Chunk[];
  gaps: Gap[];
  /** Milliseconds actually recorded (sum of chunk lengths). */
  recordedMs: number;
}

/** An rrweb event with its time, as recorded by Faro. */
export interface ReplayEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

export type JourneyKind = 'navigation' | 'log' | 'exception' | 'event' | 'measurement';
export type JourneyLevel = 'info' | 'warn' | 'error';

export interface JourneyItem {
  /** Browser clock, epoch ms. */
  atMs: number;
  kind: JourneyKind;
  level: JourneyLevel;
  title: string;
  detail: string;
  url: string;
}

export const EVENT_RECORDING = 'faro.session_recording.event';
export const EVENT_STARTED = 'faro.session_recording.started';
export const EVENT_PAUSED = 'faro.session_recording.paused';
export const EVENT_RESUMED = 'faro.session_recording.resumed';

export const RRWEB_FULL_SNAPSHOT = 2;
export const RRWEB_META = 4;
