import { name, version } from '../../package.json';

type DependencyStatus = 'up' | 'down';
type RuntimeStatus = 'ok' | 'degraded' | 'down';

type RuntimeState = {
  startedAt: number;
  mongo: DependencyStatus;
  mongoName: string | null;
  redis: DependencyStatus;
  workersEnabled: boolean;
};

const state: RuntimeState = {
  startedAt: Date.now(),
  mongo: 'down',
  mongoName: null,
  redis: 'down',
  workersEnabled: false,
};

const getOverallStatus = (): RuntimeStatus => {
  if (state.mongo !== 'up') {
    return 'down';
  }

  if (state.redis !== 'up') {
    return 'degraded';
  }

  return 'ok';
};

export const setMongoStatus = (status: DependencyStatus, mongoName?: string | null): void => {
  state.mongo = status;
  state.mongoName = status === 'up' ? (mongoName ?? state.mongoName) : null;
};

export const setRedisStatus = (status: DependencyStatus): void => {
  state.redis = status;
};

export const setWorkersEnabled = (enabled: boolean): void => {
  state.workersEnabled = enabled;
};

export const getRuntimeSnapshot = () => {
  const status = getOverallStatus();

  return {
    status,
    app: name,
    version,
    mongo: state.mongo,
    redis: state.redis,
    workersEnabled: state.workersEnabled,
    degradedMode: status === 'degraded',
    mongoName: state.mongoName,
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
  };
};

export const getLivenessSnapshot = () => ({
  status: 'ok' as const,
  app: name,
  version,
  uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
});

