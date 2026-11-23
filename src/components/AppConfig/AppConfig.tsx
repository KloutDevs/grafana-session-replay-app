import React, { useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Button, Field, FieldSet, Input, RadioButtonGroup } from '@grafana/ui';
import { isValidSelector } from '../../data/logql';
import type { LogFormat } from '../../domain/types';
import { normalizeSettings } from '../../hooks/useSettings';
import { testIds } from '../testIds';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<Record<string, unknown>>> {}

const FORMATS: Array<{ label: string; value: LogFormat; description: string }> = [
  { label: 'JSON', value: 'json', description: 'One JSON object per line (production).' },
  { label: 'logfmt', value: 'logfmt', description: 'key=value pairs (test stack).' },
];

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData } = plugin.meta;
  const initial = normalizeSettings(jsonData);
  const [lokiUid, setLokiUid] = useState(initial.lokiUid);
  const [selector, setSelector] = useState(initial.selector);
  const [format, setFormat] = useState<LogFormat>(initial.format);
  const [pad, setPad] = useState(String(initial.clockPadSeconds));
  const [error, setError] = useState('');

  const padNumber = Number(pad);
  const selectorValid = isValidSelector(selector);
  const padValid = Number.isFinite(padNumber) && padNumber >= 0 && padNumber <= 3600;
  const invalid = !lokiUid.trim() || !selectorValid || !padValid;

  const save = async () => {
    if (invalid) {
      return;
    }
    try {
      await lastValueFrom(
        getBackendSrv().fetch({
          url: `/api/plugins/${plugin.meta.id}/settings`,
          method: 'POST',
          data: {
            enabled,
            pinned,
            jsonData: { lokiUid: lokiUid.trim(), selector: selector.trim(), format, clockPadSeconds: padNumber },
          },
        })
      );
      // Settings reach the plugin only after a reload.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The settings could not be saved.');
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FieldSet label="Where the recordings are">
        <Field label="Loki datasource uid" description="The uid of the Loki datasource that holds the Faro data.">
          <Input
            width={40}
            data-testid={testIds.appConfig.lokiUid}
            value={lokiUid}
            onChange={(e) => setLokiUid(e.currentTarget.value)}
          />
        </Field>
        <Field
          label="Stream selector"
          description='A LogQL stream selector for the Faro lines, for example {service_name="frontend"}. Only text filters are added after it.'
          invalid={!selectorValid}
          error='Enter a stream selector such as {service_name="frontend"}'
        >
          <Input
            width={60}
            data-testid={testIds.appConfig.selector}
            value={selector}
            onChange={(e) => setSelector(e.currentTarget.value)}
          />
        </Field>
        <Field label="Line format" description={FORMATS.find((option) => option.value === format)?.description}>
          <RadioButtonGroup
            options={FORMATS.map(({ label, value }) => ({ label, value }))}
            value={format}
            onChange={setFormat}
          />
        </Field>
        <Field
          label="Clock padding (seconds)"
          description="Time added around each part of a recording when reading Loki."
          invalid={!padValid}
          error="Enter a number from 0 to 3600"
        >
          <Input width={20} type="number" value={pad} onChange={(e) => setPad(e.currentTarget.value)} />
        </Field>
        {error && (
          <Alert title="Not saved" severity="error">
            {error}
          </Alert>
        )}
        <Button type="submit" data-testid={testIds.appConfig.submit} disabled={invalid}>
          Save settings
        </Button>
      </FieldSet>
    </form>
  );
};

export default AppConfig;
