import { createClient } from 'redis';
import config from './config';
import {
  markRedisConnectionAvailable,
  markRedisConnectionUnavailable,
  getRedisTarget,
} from './redis-runtime';

const redisClient = createClient({
  url: config.redisUrl,
});

const connectRedis = async (): Promise<boolean> => {
  if (redisClient.isReady) {
    return true;
  }

  if (redisClient.isOpen && !redisClient.isReady) {
    return false;
  }

  try {
    await redisClient.connect();
    return redisClient.isReady;
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
