import {
  EVENT_RECORDING,
  EVENT_STARTED,
  RRWEB_FULL_SNAPSHOT,
  RRWEB_META,
  type Chunk,
  type Fields,
  type JourneyItem,
  type PluginSettings,
  type ReplayEvent,
  type Session,
  type Timeline,
} from '../domain/types';
import { buildTimeline, type LastEvent, type MarkerPoint, type MetaPoint } from '../domain/timeline';
import { toJourneyItem } from './journey';
import { getAdapter, parseTimestamp, type LogFormatAdapter } from './logFormat';
import { contains, isValidSessionId, matches, notContains, rrwebTypeText } from './logql';
import type { LokiClient, LokiLine } from './lokiClient';
import { queryAll } from './windowedQuery';

const DEFAULT_ENTRY_LIMIT = 5000;
const MARKER_REGEX = String.raw`faro\.session_recording\.(started|paused|resumed)`;

export interface SessionsResult {
  sessions: Session[];
  incomplete: boolean;
}

export interface ChunkData {
  events: ReplayEvent[];
  /** Lines that could not be read and were skipped. */
  malformed: number;
  /** A Loki window stayed full at its smallest size. */
  incomplete: boolean;
  /** The chunk has a full snapshot, so it can be played. */
  playable: boolean;
}

export interface TimelineResult {
  timeline: Timeline;
  incomplete: boolean;
}

export interface JourneyResult {
  items: JourneyItem[];
  incomplete: boolean;
}

interface ReplayLine {
  fields: Fields;
  recordingId: string;
  gen: number;
  seq: number;
  event: ReplayEvent;
  lokiMs: number;
}

function parseReplayLine(adapter: LogFormatAdapter, line: LokiLine): ReplayLine | 'malformed' | undefined {
  const fields = adapter.parseLine(line.line);
  if (!fields) {
    return 'malformed';
  }
  if (fields['event_name'] !== EVENT_RECORDING) {
    return undefined;
  }
  const raw = fields['event_data_event'];
  const recordingId = fields['event_data_recording_id'];
  const gen = Number(fields['event_data_gen']);
  const seq = Number(fields['event_data_seq']);
  if (!raw || !recordingId || Number.isNaN(gen) || Number.isNaN(seq)) {
    return 'malformed';
  }
  try {
    const event = JSON.parse(raw) as ReplayEvent;
    if (typeof event.type !== 'number' || typeof event.timestamp !== 'number') {
      return 'malformed';
    }
    return { fields, recordingId, gen, seq, event, lokiMs: line.tsMs };
  } catch {
    return 'malformed';
  }
}

function hrefOf(event: ReplayEvent): string {
  const data = event.data as { href?: unknown } | undefined;
  return typeof data?.href === 'string' ? data.href : '';
}

export class SessionRepository {
  private readonly adapter: LogFormatAdapter;
  private readonly entryLimit: number;

  /** `entryLimit` must not exceed Loki's `max_entries_limit_per_query`. */
  constructor(
    private readonly client: LokiClient,
    private readonly settings: PluginSettings,
    options: { entryLimit?: number } = {}
  ) {
    this.adapter = getAdapter(settings.format);
    this.entryLimit = options.entryLimit ?? DEFAULT_ENTRY_LIMIT;
  }

  private get padMs(): number {
    return this.settings.clockPadSeconds * 1000;
  }

  private expr(...parts: string[]): string {
    return [this.settings.selector, ...parts].join(' ');
  }

  async listSessions(fromMs: number, toMs: number, signal?: AbortSignal): Promise<SessionsResult> {
    const { lines, incomplete } = await queryAll(this.client, {
      expr: this.expr(contains(EVENT_STARTED)),
      fromMs,
      toMs,
      limit: this.entryLimit,
      ...(signal ? { signal } : {}),
    });

    const bySession = new Map<
      string,
      { fields: Fields; startedAtMs: number; lokiStartMs: number; recordings: Set<string> }
    >();
    for (const line of lines) {
      const fields = this.adapter.parseLine(line.line);
      const sessionId = fields?.['session_id'];
      if (!fields || !sessionId || fields['event_name'] !== EVENT_STARTED) {
        continue;
      }
      const at = parseTimestamp(fields['timestamp']) ?? line.tsMs;
      const entry = bySession.get(sessionId);
      const recordingId = fields['event_data_recording_id'] ?? '';
      if (!entry) {
        bySession.set(sessionId, {
          fields,
          startedAtMs: at,
          lokiStartMs: line.tsMs,
          recordings: new Set([recordingId]),
        });
      } else {
        entry.recordings.add(recordingId);
        if (at < entry.startedAtMs) {
          entry.startedAtMs = at;
        }
        entry.lokiStartMs = Math.min(entry.lokiStartMs, line.tsMs);
      }
    }

    const sessions: Session[] = [...bySession.entries()].map(([sessionId, entry]) => ({
      sessionId,
      appName: entry.fields['app_name'] ?? '',
      appEnvironment: entry.fields['app_environment'] ?? '',
      startedAtMs: entry.startedAtMs,
      lokiStartMs: entry.lokiStartMs,
      browser: [entry.fields['browser_name'], (entry.fields['browser_version'] ?? '').split('.')[0]]
        .filter(Boolean)
        .join(' '),
      // Never the email: it is personal data.
      userId: entry.fields['user_id'] ?? entry.fields['user_username'] ?? '',
      pageLoads: entry.recordings.size,
      errorCount: undefined,
    }));
    sessions.sort((a, b) => b.startedAtMs - a.startedAtMs);
    return { sessions, incomplete };
  }

  /** Exceptions per session, counted by Loki. */
  async errorCounts(fromMs: number, toMs: number, signal?: AbortSignal): Promise<Map<string, number>> {
    const seconds = Math.max(1, Math.ceil((toMs - fromMs) / 1000));
    const expr =
      `sum by (session_id) (count_over_time(${this.expr(contains(this.adapter.kindText('exception')))} ` +
      `| ${this.adapter.parseStage} [${seconds}s]))`;
    const samples = await this.client.queryVector(expr, toMs, signal);
    const counts = new Map<string, number>();
    for (const sample of samples) {
      const id = sample.labels['session_id'];
      if (id) {
        counts.set(id, sample.value);
      }
    }
    return counts;
  }

  /** Loki time at which the session started, or undefined if it has no recording marker in the lookback. */
  async findSessionStart(
    sessionId: string,
    lookbackMs: number,
    nowMs: number,
    signal?: AbortSignal
  ): Promise<number | undefined> {
    if (!isValidSessionId(sessionId)) {
      return undefined;
    }
    const lines = await this.client.queryLines({
      expr: this.expr(contains(EVENT_STARTED), contains(sessionId)),
      fromMs: nowMs - lookbackMs,
      toMs: nowMs,
      limit: 200,
      direction: 'forward',
      ...(signal ? { signal } : {}),
    });
    let earliest: number | undefined;
    for (const line of lines) {
      const fields = this.adapter.parseLine(line.line);
      if (fields?.['session_id'] !== sessionId) {
        continue;
      }
      earliest = earliest === undefined ? line.tsMs : Math.min(earliest, line.tsMs);
    }
    return earliest;
  }

  async loadTimeline(sessionId: string, fromMs: number, toMs: number, signal?: AbortSignal): Promise<TimelineResult> {
    const base = { fromMs, toMs, limit: this.entryLimit, ...(signal ? { signal } : {}) };
    const [metaResult, markerResult, lastLines] = await Promise.all([
      queryAll(this.client, {
        ...base,
        expr: this.expr(contains(EVENT_RECORDING), contains(sessionId), contains(rrwebTypeText(RRWEB_META))),
      }),
      queryAll(this.client, {
        ...base,
        expr: this.expr(matches(MARKER_REGEX), contains(sessionId)),
      }),
      this.client.queryLines({
        expr: this.expr(contains(EVENT_RECORDING), contains(sessionId)),
        fromMs,
        toMs,
        limit: 1,
        direction: 'backward',
        ...(signal ? { signal } : {}),
      }),
    ]);

    const metas: MetaPoint[] = [];
    for (const line of metaResult.lines) {
      const parsed = parseReplayLine(this.adapter, line);
      // The text filter can also match a nested node type, so check the event itself.
      if (
        parsed &&
        parsed !== 'malformed' &&
        parsed.fields['session_id'] === sessionId &&
        parsed.event.type === RRWEB_META
      ) {
        metas.push({
          recordingId: parsed.recordingId,
          gen: parsed.gen,
          timestamp: parsed.event.timestamp,
          lokiMs: parsed.lokiMs,
          href: hrefOf(parsed.event),
        });
      }
    }

    const markers: MarkerPoint[] = [];
    for (const line of markerResult.lines) {
      const fields = this.adapter.parseLine(line.line);
      const name = fields?.['event_name'] ?? '';
      const kind = name.split('.').pop();
      if (
        !fields ||
        fields['session_id'] !== sessionId ||
        (kind !== 'started' && kind !== 'paused' && kind !== 'resumed')
      ) {
        continue;
      }
      markers.push({
        kind,
        recordingId: fields['event_data_recording_id'] ?? '',
        timestamp: parseTimestamp(fields['timestamp']) ?? line.tsMs,
        lokiMs: line.tsMs,
      });
    }

    let last: LastEvent | undefined;
    const lastLine = lastLines[0];
    if (lastLine) {
      const parsed = parseReplayLine(this.adapter, lastLine);
      if (parsed && parsed !== 'malformed') {
        last = { timestamp: parsed.event.timestamp, lokiMs: parsed.lokiMs };
      }
    }

    return {
      timeline: buildTimeline(sessionId, metas, markers, last, this.padMs),
      incomplete: metaResult.incomplete || markerResult.incomplete,
    };
  }

  async loadChunk(sessionId: string, chunk: Chunk, signal?: AbortSignal): Promise<ChunkData> {
    const { lines, incomplete } = await queryAll(this.client, {
      expr: this.expr(contains(EVENT_RECORDING), contains(sessionId)),
      fromMs: chunk.lokiFromMs,
      toMs: chunk.lokiToMs,
      limit: this.entryLimit,
      ...(signal ? { signal } : {}),
    });

    let malformed = 0;
    const bySeq = new Map<number, ReplayLine>();
    for (const line of lines) {
      const parsed = parseReplayLine(this.adapter, line);
      if (parsed === 'malformed') {
        malformed += 1;
        continue;
      }
      if (
        !parsed ||
        parsed.fields['session_id'] !== sessionId ||
        parsed.recordingId !== chunk.recordingId ||
        parsed.gen !== chunk.gen
      ) {
        continue;
      }
      bySeq.set(parsed.seq, parsed);
    }

    const ordered = [...bySeq.values()]
      .sort((a, b) => a.event.timestamp - b.event.timestamp || a.seq - b.seq)
      .map((entry) => entry.event);
    // A chunk plays from its own Meta event (or its snapshot when the Meta is missing).
    const start = ordered.findIndex((event) => event.type === RRWEB_META);
    const snapshot = ordered.findIndex((event) => event.type === RRWEB_FULL_SNAPSHOT);
    const playable = snapshot >= 0;
    const from = start >= 0 && start <= snapshot ? start : Math.max(snapshot, 0);
    return { events: playable ? ordered.slice(from) : ordered, malformed, incomplete, playable };
  }

  async loadJourney(sessionId: string, fromMs: number, toMs: number, signal?: AbortSignal): Promise<JourneyResult> {
    const { lines, incomplete } = await queryAll(this.client, {
      expr: this.expr(contains(sessionId), notContains(EVENT_RECORDING)),
      fromMs,
      toMs,
      limit: this.entryLimit,
      ...(signal ? { signal } : {}),
    });
    const items: JourneyItem[] = [];
    for (const line of lines) {
      const fields = this.adapter.parseLine(line.line);
      if (!fields || fields['session_id'] !== sessionId) {
        continue;
      }
      const item = toJourneyItem(fields, line.tsMs);
      if (item) {
        items.push(item);
      }
    }
    items.sort((a, b) => a.atMs - b.atMs);
    return { items, incomplete };
  }
}
