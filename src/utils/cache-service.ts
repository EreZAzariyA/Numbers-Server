import { redisClient, isRedisAvailable } from './connectRedis';
import { logRedisFeatureMode, logRedisOperationFailure } from './redis-runtime';

class CacheService {
  get isConnected(): boolean {
    return isRedisAvailable();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      logRedisFeatureMode('cache', this.isConnected, {
        availableMessage: 'Redis cache is available again; cache operations resumed.',
        unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
      });
      if (!this.isConnected) return null;
      const data = await redisClient.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err: any) {
      logRedisOperationFailure('cache', 'get', err, { key });
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    try {
      logRedisFeatureMode('cache', this.isConnected, {
        availableMessage: 'Redis cache is available again; cache operations resumed.',
        unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
      });
      if (!this.isConnected) return;
      await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (err: any) {
      logRedisOperationFailure('cache', 'set', err, { key });
    }
  }

  async del(key: string): Promise<void> {
    try {
      logRedisFeatureMode('cache', this.isConnected, {
        availableMessage: 'Redis cache is available again; cache operations resumed.',
        unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
      });
      if (!this.isConnected) return;
      await redisClient.del(key);
    } catch (err: any) {
      logRedisOperationFailure('cache', 'del', err, { key });
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
      logRedisFeatureMode('cache', this.isConnected, {
        availableMessage: 'Redis cache is available again; cache operations resumed.',
        unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
      });
      if (!this.isConnected) return;
      let cursor = 0;
      do {
        const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await redisClient.del(result.keys);
        }
      } while (cursor !== 0);
    } catch (err: any) {
      logRedisOperationFailure('cache', 'delByPattern', err, { pattern });
    }
  }
}

const cacheService = new CacheService();
export default cacheService;
