import config from './config';
import ClientError from '../models/client-error';
import { setRedisStatus } from './runtime-status';

type RedisLogLevel = 'info' | 'warn' | 'error';

type RedisTarget = {
  url: string;
  host: string;
  port: number | null;
};

type RedisFeatureModeOptions = {
  availableMessage: string;
  unavailableMessage: string;
  availableLevel?: RedisLogLevel;
  unavailableLevel?: RedisLogLevel;
  extra?: Record<string, unknown>;
};

type RedisConnectionState = {
  available: boolean | null;
};

const REDIS_UNAVAILABLE_CODE = 'REDIS_UNAVAILABLE';
const REDIS_QUEUE_MESSAGE = 'Background jobs are temporarily unavailable. Please try again later.';

const featureModeState = new Map<string, boolean | null>();
const connectionState = new Map<string, RedisConnectionState>();

export const getRedisTarget = (redisUrl: string = config.redisUrl): RedisTarget => {
  try {
    const parsed = new URL(redisUrl);
    const port = parsed.port ? parseInt(parsed.port, 10) : 6379;

    return {
      url: redisUrl,
      host: parsed.hostname || 'localhost',
      port: Number.isNaN(port) ? null : port,
    };
  } catch {
    return {
      url: redisUrl,
      host: 'unknown',
      port: null,
    };
  }
};

const serializeRedisError = (err: any, redisUrl?: string) => {
  const target = getRedisTarget(redisUrl);

  return {
    message: err?.message || 'Unknown Redis error',
    code: err?.code,
    errno: err?.errno,
    syscall: err?.syscall,
    address: err?.address,
    port: err?.port,
    stack: err?.stack,
    target,
  };
};

export const logRedisFeatureMode = (
  feature: string,
  enabled: boolean,
  options: RedisFeatureModeOptions,
): void => {
  const previous = featureModeState.get(feature);
  if (previous === enabled) {
    return;
  }

  featureModeState.set(feature, enabled);

  const level = enabled
    ? (options.availableLevel || 'info')
    : (options.unavailableLevel || 'info');
  const message = enabled ? options.availableMessage : options.unavailableMessage;

  config.log[level]({
    dependency: 'redis',
    feature,
    degradedMode: !enabled,
    ...options.extra,
  }, message);
};

export const markRedisConnectionUnavailable = (
  channel: string,
  err?: any,
  options: { affectsRuntime?: boolean; redisUrl?: string } = {},
): void => {
  if (options.affectsRuntime) {
    setRedisStatus('down');
  }

  const previous = connectionState.get(channel)?.available ?? null;
  connectionState.set(channel, { available: false });

  if (previous === false) {
    return;
  }

  const error = err ? serializeRedisError(err, options.redisUrl) : undefined;
  const target = getRedisTarget(options.redisUrl);

  config.log.warn({
    dependency: 'redis',
    channel,
    target,
    ...(error ? { error } : {}),
  }, `${channel} Redis connection unavailable`);
};

export const markRedisConnectionAvailable = (
  channel: string,
  options: { affectsRuntime?: boolean; redisUrl?: string } = {},
): void => {
  if (options.affectsRuntime) {
    setRedisStatus('up');
  }

  const previous = connectionState.get(channel)?.available ?? null;
  connectionState.set(channel, { available: true });

  if (previous !== false) {
    return;
  }

  config.log.info({
    dependency: 'redis',
    channel,
    target: getRedisTarget(options.redisUrl),
  }, `${channel} Redis connection recovered`);
};

export const logRedisOperationFailure = (
  feature: string,
  action: string,
  err: any,
  extra: Record<string, unknown> = {},
): void => {
  config.log.warn({
    dependency: 'redis',
    feature,
    action,
    error: serializeRedisError(err),
    ...extra,
  }, `Redis ${feature} ${action} failed`);
};

const createRedisUnavailableError = (
  feature: string,
  message: string,
): ClientError => {
  return new ClientError(503, message, {
    code: REDIS_UNAVAILABLE_CODE,
    dependency: 'redis',
    feature,
    degradedMode: true,
    message,
  });
};

export const createRedisQueueUnavailableError = (feature: string): ClientError =>
  createRedisUnavailableError(feature, REDIS_QUEUE_MESSAGE);

