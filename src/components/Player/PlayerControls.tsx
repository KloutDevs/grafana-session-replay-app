import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Combobox, IconButton, Switch, useStyles2 } from '@grafana/ui';
import type { PlaybackState } from '../../data/playbackController';
import { formatClock } from '../../utils/format';

const SPEEDS = [0.5, 1, 2, 4].map((value) => ({ label: `${value}×`, value }));

export interface PlayerControlsProps {
  state: PlaybackState;
  totalMs: number;
  onPlay(): void;
  onPause(): void;
  onSkip(deltaMs: number): void;
  onSpeed(speed: number): void;
  onSkipInactive(value: boolean): void;
  onShare(): void;
  onFullscreen(): void;
}

export function PlayerControls({
  state,
  totalMs,
  onPlay,
  onPause,
  onSkip,
  onSpeed,
  onSkipInactive,
  onShare,
  onFullscreen,
}: PlayerControlsProps) {
  const styles = useStyles2(getStyles);
  const playing = state.status === 'playing';
  return (
    <div className={styles.bar}>
      <IconButton name="backward" tooltip="Back 10 seconds" onClick={() => onSkip(-10_000)} />
      <IconButton
        name={playing ? 'pause' : 'play'}
        size="xl"
        tooltip={playing ? 'Pause' : 'Play'}
        onClick={playing ? onPause : onPlay}
      />
      <IconButton name="forward" tooltip="Forward 10 seconds" onClick={() => onSkip(10_000)} />
      <span className={styles.time} data-testid="replay-time">
        {formatClock(state.recordedMs)} / {formatClock(totalMs)}
      </span>
      <div className={styles.spacer} />
      <Combobox
        aria-label="Speed"
        width={10}
        value={state.speed}
        options={SPEEDS}
        onChange={(option) => onSpeed(option.value)}
      />
      <label className={styles.label}>
        Skip inactivity{' '}
        <Switch value={state.skipInactive} onChange={(event) => onSkipInactive(event.currentTarget.checked)} />
      </label>
      <IconButton name="share-alt" tooltip="Copy a link to this moment" onClick={onShare} />
      <IconButton name="expand-arrows" tooltip="Fullscreen" onClick={onFullscreen} />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  bar: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1.5), padding: theme.spacing(1, 0) }),
  time: css({ fontFamily: theme.typography.fontFamilyMonospace, color: theme.colors.text.secondary }),
  spacer: css({ flex: 1 }),
  label: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), color: theme.colors.text.secondary }),
});
