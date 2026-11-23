import {
  buildTimeline,
  linkOffsetAt,
  positionAtRecorded,
  positionAtWall,
  wallAt,
  wallFromLink,
  type MarkerPoint,
  type MetaPoint,
} from '../timeline';

const T0 = 1_000_000;
const meta = (gen: number, offsetS: number, rec = 'r1'): MetaPoint => ({
  recordingId: rec,
  gen,
  timestamp: T0 + offsetS * 1000,
  lokiMs: T0 + offsetS * 1000 + 40,
  href: `https://app/${gen}`,
});
const marker = (kind: MarkerPoint['kind'], offsetS: number, rec = 'r1'): MarkerPoint => ({
  kind,
  recordingId: rec,
  timestamp: T0 + offsetS * 1000,
  lokiMs: T0 + offsetS * 1000 + 40,
});

// Real shape of a long session: chunk 0 for 156 s, a pause, chunk 1, a long pause, chunk 2.
const metas = [meta(0, 0), meta(1, 219), meta(2, 1014)];
const markers = [
  marker('started', 0),
  marker('paused', 170),
  marker('resumed', 219),
  marker('paused', 323),
  marker('started', 1014),
  marker('paused', 1075),
];
const timeline = buildTimeline('sess', metas, markers, { timestamp: T0 + 1070_000, lokiMs: T0 + 1070_040 }, 30_000);

describe('buildTimeline', () => {
  it('makes one chunk per Meta, ended by the pause marker', () => {
    expect(timeline.chunks.map((c) => [c.gen, (c.endMs - c.startMs) / 1000])).toEqual([
      [0, 170],
      [1, 104],
      [2, 61],
    ]);
  });

  it('finds the gaps and the recorded time', () => {
    expect(timeline.gaps).toHaveLength(2);
    expect(timeline.recordedMs).toBe((170 + 104 + 61) * 1000);
    expect(timeline.startMs).toBe(T0);
    expect(timeline.endMs).toBe(T0 + 1075_000);
  });

  it('pads the Loki window around each chunk', () => {
    const first = timeline.chunks[0]!;
    expect(first.lokiFromMs).toBe(T0 + 40 - 30_000);
    expect(first.lokiToMs).toBe(T0 + 170_040 + 30_000);
  });

  it('ignores a repeated Meta of the same chunk and keeps the earliest', () => {
    const t = buildTimeline('s', [meta(0, 5), meta(0, 1)], [], { timestamp: T0 + 10_000, lokiMs: T0 + 10_040 }, 0);
    expect(t.chunks).toHaveLength(1);
    expect(t.chunks[0]?.startMs).toBe(T0 + 1000);
  });

  it('closes the last chunk at the newest event when there is no pause', () => {
    const t = buildTimeline('s', [meta(0, 0)], [], { timestamp: T0 + 90_000, lokiMs: T0 + 90_040 }, 0);
    expect(t.chunks[0]?.endMs).toBe(T0 + 90_000);
    expect(t.gaps).toEqual([]);
  });

  it('is empty without recordings', () => {
    const t = buildTimeline('s', [], [], undefined, 0);
    expect(t.chunks).toEqual([]);
    expect(positionAtWall(t, T0)).toBeUndefined();
    expect(positionAtRecorded(t, 0)).toBeUndefined();
  });
});

describe('positions', () => {
  it('finds the chunk for a browser-clock time and its recorded time', () => {
    const p = positionAtWall(timeline, T0 + 230_000)!;
    expect(p.chunkIndex).toBe(1);
    expect(p.offsetMs).toBe(11_000);
    expect(p.recordedMs).toBe(170_000 + 11_000);
  });

  it('snaps a time inside a gap to the start of the next chunk', () => {
    const p = positionAtWall(timeline, T0 + 500_000)!;
    expect(p.chunkIndex).toBe(2);
    expect(p.offsetMs).toBe(0);
    expect(p.recordedMs).toBe((170 + 104) * 1000);
  });

  it('clamps before the start and after the end', () => {
    expect(positionAtWall(timeline, T0 - 5000)).toMatchObject({ chunkIndex: 0, offsetMs: 0 });
    expect(positionAtWall(timeline, T0 + 99_999_999)).toMatchObject({ chunkIndex: 2, offsetMs: 61_000 });
  });

  it('maps recorded time across chunks', () => {
    expect(positionAtRecorded(timeline, 175_000)).toMatchObject({ chunkIndex: 1, offsetMs: 5000 });
    expect(positionAtRecorded(timeline, 0)).toMatchObject({ chunkIndex: 0, offsetMs: 0 });
    expect(positionAtRecorded(timeline, 9_999_999)).toMatchObject({ chunkIndex: 2, offsetMs: 61_000 });
  });
});

describe('deep link offsets', () => {
  it('counts t on the browser clock from the session start, gaps included', () => {
    expect(wallFromLink(timeline, 20_000)).toBe(T0 + 20_000);
    expect(wallFromLink(timeline, -5)).toBe(T0);
    const wall = wallAt(timeline, 1, 11_000);
    expect(linkOffsetAt(timeline, wall)).toBe(230_000);
    expect(positionAtWall(timeline, wallFromLink(timeline, 230_000))).toMatchObject({
      chunkIndex: 1,
      offsetMs: 11_000,
    });
  });
});
