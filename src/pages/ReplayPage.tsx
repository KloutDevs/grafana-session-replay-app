import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { css } from '@emotion/css';
import { GrafanaTheme2, locationUtil } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import { Alert, Button, LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import { JUMP_LEAD_MS } from '../constants';
import { ChunkLoader } from '../data/chunkLoader';
import { PlaybackController, type PlaybackState } from '../data/playbackController';
import { isValidSessionId } from '../data/logql';
import { linkOffsetAt, wallAt, wallFromLink } from '../domain/timeline';
import type { JourneyItem, Timeline } from '../domain/types';
import { useReplaySession } from '../hooks/useReplaySession';
import { useRepository } from '../hooks/useRepository';
import { JourneyFeed } from '../components/JourneyFeed/JourneyFeed';
import { Player, type PlayerHandle } from '../components/Player/Player';
import { PlayerControls } from '../components/Player/PlayerControls';
import { Timeline as TimelineBar } from '../components/Timeline/Timeline';
import { numberParam, replayPath, sessionsPath } from '../utils/links';

function ReplayView({
  timeline,
  journey,
  incomplete,
  sessionId,
  t,
}: {
  timeline: Timeline;
  journey: JourneyItem[];
  incomplete: boolean;
  sessionId: string;
  t: number | undefined;
}) {
  const styles = useStyles2(getStyles);
  const repository = useRepository();
  const player = useRef<PlayerHandle>(null);
  const [state, setState] = useState<PlaybackState>({
    status: 'idle',
    chunkIndex: 0,
    offsetMs: 0,
    recordedMs: 0,
    speed: 1,
    skipInactive: true,
    notice: '',
  });
  const controller = useRef<PlaybackController | undefined>(undefined);
  const [shared, setShared] = useState(false);

  const loader = useMemo(
    () => new ChunkLoader((chunk, signal) => repository.loadChunk(sessionId, chunk, signal)),
    [repository, sessionId]
  );

  useEffect(() => {
    const handle = player.current;
    if (!handle || timeline.chunks.length === 0) {
      return undefined;
    }
    const next = new PlaybackController(timeline, loader, handle.factory, setState);
    controller.current = next;
    next.seekWall(wallFromLink(timeline, t ?? 0), false);
    return () => {
      next.destroy();
      controller.current = undefined;
    };
    // The controller is rebuilt only when the session or its timeline changes.
  }, [timeline, loader]); // eslint-disable-line react-hooks/exhaustive-deps

  useSyncExternalStore(
    (listener) => loader.subscribe(listener),
    () => loader.snapshotVersion()
  );
  const skipped = loader.malformedTotal();
  const currentWall = wallAt(timeline, state.chunkIndex, state.offsetMs);

  const share = async () => {
    const path = replayPath(sessionId, { t: linkOffsetAt(timeline, currentWall) });
    await navigator.clipboard?.writeText(`${window.location.origin}${locationUtil.assureBaseUrl(path)}`);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };

  const current = timeline.chunks[state.chunkIndex];

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.address} title={current?.href}>
          {current?.href || ' '}
        </div>
        <Player ref={player} state={state} />
        <PlayerControls
          state={state}
          totalMs={timeline.recordedMs}
          onPlay={() => controller.current?.play()}
          onPause={() => controller.current?.pause()}
          onSkip={(delta) => controller.current?.skip(delta)}
          onSpeed={(speed) => controller.current?.setSpeed(speed)}
          onSkipInactive={(value) => controller.current?.setSkipInactive(value)}
          onShare={() => void share()}
          onFullscreen={() => player.current?.requestFullscreen()}
        />
        {shared && <div className={styles.copied}>Link copied</div>}
        {skipped > 0 && (
          <div className={styles.skipped} data-testid="skipped-lines">
            {skipped} recorded {skipped === 1 ? 'line' : 'lines'} could not be read and {skipped === 1 ? 'was' : 'were'}{' '}
            skipped.
          </div>
        )}
        <TimelineBar
          timeline={timeline}
          items={journey}
          recordedMs={state.recordedMs}
          onSeek={(ms) => controller.current?.seekRecorded(ms)}
        />
        {incomplete && (
          <Alert title="Some data may be missing" severity="warning" className={styles.alert}>
            Loki could not return every line for this session. Parts of the recording may be incomplete.
          </Alert>
        )}
      </div>
      <aside className={styles.side}>
        <JourneyFeed
          timeline={timeline}
          items={journey}
          currentWallMs={currentWall}
          onJump={(item) => controller.current?.seekWall(Math.max(timeline.startMs, item.atMs - JUMP_LEAD_MS), true)}
        />
      </aside>
    </div>
  );
}

function ReplayPage() {
  const { sessionId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [reloads, setReloads] = useState(0);
  const from = numberParam(params.get('from'));
  const to = numberParam(params.get('to'));
  const t = numberParam(params.get('t'));
  const valid = isValidSessionId(sessionId);
  const load = useReplaySession(valid ? sessionId : '', from, to, reloads);

  if (!valid) {
    return (
      <PluginPage>
        <Alert title="This is not a valid session id" severity="error">
          <Link to={sessionsPath()}>Back to sessions</Link>
        </Alert>
      </PluginPage>
    );
  }

  return (
    <PluginPage pageNav={{ text: `Session ${sessionId}`, parentItem: { text: 'Sessions', url: sessionsPath() } }}>
      <div style={{ marginBottom: 8 }}>
        <Link to={sessionsPath()}>← All sessions</Link> · session <code>{sessionId}</code>
      </div>
      {load.status === 'loading' && <LoadingPlaceholder text="Loading the session…" />}
      {load.status === 'error' && (
        <Alert title="The session could not be loaded" severity="error">
          {load.message}
          <div>
            <Button size="sm" variant="secondary" onClick={() => setReloads((n) => n + 1)}>
              Try again
            </Button>
          </div>
        </Alert>
      )}
      {load.status === 'notfound' && (
        <Alert title="No recording found for this session" severity="info">
          It is not in the last 7 days of data, or it was recorded without replay.
          {(from !== undefined || to !== undefined) && (
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('from');
                  next.delete('to');
                  setParams(next, { replace: true });
                }}
              >
                Search the last 7 days
              </Button>
            </div>
          )}
        </Alert>
      )}
      {load.status === 'ready' && load.timeline.chunks.length === 0 && (
        <Alert title="This session has no replay data" severity="info">
          Its events are in Loki, but no screen was recorded (replay was off, sampled out, or on a route that is never
          recorded).
        </Alert>
      )}
      {load.status === 'ready' && load.timeline.chunks.length > 0 && (
        <ReplayView
          key={sessionId}
          timeline={load.timeline}
          journey={load.journey}
          incomplete={load.incomplete}
          sessionId={sessionId}
          t={t}
        />
      )}
    </PluginPage>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  layout: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 380px',
    gap: theme.spacing(2),
    alignItems: 'start',
  }),
  main: css({ minWidth: 0 }),
  side: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    minHeight: 320,
  }),
  address: css({
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    marginBottom: theme.spacing(1),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  skipped: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginBottom: theme.spacing(1),
  }),
  copied: css({ color: theme.colors.success.text, marginBottom: theme.spacing(1) }),
  alert: css({ marginTop: theme.spacing(1) }),
});

export default ReplayPage;
