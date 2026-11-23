import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DsQueryFetcher } from '../data/lokiClient';
import { getAdapter } from '../data/logFormat';

export interface FixtureLine {
  ts: string;
  labels: Record<string, string>;
  line: string;
}

/**
 * Real recordings in `tests/fixtures` (local only, not published) win; otherwise the synthetic
 * sessions of `scripts/make-synthetic.mjs` in `tests/synthetic` are used (jest global setup
 * generates them).
 */
function fixtureRoot(): string {
  const real = join(__dirname, '..', '..', 'tests', 'fixtures');
  return existsSync(real) ? real : join(__dirname, '..', '..', 'tests', 'synthetic');
}

export function loadFixture(format: 'json' | 'logfmt', name: string): FixtureLine[] {
  const path = join(fixtureRoot(), format, `${name}.jsonl`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((row) => JSON.parse(row) as FixtureLine);
}

type Filter = { op: '|=' | '!=' | '|~'; value: string };

/** Reads the line filters of a LogQL expression: raw strings in backticks or quoted strings. */
export function parseFilters(expr: string): Filter[] {
  const filters: Filter[] = [];
  const pattern = /(\|=|!=|\|~)\s*(?:`([^`]*)`|"((?:[^"\\]|\\.)*)")/g;
  for (const match of expr.matchAll(pattern)) {
    const raw = match[2] ?? (match[3] ?? '').replace(/\\(.)/g, '$1');
    filters.push({ op: match[1] as Filter['op'], value: raw });
  }
  return filters;
}

function passes(line: string, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.op === '|=') {
      return line.includes(filter.value);
    }
    if (filter.op === '!=') {
      return !line.includes(filter.value);
    }
    return new RegExp(filter.value).test(line);
  });
}

export interface FakeLokiOptions {
  /** Cap on entries per query, like Loki's `max_entries_limit_per_query`. */
  maxEntries?: number;
  format: 'json' | 'logfmt';
}

/** A tiny Loki: applies the selector-free line filters, the time window, the limit and the direction. */
export function fakeLoki(
  lines: FixtureLine[],
  options: FakeLokiOptions
): DsQueryFetcher & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const adapter = getAdapter(options.format);
  const fetcher: DsQueryFetcher = async (body, signal) => {
    if (signal?.aborted) {
      throw new Error('aborted');
    }
    const request = body as {
      queries: Array<{ expr: string; queryType: string; maxLines?: number; direction?: string }>;
      from: string;
      to: string;
    };
    const query = request.queries[0];
    calls.push({
      expr: query?.expr,
      from: request.from,
      to: request.to,
      queryType: query?.queryType,
      maxLines: query?.maxLines,
    });
    const from = Number(request.from);
    const to = Number(request.to);
    const filters = parseFilters(query?.expr ?? '');

    if (query?.queryType === 'instant') {
      const counts = new Map<string, number>();
      for (const row of lines) {
        const ms = Number(row.ts.slice(0, -6));
        if (ms < from - 3_600_000 || ms > to || !passes(row.line, filters)) {
          continue;
        }
        const id = adapter.parseLine(row.line)?.['session_id'];
        if (id) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      return {
        results: {
          A: {
            frames: [...counts.entries()].map(([id, value]) => ({
              schema: { fields: [{ name: 'Time' }, { name: 'Value', labels: { session_id: id } }] },
              data: { values: [[to], [value]] },
            })),
          },
        },
      };
    }

    const limit = query?.maxLines ?? 1000;
    if (limit > (options.maxEntries ?? 5000)) {
      // Loki rejects a limit above max_entries_limit_per_query instead of capping it.
      throw new Error(
        `max entries limit per query exceeded, limit > max_entries_limit (${limit} > ${options.maxEntries ?? 5000})`
      );
    }
    let selected = lines.filter((row) => {
      const ms = Number(row.ts.slice(0, -6));
      return ms >= from && ms < to && passes(row.line, filters);
    });
    selected.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    if (query?.direction === 'backward') {
      selected = selected.reverse();
    }
    selected = selected.slice(0, limit);
    return {
      results: {
        A: {
          frames: [
            {
              schema: { fields: [{ name: 'labels' }, { name: 'Time' }, { name: 'Line' }, { name: 'tsNs' }] },
              data: {
                values: [
                  selected.map((row) => row.labels),
                  selected.map((row) => Number(row.ts.slice(0, -6))),
                  selected.map((row) => row.line),
                  selected.map((row) => row.ts),
                ],
              },
            },
          ],
        },
      },
    };
  };
  return Object.assign(fetcher, { calls });
}
