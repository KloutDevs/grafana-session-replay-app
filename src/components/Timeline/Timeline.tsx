import React, { useRef } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { JourneyItem, Timeline as TimelineData } from '../../domain/types';
import { positionAtWall } from '../../domain/timeline';

export interface TimelineProps {
  timeline: TimelineData;
  items: JourneyItem[];
  recordedMs: number;
  onSeek(recordedMs: number): void;
}

/** Recorded time laid out left to right: one block per chunk, markers for errors and page changes. */
export function Timeline({ timeline, items, recordedMs, onSeek }: TimelineProps) {
  const styles = useStyles2(getStyles);
  const track = useRef<HTMLDivElement>(null);
  const total = Math.max(1, timeline.recordedMs);
  const percent = (ms: number) => `${Math.min(100, (ms / total) * 100)}%`;

  const markers = items
    .filter((item) => item.kind === 'exception' || item.kind === 'navigation' || item.level === 'error')
    .map((item, index) => {
      const position = positionAtWall(timeline, item.atMs);
      return position
        ? { key: `${index}-${item.atMs}`, at: position.recordedMs, error: item.level === 'error' }
        : undefined;
    })
    .filter((marker): marker is { key: string; at: number; error: boolean } => marker !== undefined);

  const seekTo = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (box && box.width > 0) {
      onSeek(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * total);
    }
  };

  return (
    <div
      ref={track}
      className={styles.track}
      role="slider"
      tabIndex={0}
      aria-label="Position in the recording"
      aria-valuemin={0}
      aria-valuemax={Math.round(total / 1000)}
      aria-valuenow={Math.round(recordedMs / 1000)}
      onClick={(event) => seekTo(event.clientX)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          onSeek(recordedMs + 5000);
        } else if (event.key === 'ArrowLeft') {
          onSeek(recordedMs - 5000);
        }
      }}
    >
      {timeline.chunks.map((chunk, index) => {
        const before = timeline.chunks.slice(0, index).reduce((sum, c) => sum + (c.endMs - c.startMs), 0);
        return (
          <div
            key={chunk.key}
            className={styles.chunk}
            style={{ left: percent(before), width: percent(chunk.endMs - chunk.startMs) }}
            title={chunk.href}
          />
        );
      })}
      {markers.map((marker) => (
        <div
          key={marker.key}
          className={marker.error ? styles.errorMarker : styles.marker}
          style={{ left: percent(marker.at) }}
        />
      ))}
      <div className={styles.playhead} style={{ left: percent(recordedMs) }} />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  track: css({
    position: 'relative',
    height: 28,
    cursor: 'pointer',
    background: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  chunk: css({
    position: 'absolute',
    top: 10,
    height: 8,
    background: theme.colors.primary.main,
    opacity: 0.55,
    borderRight: `1px solid ${theme.colors.background.primary}`,
  }),
  marker: css({
    position: 'absolute',
    top: 4,
    width: 4,
    height: 4,
    borderRadius: '50%',
    background: theme.colors.text.secondary,
    transform: 'translateX(-50%)',
  }),
  errorMarker: css({
    position: 'absolute',
    top: 4,
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: theme.colors.error.main,
    transform: 'translateX(-50%)',
  }),
  playhead: css({
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    background: theme.colors.text.maxContrast,
    transform: 'translateX(-50%)',
  }),
});
