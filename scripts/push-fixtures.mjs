#!/usr/bin/env node
// Pushes the fixture sessions to a Loki, in one of the two formats.
// Usage: node scripts/push-fixtures.mjs <lokiUrl> <json|logfmt>
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [lokiUrl, format] = process.argv.slice(2);
if (!lokiUrl || (format !== 'json' && format !== 'logfmt')) {
  console.error('Usage: node scripts/push-fixtures.mjs <lokiUrl> <json|logfmt>');
  process.exit(1);
}

// Real local recordings win; otherwise generate the synthetic sessions (see make-synthetic.mjs).
const testsDir = join(import.meta.dirname, '..', 'tests');
if (!existsSync(join(testsDir, 'fixtures'))) {
  execFileSync(process.execPath, [join(import.meta.dirname, 'make-synthetic.mjs')], { stdio: 'inherit' });
}
const dir = join(testsDir, existsSync(join(testsDir, 'fixtures')) ? 'fixtures' : 'synthetic', format);
const streams = new Map();
for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
  for (const row of readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean)) {
    const { ts, labels, line } = JSON.parse(row);
    const key = JSON.stringify(labels);
    if (!streams.has(key)) {
      streams.set(key, { stream: labels, values: [] });
    }
    streams.get(key).values.push([ts, line]);
  }
}
for (const stream of streams.values()) {
  stream.values.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
const response = await fetch(`${lokiUrl}/loki/api/v1/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streams: [...streams.values()] }),
});
console.log(
  format,
  'push',
  response.status,
  [...streams.values()].reduce((sum, s) => sum + s.values.length, 0),
  'lines'
);
if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}
