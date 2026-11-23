import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom, fromEvent, takeUntil } from 'rxjs';

export interface LokiLine {
  tsNs: string;
  tsMs: number;
  line: string;
}

export interface LogQueryOptions {
  expr: string;
  fromMs: number;
  toMs: number;
  limit: number;
  direction?: 'forward' | 'backward';
  signal?: AbortSignal;
}

export interface VectorSample {
  labels: Record<string, string>;
  value: number;
}

interface DsFrame {
  schema?: { fields?: Array<{ name?: string; labels?: Record<string, string> }> };
  data?: { values?: unknown[][] };
}
interface DsResponse {
  results?: Record<string, { frames?: DsFrame[]; error?: string; status?: number }>;
}

/** Sends a body to Grafana's datasource API. Replaceable in tests. */
export type DsQueryFetcher = (body: unknown, signal?: AbortSignal) => Promise<DsResponse>;

export const grafanaFetcher: DsQueryFetcher = async (body, signal) => {
  const request = getBackendSrv().fetch<DsResponse>({
    url: '/api/ds/query',
    method: 'POST',
    data: body,
    showErrorAlert: false,
  });
  const source = signal ? request.pipe(takeUntil(fromEvent(signal, 'abort'))) : request;
  const response = await lastValueFrom(source);
  return response.data;
};

export class LokiError extends Error {}

function fieldIndex(frame: DsFrame, name: string): number {
  return frame.schema?.fields?.findIndex((field) => field.name === name) ?? -1;
}

/** Reads Loki through Grafana, so datasource permissions apply and nothing else is called. */
export class LokiClient {
  constructor(
    private readonly datasourceUid: string,
    private readonly fetcher: DsQueryFetcher = grafanaFetcher
  ) {}

  private body(expr: string, fromMs: number, toMs: number, extra: Record<string, unknown>) {
    return {
      queries: [
        {
          refId: 'A',
          datasource: { type: 'loki', uid: this.datasourceUid },
          expr,
          ...extra,
        },
      ],
      from: String(Math.floor(fromMs)),
      to: String(Math.ceil(toMs)),
    };
  }

  private frames(response: DsResponse): DsFrame[] {
    const result = response.results?.['A'];
    if (result?.error) {
      throw new LokiError(result.error);
    }
    return result?.frames ?? [];
  }

  async queryLines(options: LogQueryOptions): Promise<LokiLine[]> {
    const body = this.body(options.expr, options.fromMs, options.toMs, {
      queryType: 'range',
      maxLines: options.limit,
      direction: options.direction ?? 'forward',
    });
    const frames = this.frames(await this.fetcher(body, options.signal));
    const lines: LokiLine[] = [];
    for (const frame of frames) {
      const lineAt = fieldIndex(frame, 'Line');
      const nsAt = fieldIndex(frame, 'tsNs');
      const timeAt = fieldIndex(frame, 'Time');
      const values = frame.data?.values ?? [];
      const text = lineAt >= 0 ? values[lineAt] : undefined;
      if (!text) {
        continue;
      }
      for (let i = 0; i < text.length; i += 1) {
        const ns = nsAt >= 0 ? String(values[nsAt]?.[i] ?? '') : '';
        const ms = ns.length > 6 ? Number(ns.slice(0, -6)) : Number(values[timeAt]?.[i] ?? 0);
        lines.push({ tsNs: ns || `${ms}000000`, tsMs: ms, line: String(text[i]) });
      }
    }
    return lines;
  }

  /** Instant metric query, evaluated at `atMs`. */
  async queryVector(expr: string, atMs: number, signal?: AbortSignal): Promise<VectorSample[]> {
    const body = this.body(expr, atMs - 1000, atMs, { queryType: 'instant' });
    const frames = this.frames(await this.fetcher(body, signal));
    const samples: VectorSample[] = [];
    for (const frame of frames) {
      const fields = frame.schema?.fields ?? [];
      const valueAt = fields.findIndex((field) => field.name === 'Value');
      if (valueAt < 0) {
        continue;
      }
      const labels = fields[valueAt]?.labels ?? {};
      const values = frame.data?.values?.[valueAt] ?? [];
      const last = values[values.length - 1];
      samples.push({ labels, value: Number(last ?? 0) });
    }
    return samples;
  }
}
