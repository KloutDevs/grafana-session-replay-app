import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { ROUTES } from '../../constants';
import { SettingsProvider } from '../../hooks/useSettings';
import { AccessGate } from '../AccessGate/AccessGate';

const SessionsPage = React.lazy(() => import('../../pages/SessionsPage'));
const ReplayPage = React.lazy(() => import('../../pages/ReplayPage'));

function App(props: AppRootProps) {
  return (
    <SettingsProvider jsonData={props.meta.jsonData as Record<string, unknown> | undefined}>
      <AccessGate>
        <Suspense fallback={<LoadingPlaceholder text="Loading…" />}>
          <Routes>
            <Route path={ROUTES.Sessions} element={<SessionsPage />} />
            <Route path={`${ROUTES.Session}/:sessionId`} element={<ReplayPage />} />
            <Route path={`app/:appName/${ROUTES.Session}/:sessionId`} element={<ReplayPage />} />
            <Route path="*" element={<Navigate to={ROUTES.Sessions} replace />} />
          </Routes>
        </Suspense>
      </AccessGate>
    </SettingsProvider>
  );
}

export default App;
