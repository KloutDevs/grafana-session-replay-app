#!/usr/bin/env node
// Builds a long synthetic session from a real one, in the JSON shape, to measure loading.
// The base is tests/fixtures/json/<base>.jsonl (a real recording: Meta, full snapshot, increments).
// Usage: node scripts/make-large-session.mjs <lokiUrl> [chunks=18] [incrementalsPerChunk=80]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [lokiUrl, chunksArg = '18', perChunkArg = '80'] = process.argv.slice(2);
if (!lokiUrl) {
  console.error('Usage: node scripts/make-large-session.mjs <lokiUrl> [chunks] [incrementalsPerChunk]');
  process.exit(1);
}
const chunks = Number(chunksArg);
const perChunk = Number(perChunkArg);
const rows = readFileSync(join(import.meta.dirname, '..', 'tests', 'fixtures', 'json', 'W3zzC4gSP8.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((row) => JSON.parse(row));
const replay = rows
  .map((row) => ({ row, fields: JSON.parse(row.line) }))
  .filter(({ fields }) => fields.event_name === 'faro.session_recording.event');
const meta = replay.find(({ fields }) => JSON.parse(fields.event_data_event).type === 4);
const snapshot = replay.find(({ fields }) => JSON.parse(fields.event_data_event).type === 2);
const incrementals = replay.filter(({ fields }) => JSON.parse(fields.event_data_event).type === 3);

const SESSION = 'LARGEsess01';
const RECORDING = 'LARGErec001';
const startMs = Date.now() - 100 * 60_000;
const lines = [];
let seq = 0;
const push = (fields, atMs, rrweb) => {
  const copy = {
    ...fields,
    session_id: SESSION,
    event_data_recording_id: RECORDING,
    timestamp: new Date(atMs).toISOString().replace('T', ' ').replace('Z', ' +0000 UTC'),
  };
  if (rrweb) {
    copy.event_data_event = JSON.stringify({ ...rrweb, timestamp: atMs });
    copy.event_data_seq = String(seq);
    seq += 1;
  }
  lines.push({ ts: `${atMs}000000`, line: JSON.stringify(copy) });
};

for (let gen = 0; gen < chunks; gen += 1) {
  const at = startMs + gen * 5 * 60_000;
  const gens = { event_data_gen: String(gen) };
  push({ ...meta.fields, ...gens, event_name: 'faro.session_recording.event' }, at, {
    ...JSON.parse(meta.fields.event_data_event),
  });
  push({ ...snapshot.fields, ...gens }, at + 20, { ...JSON.parse(snapshot.fields.event_data_event) });
  for (let i = 0; i < perChunk; i += 1) {
    const base = incrementals[i % incrementals.length];
    push({ ...base.fields, ...gens }, at + 1000 + i * 1500, JSON.parse(base.fields.event_data_event));
  }
  const marker = { ...meta.fields, kind: 'event' };
  delete marker.event_data_event;
  delete marker.event_data_seq;
  push(
    {
      ...marker,
      event_name: gen === 0 ? 'faro.session_recording.started' : 'faro.session_recording.resumed',
      event_data_gen: undefined,
    },
    at,
    undefined
  );
  push(
    { ...marker, event_name: 'faro.session_recording.paused', event_data_gen: undefined },
    at + 1000 + perChunk * 1500,
    undefined
  );
  // a gap of about 3 minutes before the next chunk
}

const values = lines.sort((a, b) => (a.ts < b.ts ? -1 : 1)).map((l) => [l.ts, l.line]);
const response = await fetch(`${lokiUrl}/loki/api/v1/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streams: [{ stream: { service_name: 'frontend', source: 'browser' }, values }] }),
});
const bytes = values.reduce((sum, v) => sum + v[1].length, 0);
console.log('push', response.status, values.length, 'lines', Math.round(bytes / 1024), 'KB', 'session', SESSION);
if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}
