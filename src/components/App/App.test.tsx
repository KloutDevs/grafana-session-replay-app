import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppRootProps, PluginType } from '@grafana/data';
import { render, screen } from '@testing-library/react';
import { config } from '@grafana/runtime';
import App from './App';

jest.mock('../../pages/SessionsPage', () => ({ __esModule: true, default: () => <div>sessions page</div> }));
jest.mock('../../pages/ReplayPage', () => ({ __esModule: true, default: () => <div>replay page</div> }));

const props = {
  basename: 'a/x',
  meta: { id: 'x', name: 'x', type: PluginType.app, enabled: true, jsonData: {} },
  query: {},
  path: '',
  onNavChanged: jest.fn(),
} as unknown as AppRootProps;

function user(orgRole: string, isGrafanaAdmin = false) {
  (config as unknown as { bootData: unknown }).bootData = { user: { orgRole, isGrafanaAdmin } };
}

describe('App', () => {
  it('opens the sessions page for an Editor, also from an unknown path', async () => {
    user('Editor');
    render(
      <MemoryRouter initialEntries={['/nowhere']}>
        <App {...props} />
      </MemoryRouter>
    );
    expect(await screen.findByText('sessions page')).toBeInTheDocument();
  });

  it('opens the replay route', async () => {
    user('Admin');
    render(
      <MemoryRouter initialEntries={['/session/abcd1234']}>
        <App {...props} />
      </MemoryRouter>
    );
    expect(await screen.findByText('replay page')).toBeInTheDocument();
  });

  it('shows a permission message to a Viewer and loads no page', () => {
    user('Viewer');
    render(
      <MemoryRouter initialEntries={['/sessions']}>
        <App {...props} />
      </MemoryRouter>
    );
    expect(screen.getByText(/do not have access to session replays/i)).toBeInTheDocument();
    expect(screen.queryByText('sessions page')).not.toBeInTheDocument();
  });
});
