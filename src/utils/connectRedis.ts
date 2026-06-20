import { createClient } from 'redis';
import config from './config';
import {
  markRedisConnectionAvailable,
  markRedisConnectionUnavailable,
  getRedisTarget,
} from './redis-runtime';

// How long startup will wait for the initial Redis connection before
// continuing in degraded mode. The client keeps retrying in the background,
// so Redis can still recover (and re-enable rate limiting via the 'ready'
// event) after the server is already listening.
const REDIS_STARTUP_TIMEOUT_MS = Number(process.env.REDIS_STARTUP_TIMEOUT_MS) || 5000;

const redisClient = createClient({
  url: config.redisUrl,
  socket: {
    // Bound each socket connection attempt so an unreachable or unresolvable
    // host fails fast instead of stalling on a hung TCP connect.
    connectTimeout: 5000,
    // Keep retrying in the background with capped backoff so the client can
    // recover if Redis comes back. Returning a number (never an Error) means
    // connect() stays pending rather than rejecting — startup relies on the
    // timeout below to move on, instead of blocking the event loop forever.
    reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
  },
});

// Race the initial connect against a timeout so an unreachable Redis cannot
// stall bootstrap. connect() may stay pending (reconnectStrategy retries
// indefinitely); when it loses the race we proceed in degraded mode and let
// the abandoned attempt settle in the background.
const connectWithStartupTimeout = async (): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), REDIS_STARTUP_TIMEOUT_MS);
  });
  const connect = redisClient
    .connect()
    .then(() => redisClient.isReady)
    .catch(() => false);

  try {
    return await Promise.race([connect, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const connectRedis = async (): Promise<boolean> => {
  if (redisClient.isReady) {
    return true;
  }

  if (redisClient.isOpen && !redisClient.isReady) {
    return false;
  }

  try {
    const ready = await connectWithStartupTimeout();
    if (!ready) {
      markRedisConnectionUnavailable(
        'primary',
        new Error(`Redis not ready within ${REDIS_STARTUP_TIMEOUT_MS}ms startup timeout`),
        { affectsRuntime: true, redisUrl: config.redisUrl },
      );
    }
    return ready;
  } catch (err: any) {
    markRedisConnectionUnavailable('primary', err, {
      affectsRuntime: true,
      redisUrl: config.redisUrl,
    });
    return false;
  }
};

const isRedisAvailable = (): boolean => redisClient.isReady;

redisClient.on('ready', () => {
  markRedisConnectionAvailable('primary', {
    affectsRuntime: true,
    redisUrl: config.redisUrl,
  });
});

redisClient.on('error', (err: any) => {
  markRedisConnectionUnavailable('primary', err, {
    affectsRuntime: true,
    redisUrl: config.redisUrl,
  });
});

redisClient.on('end', () => {
  markRedisConnectionUnavailable('primary', undefined, {
    affectsRuntime: true,
    redisUrl: config.redisUrl,
  });
});

export { redisClient, connectRedis, isRedisAvailable, getRedisTarget };
