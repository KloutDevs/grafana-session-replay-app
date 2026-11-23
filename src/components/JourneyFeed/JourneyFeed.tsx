import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Badge, IconButton, RadioButtonGroup, Switch, useStyles2 } from '@grafana/ui';
import type { JourneyItem, Timeline } from '../../domain/types';
import { positionAtWall } from '../../domain/timeline';
import { formatClock } from '../../utils/format';

type Filter = 'all' | 'navigation' | 'custom' | 'errors';

export interface JourneyFeedProps {
  timeline: Timeline;
  items: JourneyItem[];
  /** Browser-clock time of the playhead. */
  currentWallMs: number;
  onJump(item: JourneyItem): void;
}

function matches(filter: Filter, item: JourneyItem): boolean {
  if (filter === 'navigation') {
    return item.kind === 'navigation';
  }
  if (filter === 'errors') {
    return item.level === 'error';
  }
  return filter === 'all' || item.kind === 'event' || item.kind === 'log';
}

/** Everything the session logged, beside the player, with jump-to-event and follow-playback. */
export function JourneyFeed({ timeline, items, currentWallMs, onJump }: JourneyFeedProps) {
  const styles = useStyles2(getStyles);
  const [filter, setFilter] = useState<Filter>('all');
  const [follow, setFollow] = useState(true);
  const activeRef = useRef<HTMLLIElement>(null);

  const visible = useMemo(() => items.filter((item) => matches(filter, item)), [items, filter]);
  const activeIndex = useMemo(() => {
    let found = -1;
    visible.forEach((item, index) => {
      if (item.atMs <= currentWallMs) {
        found = index;
      }
    });
    return found;
  }, [visible, currentWallMs]);

  useEffect(() => {
    if (follow) {
      activeRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeIndex, follow]);

  return (
    <div className={styles.feed}>
      <div className={styles.head}>
        <RadioButtonGroup
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Navigation', value: 'navigation' },
            { label: 'Custom', value: 'custom' },
            { label: 'Errors', value: 'errors' },
          ]}
        />
        <label className={styles.follow}>
          Follow playback <Switch value={follow} onChange={(event) => setFollow(event.currentTarget.checked)} />
        </label>
      </div>
      <ol className={styles.list}>
        {visible.map((item, index) => {
          const position = positionAtWall(timeline, item.atMs);
          return (
            <li
              key={`${item.atMs}-${index}`}
              ref={index === activeIndex ? activeRef : undefined}
              className={cx(styles.item, index === activeIndex && styles.active)}
            >
              <span className={styles.offset}>{position ? formatClock(position.recordedMs) : '–'}</span>
              <Badge
                text={item.kind}
                color={item.level === 'error' ? 'red' : item.level === 'warn' ? 'orange' : 'blue'}
              />
              <span className={styles.title} title={item.detail || item.title}>
                {item.title}
              </span>
              <IconButton name="play" tooltip="Jump to this event" onClick={() => onJump(item)} />
            </li>
          );
        })}
        {visible.length === 0 && <li className={styles.empty}>Nothing to show for this filter.</li>}
      </ol>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  feed: css({ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }),
  head: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing(1),
    paddingBottom: theme.spacing(1),
  }),
  follow: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), color: theme.colors.text.secondary }),
  list: css({ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1, maxHeight: 640 }),
  item: css({
    display: 'grid',
    gridTemplateColumns: '56px auto 1fr auto',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  active: css({ background: theme.colors.action.selected }),
  offset: css({ fontFamily: theme.typography.fontFamilyMonospace, color: theme.colors.text.secondary }),
  title: css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(2) }),
});
