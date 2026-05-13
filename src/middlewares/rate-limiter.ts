import { RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { isRedisAvailable, redisClient } from '../utils/connectRedis';
import { logRedisFeatureMode, logRedisOperationFailure } from '../utils/redis-runtime';

type LimiterOptions = Parameters<typeof rateLimit>[0];
type AdaptiveLimiterState = {
  redisPrefix: string;
  modeKey: string;
  options: LimiterOptions;
  memoryLimiter: RequestHandler;
  redisLimiter: RequestHandler | null;
};

const adaptiveLimiters: AdaptiveLimiterState[] = [];

const createRedisStore = (prefix: string) => new RedisStore({
  sendCommand: (...args: string[]) => redisClient.sendCommand(args),
  prefix,
});

const buildRedisLimiter = (state: AdaptiveLimiterState): void => {
  if (state.redisLimiter || !isRedisAvailable()) {
    return;
  }

  try {
    state.redisLimiter = rateLimit({
      ...state.options,
      store: createRedisStore(state.redisPrefix),
      passOnStoreError: true,
    });
  } catch (err: any) {
    logRedisOperationFailure('rate-limit', 'create-store', err, { redisPrefix: state.redisPrefix });
  }
};

export const initializeRedisBackedRateLimiters = (): void => {
  adaptiveLimiters.forEach((state) => buildRedisLimiter(state));
};

const createAdaptiveLimiter = (
  redisPrefix: string,
  modeKey: string,
  options: LimiterOptions,
): RequestHandler => {
  const state: AdaptiveLimiterState = {
    redisPrefix,
    modeKey,
    options,
    memoryLimiter: rateLimit(options),
    redisLimiter: null,
  };

  adaptiveLimiters.push(state);

  return (req, res, next) => {
    const redisAvailable = isRedisAvailable();

    logRedisFeatureMode(modeKey, redisAvailable, {
      availableMessage: 'Redis-backed distributed rate limiting is available again.',
      unavailableMessage: 'Redis-backed rate limiting is unavailable; falling back to local in-memory limits on this server.',
      unavailableLevel: 'warn',
    });

    const limiter = redisAvailable ? (state.redisLimiter ?? state.memoryLimiter) : state.memoryLimiter;
    return limiter(req, res, next);
  };
};

export const globalLimiter = createAdaptiveLimiter('rl:global:', 'rate-limit', {
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

export const authLimiter = createAdaptiveLimiter('rl:auth:', 'rate-limit', {
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts, please try again later.' },
});

export const bankScrapingLimiter = createAdaptiveLimiter('rl:bank:', 'rate-limit', {
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.params.user_id || ipKeyGenerator(req.ip ?? ''),
  message: { message: 'Too many bank scraping requests, please try again later.' },
});

redisClient.on('ready', initializeRedisBackedRateLimiters);
