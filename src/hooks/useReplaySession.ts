import { useEffect, useState } from 'react';
import { SESSION_LOOKBACK_MS, SESSION_SPAN_MS } from '../constants';
import type { JourneyItem, Timeline } from '../domain/types';
import { useRepository } from './useRepository';

export type ReplayLoad =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'error'; message: string }
  | { status: 'ready'; timeline: Timeline; journey: JourneyItem[]; incomplete: boolean };

/**
 * Loads what a replay needs before any DOM: the timeline (index lines) and the
 * journey. Without `from`/`to` it first finds when the session started.
 */
export function useReplaySession(
  sessionId: string,
  from: number | undefined,
  to: number | undefined,
  reloads: number
): ReplayLoad {
  const repository = useRepository();
  const requestKey = `${sessionId}:${from ?? ''}:${to ?? ''}:${reloads}`;
  const [result, setResult] = useState<{ key: string; load: ReplayLoad }>({ key: '', load: { status: 'loading' } });
  const load: ReplayLoad = result.key === requestKey ? result.load : { status: 'loading' };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const setLoad = (next: ReplayLoad) => setResult({ key: requestKey, load: next });

    (async () => {
      const now = Date.now();
      let rangeFrom = from;
      let rangeTo = to;
      if (rangeFrom === undefined) {
        const started = await repository.findSessionStart(sessionId, SESSION_LOOKBACK_MS, now, signal);
        if (started === undefined) {
          setLoad({ status: 'notfound' });
          return;
        }
        rangeFrom = started - 60_000;
      }
      rangeTo = rangeTo ?? Math.min(now, rangeFrom + SESSION_SPAN_MS);

      const [{ timeline, incomplete }, journeyResult] = await Promise.all([
        repository.loadTimeline(sessionId, rangeFrom, rangeTo, signal),
        repository.loadJourney(sessionId, rangeFrom, rangeTo, signal),
      ]);
      if (!signal.aborted) {
        setLoad({
          status: 'ready',
          timeline,
          journey: journeyResult.items,
          incomplete: incomplete || journeyResult.incomplete,
        });
      }
    })().catch((error: unknown) => {
      if (!signal.aborted) {
        setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    });

    return () => controller.abort();
  }, [repository, sessionId, from, to, requestKey]);

  return load;
}
