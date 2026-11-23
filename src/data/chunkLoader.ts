import type { Chunk } from '../domain/types';
import type { ChunkData } from './sessionRepository';

export type ChunkState =
  | { status: 'unloaded' }
  | { status: 'loading' }
  | { status: 'loaded'; data: ChunkData }
  | { status: 'failed'; message: string };

export type ChunkFetcher = (chunk: Chunk, signal: AbortSignal) => Promise<ChunkData>;

export interface ChunkLoaderOptions {
  concurrency?: number;
  /** Loaded chunks kept in memory; the farthest from the wanted ones are dropped first. */
  maxLoaded?: number;
}

/**
 * Loads chunks by priority, a few at a time. `want` replaces the wish list:
 * in-flight requests outside the top wishes are cancelled, loaded chunks stay in memory.
 */
export class ChunkLoader {
  private readonly states = new Map<string, ChunkState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<() => void>();
  private readonly concurrency: number;
  private readonly maxLoaded: number;
  private wanted: Chunk[] = [];
  private version = 0;

  constructor(
    private readonly fetchChunk: ChunkFetcher,
    options: ChunkLoaderOptions = {}
  ) {
    this.concurrency = options.concurrency ?? 4;
    this.maxLoaded = options.maxLoaded ?? 12;
  }

  state(key: string): ChunkState {
    return this.states.get(key) ?? { status: 'unloaded' };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  /** Lines skipped because they could not be read, over the chunks in memory. */
  malformedTotal(): number {
    let total = 0;
    for (const state of this.states.values()) {
      if (state.status === 'loaded') {
        total += state.data.malformed;
      }
    }
    return total;
  }

  /** Changes on every state change; usable as a snapshot for React. */
  snapshotVersion(): number {
    return this.version;
  }

  want(chunks: Chunk[]): void {
    this.wanted = chunks;
    // Requests outside the first `concurrency` wishes would only hold a slot that the
    // chunks at the playhead need, so they are cancelled.
    const keys = new Set(chunks.slice(0, this.concurrency).map((chunk) => chunk.key));
    for (const [key, controller] of this.controllers) {
      if (!keys.has(key)) {
        controller.abort();
        this.controllers.delete(key);
        this.states.set(key, { status: 'unloaded' });
      }
    }
    this.pump();
    this.evict();
    this.emit();
  }

  retry(key: string): void {
    if (this.state(key).status === 'failed') {
      this.states.set(key, { status: 'unloaded' });
      this.pump();
      this.emit();
    }
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
    this.wanted = [];
  }

  private pump(): void {
    for (const chunk of this.wanted) {
      if (this.controllers.size >= this.concurrency) {
        return;
      }
      if (this.state(chunk.key).status === 'unloaded') {
        this.start(chunk);
      }
    }
  }

  private start(chunk: Chunk): void {
    const controller = new AbortController();
    this.controllers.set(chunk.key, controller);
    this.states.set(chunk.key, { status: 'loading' });
    this.fetchChunk(chunk, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) {
          return;
        }
        this.controllers.delete(chunk.key);
        this.states.set(chunk.key, { status: 'loaded', data });
        this.pump();
        this.evict();
        this.emit();
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        this.controllers.delete(chunk.key);
        this.states.set(chunk.key, {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
        this.pump();
        this.emit();
      }
    );
  }

  private evict(): void {
    const loaded = [...this.states.entries()].filter(([, state]) => state.status === 'loaded').map(([key]) => key);
    if (loaded.length <= this.maxLoaded) {
      return;
    }
    const order = new Map(this.wanted.map((chunk, index) => [chunk.key, index]));
    loaded.sort((a, b) => (order.get(b) ?? Infinity) - (order.get(a) ?? Infinity));
    for (const key of loaded.slice(0, loaded.length - this.maxLoaded)) {
      this.states.set(key, { status: 'unloaded' });
    }
  }
}

/**
 * Wish list for a playhead: the chunk at the playhead first, then the next two,
 * then outwards (previous, next, …).
 */
export function priorityFor(chunks: Chunk[], playheadIndex: number): Chunk[] {
  const result: Chunk[] = [];
  const add = (index: number) => {
    const chunk = chunks[index];
    if (chunk && !result.includes(chunk)) {
      result.push(chunk);
    }
  };
  add(playheadIndex);
  add(playheadIndex + 1);
  add(playheadIndex + 2);
  for (let distance = 1; distance < chunks.length; distance += 1) {
    add(playheadIndex - distance);
    add(playheadIndex + distance + 2);
  }
  return result;
}
