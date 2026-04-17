import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../utils/connectRedis';

const createRedisStore = (prefix: string) => {
  if (!redisClient.isOpen) return undefined;
  return new RedisStore({
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    prefix,
  });
};

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('rl:global:'),
  message: { message: 'Too many requests, please try again later.' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('rl:auth:'),
  message: { message: 'Too many login attempts, please try again later.' },
});

export const bankScrapingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.params.user_id || ipKeyGenerator(req.ip ?? ''),
  store: createRedisStore('rl:bank:'),
  message: { message: 'Too many bank scraping requests, please try again later.' },
});
