import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Replayer } from '@grafana/rrweb';
import { LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import type { PlaybackState, ReplayerFactory } from '../../data/playbackController';
import type { ReplayEvent } from '../../domain/types';

export interface PlayerHandle {
  /** The factory the playback controller uses to build a player in this view. */
  factory: ReplayerFactory;
  requestFullscreen(): void;
}

function pageSize(events: ReplayEvent[]): { width: number; height: number } {
  const meta = events.find((event) => event.type === 4);
  const data = meta?.data as { width?: number; height?: number } | undefined;
  return { width: data?.width || 1280, height: data?.height || 720 };
}

/** Shows the page being replayed, scaled to fit, with a message on top when needed. */
export const Player = forwardRef<PlayerHandle, { state: PlaybackState }>(function Player({ state }, ref) {
  const styles = useStyles2(getStyles);
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const size = useRef({ width: 1280, height: 720 });

  const fit = () => {
    const root = stage.current;
    const wrapper = root?.querySelector<HTMLElement>('.replayer-wrapper');
    if (!root || !wrapper) {
      return;
    }
    const scale = Math.min(root.clientWidth / size.current.width, root.clientHeight / size.current.height);
    wrapper.style.transformOrigin = 'top left';
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.position = 'absolute';
    wrapper.style.left = `${Math.max(0, (root.clientWidth - size.current.width * scale) / 2)}px`;
    wrapper.style.top = `${Math.max(0, (root.clientHeight - size.current.height * scale) / 2)}px`;
  };

  useImperativeHandle(ref, () => ({
    factory: (events, options) => {
      const root = stage.current;
      if (!root) {
        throw new Error('The player is not mounted yet.');
      }
      size.current = pageSize(events);
      const replayer = new Replayer(events as never, {
        root,
        speed: options.speed,
        skipInactive: options.skipInactive,
        showWarning: false,
        showDebug: false,
        liveMode: false,
        triggerFocus: false,
        UNSAFE_replayCanvas: false,
        mouseTail: false,
      });
      replayer.on('resize', (dimension: unknown) => {
        const next = dimension as { width: number; height: number };
        size.current = { width: next.width, height: next.height };
        fit();
      });
      fit();
      return replayer;
    },
    requestFullscreen: () => {
      void frame.current?.requestFullscreen?.();
    },
  }));

  useEffect(() => {
    const root = stage.current;
    if (!root || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frame} className={styles.frame}>
      <div ref={stage} className={styles.stage} data-testid="replay-stage" />
      {state.status === 'loading' && (
        <div className={styles.overlay}>
          <LoadingPlaceholder text="Loading this part of the recording…" />
        </div>
      )}
      {state.status === 'ended' && <div className={styles.overlay}>End of the recording</div>}
      {state.status === 'unplayable' && <div className={styles.overlay}>{state.notice}</div>}
      {state.notice && state.status !== 'unplayable' && <div className={styles.notice}>{state.notice}</div>}
    </div>
  );
});

const getStyles = (theme: GrafanaTheme2) => ({
  frame: css({
    position: 'relative',
    width: '100%',
    aspectRatio: '16 / 9',
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    ':fullscreen': { aspectRatio: 'auto', height: '100vh' },
  }),
  // The few rules rrweb's stylesheet gives the replay, written here so the player does not
  // depend on how a stylesheet from a dependency is bundled inside Grafana.
  stage: css({
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    '.replayer-wrapper': { position: 'relative', background: 'white' },
    '.replayer-wrapper > iframe': { border: 'none' },
    '.replayer-mouse': {
      position: 'absolute',
      width: 20,
      height: 20,
      transition: 'left 0.05s linear, top 0.05s linear',
      pointerEvents: 'none',
    },
    '.replayer-mouse::after': {
      content: '""',
      display: 'inline-block',
      width: 20,
      height: 20,
      background: 'rgb(73, 80, 246)',
      borderRadius: '100%',
      transform: 'translate(-10px, -10px)',
      opacity: 0.4,
    },
  }),
  overlay: css({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.45)',
    color: theme.colors.text.maxContrast,
    textAlign: 'center',
    padding: theme.spacing(2),
  }),
  notice: css({
    position: 'absolute',
    left: theme.spacing(1),
    right: theme.spacing(1),
    bottom: theme.spacing(1),
    background: theme.colors.warning.main,
    color: theme.colors.warning.contrastText,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.5, 1),
  }),
});
