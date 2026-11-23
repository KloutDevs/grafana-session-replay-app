import type { LokiClient, LokiLine } from './lokiClient';

export interface WindowedResult {
  lines: LokiLine[];
  /** True when more than `limit` lines share one millisecond, so some may be missing. */
  incomplete: boolean;
}

export interface WindowedOptions {
  expr: string;
  fromMs: number;
  toMs: number;
  /** Entries per query; must not exceed Loki's `max_entries_limit_per_query`. */
  limit: number;
  signal?: AbortSignal;
}

/**
 * Reads every line in a time range, oldest first. Loki returns at most `limit`
 * lines per query, so when a query comes back full the next one starts at the
 * time of its last line. Lines are unique by Loki time and text.
 */
export async function queryAll(client: LokiClient, options: WindowedOptions): Promise<WindowedResult> {
  const seen = new Set<string>();
  const lines: LokiLine[] = [];
  let incomplete = false;
  let from = options.fromMs;

  for (;;) {
    const batch = await client.queryLines({
      expr: options.expr,
      fromMs: from,
      toMs: options.toMs,
      limit: options.limit,
      direction: 'forward',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    let lastMs = from;
    for (const line of batch) {
      lastMs = Math.max(lastMs, line.tsMs);
      const id = `${line.tsNs}|${line.line}`;
      if (!seen.has(id)) {
        seen.add(id);
        lines.push(line);
      }
    }
    if (batch.length < options.limit || lastMs >= options.toMs) {
      break;
    }
    if (lastMs <= from) {
      // A full query that did not move: more than `limit` lines in one millisecond.
      incomplete = true;
      from += 1;
    } else {
      from = lastMs;
    }
  }

  lines.sort((a, b) => (a.tsNs < b.tsNs ? -1 : a.tsNs > b.tsNs ? 1 : 0));
  return { lines, incomplete };
}
