import type { Fields, JourneyItem, JourneyKind, JourneyLevel } from '../domain/types';
import { parseTimestamp } from './logFormat';

const NAVIGATION_EVENTS = new Set([
  'session_start',
  'route_change',
  'faro.navigation',
  'faro.performance.navigation',
  'faro.view.changed',
]);
const NOISE_EVENTS = new Set(['faro.performance.resource']);

function levelOf(raw: string | undefined): JourneyLevel {
  if (raw === 'error') {
    return 'error';
  }
  return raw === 'warn' || raw === 'warning' ? 'warn' : 'info';
}

function measurementDetail(fields: Fields): string {
  return Object.entries(fields)
    .filter(([key]) => key.startsWith('value_'))
    .map(([key, value]) => `${key.slice('value_'.length)} ${value}`)
    .join(', ');
}

/** Turns one non-replay line into a journey item, or undefined when it is noise. */
export function toJourneyItem(fields: Fields, lokiMs: number): JourneyItem | undefined {
  const kind = fields['kind'];
  const eventName = fields['event_name'] ?? '';
  const atMs = parseTimestamp(fields['timestamp']) ?? lokiMs;
  const url = fields['page_url'] ?? '';

  if (kind === 'exception') {
    const type = fields['type'] ?? 'Error';
    const value = fields['value'] ?? '';
    return {
      atMs,
      kind: 'exception',
      level: 'error',
      title: value ? `${type}: ${value}` : type,
      detail: fields['stacktrace'] ?? '',
      url,
    };
  }
  if (kind === 'log') {
    return { atMs, kind: 'log', level: levelOf(fields['level']), title: fields['message'] ?? '', detail: '', url };
  }
  if (kind === 'measurement') {
    return {
      atMs,
      kind: 'measurement',
      level: 'info',
      title: fields['type'] ?? 'measurement',
      detail: measurementDetail(fields),
      url,
    };
  }
  if (kind === 'event') {
    if (NOISE_EVENTS.has(eventName) || eventName.startsWith('faro.session_recording.')) {
      return undefined;
    }
    const itemKind: JourneyKind = NAVIGATION_EVENTS.has(eventName) ? 'navigation' : 'event';
    const level: JourneyLevel = eventName === 'faro.frustration.error_click' ? 'error' : 'info';
    return { atMs, kind: itemKind, level, title: eventName, detail: '', url };
  }
  return undefined;
}
