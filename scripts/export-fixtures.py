#!/usr/bin/env python3
"""Turn raw Loki query_range responses (logfmt shape of the escalia stack) into
fixture files, and derive the JSON shape used in production.

The JSON files are NOT captured from production: they keep the same keys and
values as the logfmt line, written as one flat JSON object per line, which is
what production's JSON lines look like (checked against a real production
sample that has the same flat keys, e.g. `app_name`, `event_data_duration`).

Usage: export-fixtures.py <raw.json> <name>   (run from the repository root)
"""
import json, re, sys

PAIR = re.compile(r'([A-Za-z_][\w.]*)=("(?:\\.|[^"\\])*"|\S*)')

def parse_logfmt(line):
    out = {}
    for key, raw in PAIR.findall(line):
        out[key] = json.loads(raw) if raw.startswith('"') else raw
    return out

raw_path, name = sys.argv[1], sys.argv[2]
streams = json.load(open(raw_path))['data']['result']
entries = []
for s in streams:
    for ts, line in s['values']:
        entries.append((int(ts), s['stream'], line))
entries.sort(key=lambda e: e[0])

with open(f'tests/fixtures/logfmt/{name}.jsonl', 'w') as lf, open(f'tests/fixtures/json/{name}.jsonl', 'w') as jf:
    for ts, labels, line in entries:
        lf.write(json.dumps({'ts': str(ts), 'labels': labels, 'line': line}, ensure_ascii=False) + '\n')
        fields = parse_logfmt(line)
        jlabels = {'service_name': 'frontend', 'source': 'browser'}
        jf.write(json.dumps({'ts': str(ts), 'labels': jlabels, 'line': json.dumps(fields, ensure_ascii=False, separators=(',', ':'))}, ensure_ascii=False) + '\n')
print(name, len(entries), 'lines')
