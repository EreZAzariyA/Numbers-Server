import { createClient } from 'redis';
import config from './config';

const redisClient = createClient({
  url: config.redisUrl,
});

const connectRedis = async (): Promise<boolean> => {
  try {
    await redisClient.connect();
    config.log.info('Redis client connected...');
    return true;
  } catch (err: any) {
    config.log.warn(`Redis connection failed: ${err.message}. Caching will be disabled.`);
    return false;
  }
};

const isRedisAvailable = (): boolean => redisClient.isReady;

redisClient.on('error', (err: any) => {
  config.log.warn({ err: err.message }, 'Redis client error');
});

export { redisClient, connectRedis, isRedisAvailable };
