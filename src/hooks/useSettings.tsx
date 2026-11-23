import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type LogFormat, type PluginSettings } from '../domain/types';
import { isValidSelector } from '../data/logql';

/** Reads the plugin settings stored by Grafana, filling gaps with the defaults. */
export function normalizeSettings(jsonData: Record<string, unknown> | undefined): PluginSettings {
  const data = jsonData ?? {};
  const format: LogFormat = data['format'] === 'logfmt' ? 'logfmt' : 'json';
  const selector =
    typeof data['selector'] === 'string' && isValidSelector(data['selector'])
      ? data['selector'].trim()
      : DEFAULT_SETTINGS.selector;
  const lokiUid =
    typeof data['lokiUid'] === 'string' && data['lokiUid'].trim() ? data['lokiUid'].trim() : DEFAULT_SETTINGS.lokiUid;
  const pad = Number(data['clockPadSeconds']);
  return {
    lokiUid,
    selector,
    format,
    clockPadSeconds: Number.isFinite(pad) && pad >= 0 && pad <= 3600 ? pad : DEFAULT_SETTINGS.clockPadSeconds,
  };
}

const SettingsContext = createContext<PluginSettings>(DEFAULT_SETTINGS);

export function SettingsProvider({
  jsonData,
  children,
}: {
  jsonData: Record<string, unknown> | undefined;
  children: ReactNode;
}) {
  const settings = useMemo(() => normalizeSettings(jsonData), [jsonData]);
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useSettings(): PluginSettings {
  return useContext(SettingsContext);
}
