import { positionAtRecorded, positionAtWall, recordedAt } from '../domain/timeline';
import type { ReplayEvent, Timeline } from '../domain/types';
import { priorityFor, type ChunkLoader } from './chunkLoader';

export interface ReplayerLike {
  play(timeOffsetMs?: number): void;
  pause(timeOffsetMs?: number): void;
  getCurrentTime(): number;
  setConfig(config: { speed?: number; skipInactive?: boolean }): void;
  on(event: string, handler: () => void): void;
  destroy(): void;
}

export interface ReplayerOptions {
  speed: number;
  skipInactive: boolean;
}

export type ReplayerFactory = (events: ReplayEvent[], options: ReplayerOptions) => ReplayerLike;

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'unplayable';

export interface PlaybackState {
  status: PlaybackStatus;
  chunkIndex: number;
  /** Milliseconds from the start of the current chunk. */
  offsetMs: number;
  /** Recorded time since the start of the session. */
  recordedMs: number;
  speed: number;
  skipInactive: boolean;
  /** Short explanation shown on the player, for example a skipped chunk. */
  notice: string;
}

const TICK_MS = 100;

/**
 * Plays a session chunk by chunk. Every chunk starts with its own snapshot, so
 * the player is rebuilt at each chunk and can start anywhere. It waits while a
 * chunk is loading and skips chunks that have no snapshot.
 */
export class PlaybackController {
  private replayer: ReplayerLike | undefined;
  private mountToken = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private wantPlaying = false;
  private target: { chunkIndex: number; offsetMs: number } | undefined;
  private readonly unsubscribe: () => void;
  private destroyed = false;
  state: PlaybackState;

  constructor(
    private readonly timeline: Timeline,
    private readonly loader: ChunkLoader,
    private readonly factory: ReplayerFactory,
    private readonly onChange: (state: PlaybackState) => void,
    initial: { speed?: number; skipInactive?: boolean } = {}
  ) {
    this.state = {
      status: 'idle',
      chunkIndex: 0,
      offsetMs: 0,
      recordedMs: 0,
      speed: initial.speed ?? 1,
      skipInactive: initial.skipInactive ?? true,
      notice: '',
    };
    this.unsubscribe = loader.subscribe(() => this.onLoaderChange());
  }

  private update(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private stopTicking(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private unmount(): void {
    this.mountToken += 1;
    this.stopTicking();
    this.replayer?.destroy();
    this.replayer = undefined;
  }

  /** Goes to a position and, when `play` is true, keeps playing from there. */
  private goto(chunkIndex: number, offsetMs: number, play: boolean): void {
    if (this.destroyed) {
      return;
    }
    this.wantPlaying = play;
    this.target = { chunkIndex, offsetMs };
    this.unmount();
    this.loader.want(priorityFor(this.timeline.chunks, chunkIndex));
    this.update({
      status: 'loading',
      chunkIndex,
      offsetMs,
      recordedMs: recordedAt(this.timeline, chunkIndex, offsetMs),
    });
    this.tryMount();
  }

  private onLoaderChange(): void {
    if (this.state.status === 'loading') {
      this.tryMount();
    }
  }

  private tryMount(): void {
    const target = this.target;
    const chunk = target ? this.timeline.chunks[target.chunkIndex] : undefined;
    if (!target || !chunk) {
      return;
    }
    const loaded = this.loader.state(chunk.key);
    if (loaded.status === 'failed') {
      this.update({ status: 'paused', notice: `Could not load this part of the recording: ${loaded.message}` });
      return;
    }
    if (loaded.status !== 'loaded') {
      return;
    }
    if (!loaded.data.playable) {
      this.skipUnplayable(target.chunkIndex);
      return;
    }

    const token = this.mountToken;
    const replayer = this.factory(loaded.data.events, {
      speed: this.state.speed,
      skipInactive: this.state.skipInactive,
    });
    this.replayer = replayer;
    replayer.on('finish', () => {
      if (token === this.mountToken) {
        this.onChunkFinished();
      }
    });
    if (this.wantPlaying) {
      replayer.play(target.offsetMs);
    } else {
      replayer.pause(target.offsetMs);
    }
    this.update({ status: this.wantPlaying ? 'playing' : 'paused', notice: '' });
    this.startTicking(token, target.chunkIndex);
  }

  private startTicking(token: number, chunkIndex: number): void {
    this.stopTicking();
    this.timer = setInterval(() => {
      if (token !== this.mountToken || !this.replayer) {
        return;
      }
      const offsetMs = this.replayer.getCurrentTime();
      this.update({ offsetMs, recordedMs: recordedAt(this.timeline, chunkIndex, offsetMs) });
    }, TICK_MS);
  }

  private skipUnplayable(fromIndex: number): void {
    for (let i = fromIndex + 1; i < this.timeline.chunks.length; i += 1) {
      const next = this.timeline.chunks[i];
      if (next && this.loader.state(next.key).status !== 'failed') {
        this.update({
          notice:
            'Part of the recording has no snapshot and was skipped. If Loki rejected long lines, raise max_line_size.',
        });
        this.goto(i, 0, this.wantPlaying);
        return;
      }
    }
    this.update({
      status: 'unplayable',
      notice:
        'This part of the recording has no snapshot and cannot be played. If Loki rejected long lines, raise max_line_size.',
    });
  }

  private onChunkFinished(): void {
    const next = this.state.chunkIndex + 1;
    if (next < this.timeline.chunks.length) {
      this.goto(next, 0, true);
    } else {
      this.stopTicking();
      this.update({ status: 'ended' });
    }
  }

  play(): void {
    if (this.state.status === 'ended') {
      this.goto(0, 0, true);
      return;
    }
    this.wantPlaying = true;
    if (this.replayer) {
      this.replayer.play(this.state.offsetMs);
      this.update({ status: 'playing' });
    } else if (this.state.status !== 'loading') {
      this.goto(this.state.chunkIndex, this.state.offsetMs, true);
    }
  }

  pause(): void {
    this.wantPlaying = false;
    if (this.replayer) {
      this.replayer.pause(this.state.offsetMs);
      this.update({ status: 'paused' });
    }
  }

  seekRecorded(recordedMs: number): void {
    const position = positionAtRecorded(this.timeline, recordedMs);
    if (position) {
      this.goto(position.chunkIndex, position.offsetMs, this.wantPlaying);
    }
  }

  seekWall(wallMs: number, play = this.wantPlaying): void {
    const position = positionAtWall(this.timeline, wallMs);
    if (position) {
      this.goto(position.chunkIndex, position.offsetMs, play);
    }
  }

  skip(deltaMs: number): void {
    this.seekRecorded(this.state.recordedMs + deltaMs);
  }

  setSpeed(speed: number): void {
    this.replayer?.setConfig({ speed });
    this.update({ speed });
  }

  setSkipInactive(skipInactive: boolean): void {
    this.replayer?.setConfig({ skipInactive });
    this.update({ skipInactive });
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.unmount();
    this.loader.abortAll();
  }
}
