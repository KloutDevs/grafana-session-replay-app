import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from '../testIds';

function props(jsonData: Record<string, unknown> = {}): AppConfigProps {
  return {
    plugin: {
      meta: {
        id: 'escalia-sessionreplay-app',
        name: 'Session Replay',
        type: PluginType.app,
        enabled: true,
        jsonData,
      },
    },
    query: {},
  } as unknown as AppConfigProps;
}

describe('AppConfig', () => {
  it('shows the defaults when nothing is stored', () => {
    render(<AppConfig {...props()} />);
    expect(screen.getByTestId(testIds.appConfig.lokiUid)).toHaveValue('loki');
    expect(screen.getByTestId(testIds.appConfig.selector)).toHaveValue('{service_name="frontend"}');
    expect(screen.getByTestId(testIds.appConfig.submit)).toBeEnabled();
  });

  it('shows what is stored', () => {
    render(<AppConfig {...props({ lokiUid: 'abc', selector: '{source="browser"}', format: 'logfmt' })} />);
    expect(screen.getByTestId(testIds.appConfig.lokiUid)).toHaveValue('abc');
    expect(screen.getByRole('radio', { name: 'logfmt' })).toBeChecked();
  });

  it('refuses a selector that is not a stream selector', () => {
    render(<AppConfig {...props()} />);
    fireEvent.change(screen.getByTestId(testIds.appConfig.selector), {
      target: { value: 'service_name="frontend" | json' },
    });
    expect(screen.getByTestId(testIds.appConfig.submit)).toBeDisabled();
  });
});
