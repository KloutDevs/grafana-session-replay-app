import type { Chunk } from '../../domain/types';
import { ChunkLoader, priorityFor } from '../chunkLoader';
import type { ChunkData } from '../sessionRepository';

const chunk = (n: number): Chunk => ({
  key: `r:${n}`,
  recordingId: 'r',
  gen: n,
  startMs: n * 1000,
  endMs: n * 1000 + 500,
  lokiFromMs: 0,
  lokiToMs: 0,
  href: '',
});
const chunks = Array.from({ length: 10 }, (_, i) => chunk(i));
const data: ChunkData = { events: [], malformed: 0, incomplete: false, playable: true };

function deferred() {
  const calls: Array<{ chunk: Chunk; signal: AbortSignal; resolve: () => void; reject: (e: Error) => void }> = [];
  const loader = new ChunkLoader(
    (c, signal) =>
      new Promise<ChunkData>((resolve, reject) => {
        calls.push({ chunk: c, signal, resolve: () => resolve(data), reject });
      }),
    { concurrency: 4, maxLoaded: 3 }
  );
  return { loader, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('priorityFor', () => {
  it('puts the playhead first, then the next two, then outwards', () => {
    expect(priorityFor(chunks, 5).map((c) => c.gen)).toEqual([5, 6, 7, 4, 8, 3, 9, 2, 1, 0]);
  });

  it('works at the edges', () => {
    expect(
      priorityFor(chunks, 0)
        .map((c) => c.gen)
        .slice(0, 4)
    ).toEqual([0, 1, 2, 3]);
    expect(priorityFor(chunks, 9).map((c) => c.gen)[0]).toBe(9);
    expect(new Set(priorityFor(chunks, 9).map((c) => c.gen)).size).toBe(10);
  });
});

describe('ChunkLoader', () => {
  it('runs at most four requests at a time, in priority order', () => {
    const { loader, calls } = deferred();
    loader.want(priorityFor(chunks, 5));
    expect(calls.map((c) => c.chunk.gen)).toEqual([5, 6, 7, 4]);
    expect(loader.state('r:5').status).toBe('loading');
    expect(loader.state('r:3').status).toBe('unloaded');
  });

  it('starts the next request when one finishes', async () => {
    const { loader, calls } = deferred();
    loader.want(priorityFor(chunks, 5));
    calls[0]?.resolve();
    await flush();
    expect(loader.state('r:5').status).toBe('loaded');
    expect(calls.map((c) => c.chunk.gen)).toEqual([5, 6, 7, 4, 8]);
  });

  it('cancels requests that are no longer wanted', () => {
    const { loader, calls } = deferred();
    loader.want(priorityFor(chunks, 5));
    loader.want(priorityFor(chunks, 0));
    expect(calls.filter((c) => [4, 5, 6, 7].includes(c.chunk.gen)).every((c) => c.signal.aborted)).toBe(true);
    expect(calls.find((c) => c.chunk.gen === 5)?.signal.aborted).toBe(true);
    expect(loader.state('r:5').status).toBe('unloaded');
    expect(calls.filter((c) => !c.signal.aborted).map((c) => c.chunk.gen)).toEqual([0, 1, 2, 3]);
  });

  it('keeps a request that is still among the top wishes after a seek nearby', () => {
    const { loader, calls } = deferred();
    loader.want(priorityFor(chunks, 5));
    loader.want(priorityFor(chunks, 6));
    expect(calls.find((c) => c.chunk.gen === 5)?.signal.aborted).toBe(false);
    expect(calls.find((c) => c.chunk.gen === 4)?.signal.aborted).toBe(true);
  });

  it('ignores the answer of a cancelled request', async () => {
    const { loader, calls } = deferred();
    loader.want([chunk(1)]);
    loader.want([chunk(2)]);
    calls[0]?.resolve();
    await flush();
    expect(loader.state('r:1').status).toBe('unloaded');
  });

  it('keeps loaded chunks, and drops the farthest ones above the limit', async () => {
    const { loader, calls } = deferred();
    loader.want([chunk(0), chunk(1), chunk(2), chunk(3)]);
    calls.forEach((c) => c.resolve());
    await flush();
    const states = [0, 1, 2, 3].map((n) => loader.state(`r:${n}`).status);
    expect(states.filter((s) => s === 'loaded')).toHaveLength(3);
    expect(loader.state('r:3').status).toBe('unloaded');
  });

  it('reports a failure and can retry it', async () => {
    const { loader, calls } = deferred();
    loader.want([chunk(1)]);
    calls[0]?.reject(new Error('Loki down'));
    await flush();
    expect(loader.state('r:1')).toEqual({ status: 'failed', message: 'Loki down' });
    loader.retry('r:1');
    expect(calls).toHaveLength(2);
    expect(loader.state('r:1').status).toBe('loading');
  });

  it('adds up the lines that could not be read in the chunks it holds', async () => {
    const calls: Array<() => void> = [];
    const loader = new ChunkLoader(
      (c) => new Promise<ChunkData>((resolve) => calls.push(() => resolve({ ...data, malformed: c.gen + 1 }))),
      { concurrency: 4, maxLoaded: 12 }
    );
    loader.want([chunk(0), chunk(1)]);
    calls.forEach((resolve) => resolve());
    await flush();
    expect(loader.malformedTotal()).toBe(3);
  });

  it('notifies listeners and aborts everything on abortAll', async () => {
    const { loader, calls } = deferred();
    const seen: number[] = [];
    loader.subscribe(() => seen.push(loader.snapshotVersion()));
    loader.want([chunk(1)]);
    expect(seen.length).toBeGreaterThan(0);
    loader.abortAll();
    expect(calls[0]?.signal.aborted).toBe(true);
  });
});
