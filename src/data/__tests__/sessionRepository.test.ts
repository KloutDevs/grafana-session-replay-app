import { fakeLoki, loadFixture, type FixtureLine } from '../../testing/fakeLoki';
import { DEFAULT_SETTINGS, type LogFormat, type PluginSettings } from '../../domain/types';
import { LokiClient } from '../lokiClient';
import { SessionRepository } from '../sessionRepository';

const SESSIONS = ['W3zzC4gSP8', 'UH8CtirMwV', 'vv1Vh3L5jV', '2cd7jMwyMM'];

function lastMs(lines: FixtureLine[]): number {
  return Math.max(...lines.map((row) => Number(row.ts.slice(0, -6))));
}

function setup(format: LogFormat, lines: FixtureLine[], maxEntries?: number) {
  const settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    format,
    selector: format === 'json' ? '{service_name="frontend"}' : '{source=~"faro|faro_replay"}',
  };
  const fetcher = fakeLoki(lines, { format, ...(maxEntries ? { maxEntries } : {}) });
  return {
    repo: new SessionRepository(
      new LokiClient('loki', fetcher),
      settings,
      maxEntries ? { entryLimit: maxEntries } : {}
    ),
    fetcher,
  };
}

const FORMATS: LogFormat[] = ['json', 'logfmt'];
describe.each(FORMATS)('SessionRepository with %s lines', (format) => {
  const all = SESSIONS.flatMap((name) => loadFixture(format, name));
  const toMs = lastMs(all) + 60_000;
  const fromMs = toMs - 6 * 3_600_000;

  it('lists each recorded session once, newest first', async () => {
    const { repo } = setup(format, all);
    const { sessions, incomplete } = await repo.listSessions(fromMs, toMs);
    expect(incomplete).toBe(false);
    expect(sessions.map((s) => s.sessionId).sort()).toEqual([...SESSIONS].sort());
    expect(sessions[0]?.startedAtMs).toBeGreaterThanOrEqual(sessions[sessions.length - 1]?.startedAtMs ?? 0);
    const first = sessions.find((s) => s.sessionId === 'W3zzC4gSP8');
    expect(first?.appName).toBe('quickaction-dashboard-frontend');
    expect(first?.browser).toMatch(/^Chrome/);
    expect(first?.userId).toBe('');
  });

  it('counts exceptions per session in the query', async () => {
    const { repo } = setup(format, all);
    const counts = await repo.errorCounts(fromMs, toMs);
    expect(counts.get('W3zzC4gSP8')).toBe(1);
    expect(counts.get('vv1Vh3L5jV')).toBe(2);
  });

  it('builds the timeline from the index lines only', async () => {
    const { repo, fetcher } = setup(format, all);
    const { timeline } = await repo.loadTimeline('W3zzC4gSP8', fromMs, toMs);
    expect(timeline.chunks).toHaveLength(1);
    expect(timeline.chunks[0]?.href).toContain('/terms');
    expect(timeline.recordedMs).toBeGreaterThan(30_000);
    const queries = fetcher.calls.map((call) => String(call['expr']));
    expect(queries.every((expr) => /\|[=~]|!=/.test(expr))).toBe(true);
    expect(queries.some((expr) => expr.includes('kind'))).toBe(false);
  });

  it('shows the pause of a recording as the end of its chunk', async () => {
    const { repo } = setup(format, all);
    const { timeline } = await repo.loadTimeline('2cd7jMwyMM', fromMs, toMs);
    expect(timeline.chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of timeline.chunks) {
      expect(chunk.endMs).toBeGreaterThanOrEqual(chunk.startMs);
    }
  });

  it('loads a chunk that starts with Meta and a full snapshot, in order, without duplicates', async () => {
    const { repo } = setup(format, all);
    const { timeline } = await repo.loadTimeline('W3zzC4gSP8', fromMs, toMs);
    const chunk = timeline.chunks[0];
    expect(chunk).toBeDefined();
    const data = await repo.loadChunk('W3zzC4gSP8', chunk!);
    expect(data.playable).toBe(true);
    expect(data.events[0]?.type).toBe(4);
    expect(data.events[1]?.type).toBe(2);
    const stamps = data.events.map((event) => event.timestamp);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    expect(data.malformed).toBe(0);
  });

  it('ignores a retried batch that produced duplicate lines', async () => {
    const duplicated = [
      ...all,
      ...loadFixture(format, 'W3zzC4gSP8')
        .filter((row) => row.line.includes('session_recording.event'))
        .map((row) => ({ ...row, ts: `${row.ts.slice(0, -1)}${row.ts.endsWith('9') ? '8' : '9'}` })),
    ];
    const { repo } = setup(format, duplicated);
    const { timeline } = await repo.loadTimeline('W3zzC4gSP8', fromMs, toMs);
    const clean = await setup(format, all).repo.loadChunk('W3zzC4gSP8', timeline.chunks[0]!);
    const data = await repo.loadChunk('W3zzC4gSP8', timeline.chunks[0]!);
    expect(data.events).toHaveLength(clean.events.length);
  });

  it('marks a chunk without a full snapshot as not playable', async () => {
    const withoutSnapshot = all.filter(
      (row) => !(row.line.includes('session_recording.event') && row.line.includes('\\"type\\":2,'))
    );
    const { repo } = setup(format, withoutSnapshot);
    const { timeline } = await repo.loadTimeline('W3zzC4gSP8', fromMs, toMs);
    const data = await repo.loadChunk('W3zzC4gSP8', timeline.chunks[0]!);
    expect(data.playable).toBe(false);
  });

  it('skips and counts lines it cannot read', async () => {
    const broken = [
      ...all,
      {
        ts: `${Number(all[0]!.ts.slice(0, -6)) + 1}000000`,
        labels: all[0]!.labels,
        line:
          format === 'json'
            ? '{"event_name":"faro.session_recording.event","session_id":"W3zzC4gSP8","event_data_recording_id":"x","event_data_gen":"0","event_data_seq":"1","event_data_event":"{not json"}'
            : 'event_name=faro.session_recording.event session_id=W3zzC4gSP8 event_data_recording_id=x event_data_gen=0 event_data_seq=1 event_data_event="{not json"',
      },
    ];
    const { repo } = setup(format, broken);
    const { timeline } = await repo.loadTimeline('W3zzC4gSP8', fromMs, toMs);
    const chunk = { ...timeline.chunks[0]!, lokiToMs: timeline.chunks[0]!.lokiToMs + 120_000 };
    const data = await repo.loadChunk('W3zzC4gSP8', chunk);
    expect(data.malformed).toBe(1);
    expect(data.playable).toBe(true);
  });

  it('builds the journey without replay lines and flags the exception as an error', async () => {
    const { repo } = setup(format, all);
    const { items } = await repo.loadJourney('W3zzC4gSP8', fromMs, toMs);
    expect(items.length).toBeGreaterThan(3);
    expect(items.some((item) => item.title.includes('session_recording'))).toBe(false);
    expect(items.some((item) => item.title.includes('performance.resource'))).toBe(false);
    expect(items.some((item) => item.kind === 'navigation')).toBe(true);
    const sorted = items.map((item) => item.atMs);
    expect([...sorted].sort((a, b) => a - b)).toEqual(sorted);
  });

  it('pages through a saturated query and still returns every line', async () => {
    const { repo, fetcher } = setup(format, all, 6);
    const { timeline, incomplete } = await repo.loadTimeline('2cd7jMwyMM', fromMs, toMs);
    expect(incomplete).toBe(false);
    expect(timeline.chunks.length).toBeGreaterThanOrEqual(1);
    const data = await repo.loadChunk('2cd7jMwyMM', timeline.chunks[0]!);
    expect(data.playable).toBe(true);
    expect(fetcher.calls.length).toBeGreaterThan(5);
  });

  it('reports incomplete when more lines share a millisecond than one query can return', async () => {
    const { repo } = setup(format, all, 1);
    const { sessions, incomplete } = await repo.listSessions(fromMs, toMs);
    expect(incomplete).toBe(true);
    expect(sessions.length).toBeLessThanOrEqual(SESSIONS.length);
  });

  it('uses Loki time for queries when the browser clock is an hour off', async () => {
    const skewed = all.map((row) => ({ ...row, ts: `${Number(row.ts.slice(0, -6)) + 3_600_000}${row.ts.slice(-6)}` }));
    const { repo } = setup(format, skewed);
    const { sessions } = await repo.listSessions(fromMs + 3_600_000, toMs + 3_600_000);
    const session = sessions.find((s) => s.sessionId === 'W3zzC4gSP8');
    expect(session).toBeDefined();
    // The start shown is the browser's; the start used for queries is Loki's, an hour later.
    expect(session!.lokiStartMs - session!.startedAtMs).toBeGreaterThan(3_500_000);
    const { timeline } = await repo.loadTimeline('W3zzC4gSP8', session!.lokiStartMs - 60_000, toMs + 3_600_000);
    expect(timeline.chunks).toHaveLength(1);
    expect((await repo.loadChunk('W3zzC4gSP8', timeline.chunks[0]!)).playable).toBe(true);
    expect(await repo.findSessionStart('W3zzC4gSP8', 7 * 86_400_000, toMs + 3_600_000)).toBe(session!.lokiStartMs);
  });

  it('finds the start of a session and refuses an unsafe id', async () => {
    const { repo } = setup(format, all);
    const found = await repo.findSessionStart('W3zzC4gSP8', 7 * 86_400_000, toMs);
    expect(found).toBeGreaterThan(0);
    expect(await repo.findSessionStart('x"} or {a="b', 86_400_000, toMs)).toBeUndefined();
    expect(await repo.findSessionStart('missing-session', 86_400_000, toMs)).toBeUndefined();
  });
});
