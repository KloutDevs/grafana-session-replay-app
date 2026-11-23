import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import { Alert, Badge, Combobox, Icon, Input, LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import { LOOKBACKS } from '../constants';
import type { Session } from '../domain/types';
import { useRepository } from '../hooks/useRepository';
import { formatDateTime } from '../utils/format';
import { replayPath } from '../utils/links';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sessions: Session[]; incomplete: boolean };

function SessionsPage() {
  const styles = useStyles2(getStyles);
  const repository = useRepository();
  const [params, setParams] = useSearchParams();
  const lookback = LOOKBACKS.find((option) => option.value === params.get('lookback')) ?? LOOKBACKS[3];
  const app = params.get('app') ?? '';
  const environment = params.get('env') ?? '';
  const search = params.get('q') ?? '';
  const [reloads, setReloads] = useState(0);
  // The result is stored with the request it answers; a different request means "loading".
  const requestKey = `${lookback.value}:${reloads}`;
  const [result, setResult] = useState<{ key: string; load: Load }>({ key: '', load: { status: 'loading' } });
  const load = useMemo<Load>(
    () => (result.key === requestKey ? result.load : { status: 'loading' }),
    [result, requestKey]
  );

  useEffect(() => {
    const controller = new AbortController();
    const setLoad = (next: Load | ((current: Load) => Load)) =>
      setResult((current) => ({
        key: requestKey,
        load:
          typeof next === 'function' ? next(current.key === requestKey ? current.load : { status: 'loading' }) : next,
      }));
    const now = Date.now();
    const from = now - lookback.ms;
    repository
      .listSessions(from, now, controller.signal)
      .then(({ sessions, incomplete }) => {
        if (controller.signal.aborted) {
          return;
        }
        setLoad({ status: 'ready', sessions, incomplete });
        // Error counts come from a second query and are added when they arrive.
        repository
          .errorCounts(from, now, controller.signal)
          .then((counts) => {
            if (!controller.signal.aborted) {
              setLoad((current) =>
                current.status === 'ready'
                  ? {
                      ...current,
                      sessions: current.sessions.map((s) => ({ ...s, errorCount: counts.get(s.sessionId) ?? 0 })),
                    }
                  : current
              );
            }
          })
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => controller.abort();
  }, [repository, lookback.ms, requestKey]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const sessions = useMemo(() => (load.status === 'ready' ? load.sessions : []), [load]);
  const apps = useMemo(() => [...new Set(sessions.map((s) => s.appName).filter(Boolean))].sort(), [sessions]);
  const environments = useMemo(
    () => [...new Set(sessions.map((s) => s.appEnvironment).filter(Boolean))].sort(),
    [sessions]
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sessions.filter(
      (s) =>
        (!app || s.appName === app) &&
        (!environment || s.appEnvironment === environment) &&
        (!needle || [s.sessionId, s.userId, s.browser, s.appName].some((text) => text.toLowerCase().includes(needle)))
    );
  }, [sessions, app, environment, search]);

  return (
    <PluginPage>
      <div className={styles.filters}>
        <Input
          prefix={<Icon name="search" />}
          placeholder="Search session, user or browser"
          value={search}
          onChange={(event) => update('q', event.currentTarget.value)}
          width={40}
        />
        <Combobox
          aria-label="Application"
          width={30}
          isClearable
          placeholder="All applications"
          value={app || null}
          options={apps.map((name) => ({ label: name, value: name }))}
          onChange={(option) => update('app', option?.value ?? '')}
        />
        <Combobox
          aria-label="Environment"
          width={22}
          isClearable
          placeholder="All environments"
          value={environment || null}
          options={environments.map((name) => ({ label: name, value: name }))}
          onChange={(option) => update('env', option?.value ?? '')}
        />
        <Combobox
          aria-label="Time range"
          width={22}
          value={lookback.value}
          options={LOOKBACKS.map((option) => ({ label: option.label, value: option.value }))}
          onChange={(option) => update('lookback', option.value)}
        />
      </div>

      {load.status === 'loading' && <LoadingPlaceholder text="Loading sessions…" />}
      {load.status === 'error' && (
        <Alert title="Sessions could not be loaded" severity="error" onRemove={() => setReloads((n) => n + 1)}>
          {load.message}. Check the Loki datasource in the plugin settings, then close this message to try again.
        </Alert>
      )}
      {load.status === 'ready' && load.incomplete && (
        <Alert title="The list may be incomplete" severity="warning">
          Loki returned the most lines it allows for part of this range. Narrow the time range.
        </Alert>
      )}
      {load.status === 'ready' && visible.length === 0 && (
        <div className={styles.empty}>
          No recorded sessions in this range. Choose a wider time range, or check that replay is enabled in the
          application.
        </div>
      )}
      {load.status === 'ready' && visible.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Started</th>
              <th>Session</th>
              <th>User</th>
              <th>Application</th>
              <th>Environment</th>
              <th>Browser</th>
              <th>Page loads</th>
              <th>Errors</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((session) => (
              <tr key={session.sessionId}>
                <td>{formatDateTime(session.startedAtMs)}</td>
                <td>
                  <code>{session.sessionId}</code>
                </td>
                <td>{session.userId || '–'}</td>
                <td>{session.appName}</td>
                <td>{session.appEnvironment}</td>
                <td>{session.browser}</td>
                <td>{session.pageLoads}</td>
                <td>
                  {session.errorCount === undefined ? (
                    '…'
                  ) : session.errorCount > 0 ? (
                    <Badge color="red" text={String(session.errorCount)} icon="exclamation-triangle" />
                  ) : (
                    0
                  )}
                </td>
                <td>
                  <Link
                    className={styles.replayLink}
                    to={replayPath(session.sessionId, { from: session.lokiStartMs - 60_000 })}
                  >
                    <Icon name="play" /> Replay
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PluginPage>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  filters: css({ display: 'flex', gap: theme.spacing(1), flexWrap: 'wrap', marginBottom: theme.spacing(2) }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(4), textAlign: 'center' }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse',
    'th, td': {
      textAlign: 'left',
      padding: theme.spacing(1, 1.5),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
    th: { color: theme.colors.text.secondary, fontWeight: theme.typography.fontWeightMedium },
    code: { fontFamily: theme.typography.fontFamilyMonospace },
  }),
  replayLink: css({ display: 'inline-flex', gap: theme.spacing(0.5), alignItems: 'center' }),
});

export default SessionsPage;
