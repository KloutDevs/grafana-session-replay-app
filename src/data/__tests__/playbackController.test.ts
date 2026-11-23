import type { Chunk, ReplayEvent, Timeline } from '../../domain/types';
import { buildTimeline } from '../../domain/timeline';
import { ChunkLoader } from '../chunkLoader';
import { PlaybackController, type PlaybackState, type ReplayerLike } from '../playbackController';
import type { ChunkData } from '../sessionRepository';

const T0 = 5_000_000;
const timeline: Timeline = buildTimeline(
  's',
  [0, 1, 2].map((gen) => ({
    recordingId: 'r',
    gen,
    timestamp: T0 + gen * 100_000,
    lokiMs: T0 + gen * 100_000,
    href: '',
  })),
  [0, 1].map((gen) => ({
    kind: 'paused' as const,
    recordingId: 'r',
    timestamp: T0 + gen * 100_000 + 40_000,
    lokiMs: T0 + gen * 100_000 + 40_000,
  })),
  { timestamp: T0 + 200_000 + 30_000, lokiMs: T0 + 230_000 },
  0
);

class FakeReplayer implements ReplayerLike {
  time = 0;
  playing = false;
  destroyed = false;
  config: Record<string, unknown> = {};
  handlers: Record<string, () => void> = {};
  playedFrom: number[] = [];
  pausedAt: number[] = [];
  constructor(public events: ReplayEvent[]) {}
  play(t = 0) {
    this.time = t;
    this.playing = true;
    this.playedFrom.push(t);
  }
  pause(t?: number) {
    if (t !== undefined) {
      this.time = t;
    }
    this.playing = false;
    this.pausedAt.push(t ?? this.time);
  }
  getCurrentTime() {
    return this.time;
  }
  setConfig(c: Record<string, unknown>) {
    Object.assign(this.config, c);
  }
  on(e: string, h: () => void) {
    this.handlers[e] = h;
  }
  destroy() {
    this.destroyed = true;
  }
}

function setup(playable: boolean[] = [true, true, true]) {
  const replayers: FakeReplayer[] = [];
  const pending = new Map<string, (d: ChunkData) => void>();
  const loader = new ChunkLoader(
    (chunk: Chunk) =>
      new Promise<ChunkData>((resolve) => {
        pending.set(chunk.key, resolve);
      })
  );
  const states: PlaybackState[] = [];
  const controller = new PlaybackController(
    timeline,
    loader,
    (events) => {
      const r = new FakeReplayer(events);
      replayers.push(r);
      return r;
    },
    (s) => states.push(s)
  );
  const finish = async (gen: number) => {
    const ok = playable[gen] ?? true;
    pending.get(`r:${gen}`)?.({
      events: [{ type: 4, timestamp: 0, data: {} }],
      malformed: 0,
      incomplete: false,
      playable: ok,
    });
    await Promise.resolve();
    await Promise.resolve();
  };
  return { controller, loader, replayers, finish, states };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('PlaybackController', () => {
  it('waits for a chunk to load, then plays from the requested offset', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0 + 20_000, true);
    expect(controller.state.status).toBe('loading');
    expect(replayers).toHaveLength(0);
    await finish(0);
    expect(controller.state.status).toBe('playing');
    expect(replayers[0]?.playedFrom).toEqual([20_000]);
  });

  it('pauses at the offset when asked to stay paused', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0 + 20_000, false);
    await finish(0);
    expect(controller.state.status).toBe('paused');
    expect(replayers[0]?.pausedAt).toEqual([20_000]);
  });

  it('follows the playhead of the player', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0, true);
    await finish(0);
    replayers[0]!.time = 7_500;
    jest.advanceTimersByTime(150);
    expect(controller.state.offsetMs).toBe(7_500);
    expect(controller.state.recordedMs).toBe(7_500);
  });

  it('goes to the next chunk when one finishes, skipping the gap', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0, true);
    await finish(0);
    replayers[0]!.handlers['finish']?.();
    expect(controller.state.chunkIndex).toBe(1);
    expect(controller.state.status).toBe('loading');
    await finish(1);
    expect(replayers[0]?.destroyed).toBe(true);
    expect(replayers[1]?.playedFrom).toEqual([0]);
  });

  it('ends after the last chunk', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0 + 200_000, true);
    await finish(2);
    replayers[0]!.handlers['finish']?.();
    expect(controller.state.status).toBe('ended');
  });

  it('lands at the start of the next chunk when asked for a time inside a gap', async () => {
    const { controller, finish } = setup();
    controller.seekWall(T0 + 60_000, true);
    expect(controller.state.chunkIndex).toBe(1);
    expect(controller.state.offsetMs).toBe(0);
    await finish(1);
    expect(controller.state.status).toBe('playing');
  });

  it('skips a chunk without a snapshot and says so', async () => {
    const { controller, finish, replayers } = setup([false, true, true]);
    controller.seekWall(T0, true);
    await finish(0);
    expect(controller.state.chunkIndex).toBe(1);
    expect(controller.state.notice).toMatch(/no snapshot/);
    await finish(1);
    expect(replayers).toHaveLength(1);
    expect(controller.state.status).toBe('playing');
  });

  it('reports when nothing can be played', async () => {
    const { controller, finish } = setup([false, false, false]);
    controller.seekWall(T0, true);
    await finish(0);
    await finish(1);
    await finish(2);
    expect(controller.state.status).toBe('unplayable');
  });

  it('seeks by recorded time across chunks and ignores a stale finish event', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0, true);
    await finish(0);
    const first = replayers[0]!;
    controller.seekRecorded(40_000 + 10_000);
    expect(controller.state.chunkIndex).toBe(1);
    first.handlers['finish']?.();
    expect(controller.state.chunkIndex).toBe(1);
    await finish(1);
    expect(replayers[1]?.playedFrom).toEqual([10_000]);
  });

  it('changes speed and skip-inactivity on the running player', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0, true);
    await finish(0);
    controller.setSpeed(2);
    controller.setSkipInactive(false);
    expect(replayers[0]?.config).toEqual({ speed: 2, skipInactive: false });
    controller.pause();
    expect(controller.state.status).toBe('paused');
    controller.play();
    expect(controller.state.status).toBe('playing');
  });

  it('destroys the player and cancels loading on destroy', async () => {
    const { controller, finish, replayers } = setup();
    controller.seekWall(T0, true);
    await finish(0);
    controller.destroy();
    expect(replayers[0]?.destroyed).toBe(true);
  });
});
