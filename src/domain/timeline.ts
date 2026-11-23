import type { Chunk, Gap, Timeline } from './types';

export interface MetaPoint {
  recordingId: string;
  gen: number;
  /** rrweb timestamp (browser clock), epoch ms. */
  timestamp: number;
  /** Loki time of the line, epoch ms. */
  lokiMs: number;
  href: string;
}

export interface MarkerPoint {
  kind: 'started' | 'paused' | 'resumed';
  recordingId: string;
  /** Browser time of the marker (falls back to the Loki time). */
  timestamp: number;
  lokiMs: number;
}

export interface LastEvent {
  timestamp: number;
  lokiMs: number;
}

const MIN_GAP_MS = 1000;

export function chunkKey(recordingId: string, gen: number): string {
  return `${recordingId}:${gen}`;
}

/**
 * Builds the timeline from the small index lines: one Meta per chunk, the
 * start/pause/resume markers, and the newest event of the session.
 */
export function buildTimeline(
  sessionId: string,
  metas: MetaPoint[],
  markers: MarkerPoint[],
  last: LastEvent | undefined,
  padMs: number
): Timeline {
  const unique = new Map<string, MetaPoint>();
  for (const meta of metas) {
    const key = chunkKey(meta.recordingId, meta.gen);
    const existing = unique.get(key);
    if (!existing || meta.timestamp < existing.timestamp) {
      unique.set(key, meta);
    }
  }
  const sorted = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);

  const chunks: Chunk[] = sorted.map((meta, i) => {
    const next = sorted[i + 1];
    const paused = markers
      .filter(
        (marker) =>
          marker.kind === 'paused' &&
          marker.recordingId === meta.recordingId &&
          marker.lokiMs >= meta.lokiMs &&
          (next === undefined || marker.lokiMs <= next.lokiMs)
      )
      .sort((a, b) => a.lokiMs - b.lokiMs)[0];

    const endMs = Math.max(
      meta.timestamp,
      paused ? paused.timestamp : (next?.timestamp ?? last?.timestamp ?? meta.timestamp)
    );
    const lokiEnd = paused ? paused.lokiMs : (next?.lokiMs ?? last?.lokiMs ?? meta.lokiMs);
    return {
      key: chunkKey(meta.recordingId, meta.gen),
      recordingId: meta.recordingId,
      gen: meta.gen,
      startMs: meta.timestamp,
      endMs,
      lokiFromMs: meta.lokiMs - padMs,
      lokiToMs: lokiEnd + padMs,
      href: meta.href,
    };
  });

  const gaps: Gap[] = [];
  for (let i = 0; i < chunks.length - 1; i += 1) {
    const current = chunks[i];
    const next = chunks[i + 1];
    if (current && next && next.startMs - current.endMs > MIN_GAP_MS) {
      gaps.push({ fromMs: current.endMs, toMs: next.startMs });
    }
  }

  const first = chunks[0];
  const lastChunk = chunks[chunks.length - 1];
  return {
    sessionId,
    startMs: first?.startMs ?? 0,
    endMs: lastChunk?.endMs ?? 0,
    chunks,
    gaps,
    recordedMs: chunks.reduce((sum, chunk) => sum + (chunk.endMs - chunk.startMs), 0),
  };
}

export interface Position {
  chunkIndex: number;
  /** Milliseconds from the start of the chunk. */
  offsetMs: number;
  /** Milliseconds of recorded time from the start of the session. */
  recordedMs: number;
}

function recordedBefore(timeline: Timeline, chunkIndex: number): number {
  let total = 0;
  for (let i = 0; i < chunkIndex; i += 1) {
    const chunk = timeline.chunks[i];
    if (chunk) {
      total += chunk.endMs - chunk.startMs;
    }
  }
  return total;
}

/**
 * Position for a browser-clock time. Inside a gap it snaps to the start of the
 * next chunk; before the session to the start; after it to the end.
 */
export function positionAtWall(timeline: Timeline, wallMs: number): Position | undefined {
  const { chunks } = timeline;
  if (chunks.length === 0) {
    return undefined;
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) {
      continue;
    }
    if (wallMs < chunk.startMs) {
      return { chunkIndex: i, offsetMs: 0, recordedMs: recordedBefore(timeline, i) };
    }
    if (wallMs <= chunk.endMs) {
      const offsetMs = wallMs - chunk.startMs;
      return { chunkIndex: i, offsetMs, recordedMs: recordedBefore(timeline, i) + offsetMs };
    }
  }
  const lastIndex = chunks.length - 1;
  const lastChunk = chunks[lastIndex];
  const length = lastChunk ? lastChunk.endMs - lastChunk.startMs : 0;
  return { chunkIndex: lastIndex, offsetMs: length, recordedMs: recordedBefore(timeline, lastIndex) + length };
}

/** Position for an amount of recorded time (the time shown on the player). */
export function positionAtRecorded(timeline: Timeline, recordedMs: number): Position | undefined {
  const { chunks } = timeline;
  if (chunks.length === 0) {
    return undefined;
  }
  let remaining = Math.max(0, recordedMs);
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) {
      continue;
    }
    const length = chunk.endMs - chunk.startMs;
    if (remaining < length || i === chunks.length - 1) {
      const offsetMs = Math.min(remaining, length);
      return { chunkIndex: i, offsetMs, recordedMs: recordedBefore(timeline, i) + offsetMs };
    }
    remaining -= length;
  }
  return undefined;
}

export function recordedAt(timeline: Timeline, chunkIndex: number, offsetMs: number): number {
  return recordedBefore(timeline, chunkIndex) + offsetMs;
}

/** Browser-clock time of a position. */
export function wallAt(timeline: Timeline, chunkIndex: number, offsetMs: number): number {
  const chunk = timeline.chunks[chunkIndex];
  return (chunk ? chunk.startMs : timeline.startMs) + offsetMs;
}

/**
 * Deep link value `t`: milliseconds on the browser clock since the start of the
 * session, counting the time between chunks, so a dashboard can compute it from
 * two timestamps. A negative value means "from the start".
 */
export function wallFromLink(timeline: Timeline, tMs: number): number {
  return timeline.startMs + Math.max(0, tMs);
}

export function linkOffsetAt(timeline: Timeline, wallMs: number): number {
  return Math.max(0, Math.round(wallMs - timeline.startMs));
}
