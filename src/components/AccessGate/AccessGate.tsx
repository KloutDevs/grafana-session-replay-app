import React, { type ReactNode } from 'react';
import { config } from '@grafana/runtime';
import { Alert } from '@grafana/ui';

/** Replays can show personal data, so only Editors and Admins may open them. */
export function canViewReplays(): boolean {
  const user = config.bootData?.user;
  return Boolean(user?.isGrafanaAdmin) || user?.orgRole === 'Editor' || user?.orgRole === 'Admin';
}

export function AccessGate({ children }: { children: ReactNode }) {
  if (!canViewReplays()) {
    return (
      <Alert title="You do not have access to session replays" severity="warning">
        Recorded sessions can contain personal data. Ask an administrator for the Editor role to open them.
      </Alert>
    );
  }
  return <>{children}</>;
}
