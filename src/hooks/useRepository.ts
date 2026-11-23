import { useMemo } from 'react';
import { LokiClient } from '../data/lokiClient';
import { SessionRepository } from '../data/sessionRepository';
import { useSettings } from './useSettings';

export function useRepository(): SessionRepository {
  const settings = useSettings();
  return useMemo(() => new SessionRepository(new LokiClient(settings.lokiUid), settings), [settings]);
}
