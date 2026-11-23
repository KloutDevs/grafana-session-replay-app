#!/usr/bin/env node
// Generates synthetic Faro sessions (no real data) in both Loki shapes, into tests/synthetic/{json,logfmt}.
// Times are relative to now, so the sessions always fall in the default look-back window.
// The ids and the facts the tests rely on are fixed:
//   W3zzC4gSP8  39.4 s, one exception at 20.9 s ("RangeError: JUMP_TEST2 mid error"), page /terms
//   UH8CtirMwV  30 s, one exception
//   vv1Vh3L5jV  25 s, two exceptions
//   2cd7jMwyMM  two recording generations (paused and resumed), many lines
// Usage: node scripts/make-synthetic.mjs [outDir]
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? join(import.meta.dirname, '..', 'tests', 'synthetic');
const APP = 'quickaction-dashboard-frontend';
const ORIGIN = 'http://127.0.0.1:5173';

const BROWSER = {
  browser_name: 'Chrome Headless',
  browser_version: '145.0.7632.6',
  browser_os: 'Linux unknown',
  browser_mobile: 'false',
  browser_userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.7632.6 Safari/537.36',
  browser_language: 'en-US',
  browser_viewportWidth: '1280',
  browser_viewportHeight: '800',
};

const SESSIONS = [
  {
    id: 'W3zzC4gSP8',
    startedAgoMin: 40,
    durationMs: 39_400,
    exceptions: [{ at: 20_900, type: 'RangeError', value: 'JUMP_TEST2 mid error' }],
    generations: 1,
  },
  {
    id: 'UH8CtirMwV',
    startedAgoMin: 30,
    durationMs: 30_000,
    exceptions: [{ at: 12_000, type: 'TypeError', value: 'late failure' }],
    generations: 1,
  },
  {
    id: 'vv1Vh3L5jV',
    startedAgoMin: 20,
    durationMs: 25_000,
    exceptions: [
      { at: 5_000, type: 'TypeError', value: "Cannot read properties of undefined (reading 'metadata')" },
      { at: 15_000, type: 'Error', value: 'second failure' },
    ],
    generations: 1,
  },
  { id: '2cd7jMwyMM', startedAgoMin: 10, durationMs: 45_000, exceptions: [], generations: 2 },
];

const pad = (n, w = 2) => String(n).padStart(w, '0');
function utc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)} +0000 UTC`;
}

const logfmtValue = (value) => (/^[^\s"=\\]+$/.test(value) ? value : JSON.stringify(value));
const toLogfmt = (fields) =>
  Object.entries(fields)
    .map(([key, value]) => `${key}=${logfmtValue(String(value))}`)
    .join(' ');

function snapshotNode(title) {
  const text = (id, textContent) => ({ type: 3, textContent, id });
  const el = (id, tagName, childNodes, attributes = {}) => ({ type: 2, tagName, attributes, childNodes, id });
  return {
    type: 0,
    childNodes: [
      { type: 1, name: 'html', publicId: '', systemId: '', id: 2 },
      el(3, 'html', [
        el(4, 'head', []),
        el(5, 'body', [el(6, 'h1', [text(7, title)]), el(8, 'p', [text(9, 'Synthetic page used by the tests.')])], {
          style: 'font-family: sans-serif',
        }),
      ]),
    ],
    id: 1,
  };
}

function build(session, nowMs) {
  const startMs = nowMs - session.startedAgoMin * 60_000;
  const lines = [];
  let counter = 0;
  const base = {
    sdk_name: 'faro-web',
    sdk_version: '2.14.0',
    app_name: APP,
    app_version: 'local',
    app_environment: 'development',
    session_id: session.id,
    page_url: `${ORIGIN}/terms`,
    ...BROWSER,
  };
  const add = (atMs, fields, kind) => {
    counter += 1;
    lines.push({ atMs, order: counter, fields: { timestamp: utc(atMs), ...fields, ...base }, kind });
  };

  add(startMs - 200, { kind: 'event', event_name: 'session_start', event_domain: 'browser' }, 'faro');
  add(startMs - 100, { kind: 'log', message: 'Synthetic log line', level: 'info' }, 'faro');
  add(startMs - 50, { kind: 'measurement', type: 'web-vitals', ttfb: '167.4', context_rating: 'good' }, 'faro');
  add(
    startMs,
    {
      kind: 'event',
      event_name: 'route_change',
      event_domain: 'browser',
      event_data_toRoute: '/*',
      event_data_toUrl: `${ORIGIN}/terms`,
    },
    'faro'
  );
  add(
    startMs + 10,
    {
      kind: 'event',
      event_name: 'faro.performance.resource',
      event_domain: 'browser',
      event_data_name: `${ORIGIN}/app.js`,
      event_data_duration: '12',
    },
    'faro'
  );

  for (const exception of session.exceptions) {
    add(
      startMs + exception.at,
      {
        kind: 'exception',
        type: exception.type,
        value: exception.value,
        stacktrace: `${exception.type}: ${exception.value}\n  at eval (${ORIGIN}/terms:290:30)`,
        hash: String(1000 + exception.at),
      },
      'faro'
    );
  }

  const perGeneration = session.durationMs / session.generations;
  for (let gen = 0; gen < session.generations; gen += 1) {
    const recordingId = `rec${session.id.slice(0, 5)}${gen}`;
    const genStart = startMs + gen * (perGeneration + 2_000);
    const genEnd = gen === session.generations - 1 ? startMs + session.durationMs : genStart + perGeneration;
    const marker = (name, at) =>
      add(
        at,
        { kind: 'event', event_name: name, event_domain: 'browser', event_data_recording_id: recordingId },
        'marker'
      );
    marker('faro.session_recording.started', genStart);
    let seq = 0;
    const replay = (at, event) => {
      add(
        at,
        {
          kind: 'event',
          event_name: 'faro.session_recording.event',
          event_domain: 'browser',
          event_data_recording_id: recordingId,
          event_data_gen: String(gen),
          event_data_seq: String(seq),
          event_data_event: JSON.stringify(event),
        },
        'payload'
      );
      seq += 1;
    };
    replay(genStart, { type: 4, data: { href: `${ORIGIN}/terms`, width: 1280, height: 800 }, timestamp: genStart });
    replay(genStart + 10, {
      type: 2,
      data: { node: snapshotNode('Terms of use'), initialOffset: { left: 0, top: 0 } },
      timestamp: genStart + 10,
    });
    for (let at = genStart + 500; at <= genEnd; at += 500) {
      replay(at, {
        type: 3,
        data: { source: 1, positions: [{ x: 100 + (at % 400), y: 120, id: 6, timeOffset: 0 }] },
        timestamp: at,
      });
    }
    if (gen < session.generations - 1) {
      marker('faro.session_recording.paused', genEnd + 1);
      marker('faro.session_recording.resumed', genEnd + 1_999);
    }
  }
  return lines;
}

function labelsFor(format, kind) {
  if (format === 'json') {
    return { service_name: 'frontend', source: 'browser' };
  }
  const common = {
    app_environment: 'development',
    app_name: APP,
    detected_level: 'unknown',
    service_name: 'unknown_service',
  };
  if (kind === 'marker') {
    return { ...common, replay: 'marker', source: 'faro_replay' };
  }
  if (kind === 'payload') {
    return { ...common, replay: 'payload', source: 'faro_replay' };
  }
  return { ...common, source: 'faro' };
}

const nowMs = Date.now();
for (const format of ['json', 'logfmt']) {
  const dir = join(outDir, format);
  mkdirSync(dir, { recursive: true });
  for (const session of SESSIONS) {
    const rows = build(session, nowMs)
      .sort((a, b) => a.atMs - b.atMs || a.order - b.order)
      .map(({ atMs, order, fields, kind }) => ({
        // Loki time: the browser time plus a small delay; unique per line.
        ts: `${atMs + 120}${pad(order % 1_000, 3)}000`,
        labels: labelsFor(format, kind),
        line: format === 'json' ? JSON.stringify(fields) : toLogfmt(fields),
      }));
    // Write then rename, so a reader never sees a half-written file.
    const target = join(dir, `${session.id}.jsonl`);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    renameSync(temporary, target);
  }
}
console.log(`synthetic sessions written to ${outDir}`);
