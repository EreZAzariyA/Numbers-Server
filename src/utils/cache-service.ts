import { redisClient } from './connectRedis';
import config from './config';

class CacheService {
  get isConnected(): boolean {
    return redisClient.isOpen;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (!this.isConnected) return null;
      const data = await redisClient.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err: any) {
      config.log.warn({ err: err.message }, `Cache get failed for key: ${key}`);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    try {
      if (!this.isConnected) return;
      await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (err: any) {
      config.log.warn({ err: err.message }, `Cache set failed for key: ${key}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (!this.isConnected) return;
      await redisClient.del(key);
    } catch (err: any) {
      config.log.warn({ err: err.message }, `Cache del failed for key: ${key}`);
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
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
      config.log.warn({ err: err.message }, `Cache delByPattern failed for: ${pattern}`);
    }
  }
}

const cacheService = new CacheService();
export default cacheService;
