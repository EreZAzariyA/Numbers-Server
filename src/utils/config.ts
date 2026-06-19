require('dotenv').config();
import { name, version } from '../../package.json';
import Logger from 'bunyan';
import { ENV_TYPE, getLogger, getLogLevel } from './helpers';

type RateLimitSettings = {
  windowMs: number;
  max: number;
};

type RateLimitConfig = {
  global: RateLimitSettings;
  auth: RateLimitSettings;
  bankScraping: RateLimitSettings;
};

type BankScraperConfig = {
  lookbackMonths: number;
  defaultTimeoutMs: number;
  headless: boolean;
};

type WorkerConfig = {
  nightlyRefreshEnabled: boolean;
  nightlyRefreshCron: string;
  scrapingConcurrency: number;
  transactionImportConcurrency: number;
  patternRecomputeConcurrency: number;
};

type QueueConfig = {
  removeOnCompleteAgeSeconds: number;
  removeOnFailAgeSeconds: number;
  nightlyRemoveOnCompleteAgeSeconds: number;
  nightlyRemoveOnFailAgeSeconds: number;
  patternRecomputeDebounceMs: number;
};

type RuntimeDefaults = {
  rateLimits: RateLimitConfig;
  bankScraper: BankScraperConfig;
  workers: WorkerConfig;
  queue: QueueConfig;
};

const getEnvNumber = (key: string, fallback: number, min = 0): number => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    return fallback;
  }

  return Math.floor(value);
};

const getEnvBoolean = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (['true', '1', 'yes', 'on'].includes(raw)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(raw)) {
    return false;
  }

  return fallback;
};

const getEnvString = (key: string, fallback: string): string => {
  const raw = process.env[key]?.trim();
  return raw || fallback;
};

const getRuntimeConfig = (defaults: RuntimeDefaults): RuntimeDefaults => ({
  rateLimits: {
    global: {
      windowMs: getEnvNumber('RATE_LIMIT_GLOBAL_WINDOW_MS', defaults.rateLimits.global.windowMs, 1),
      max: getEnvNumber('RATE_LIMIT_GLOBAL_MAX', defaults.rateLimits.global.max, 1),
    },
    auth: {
      windowMs: getEnvNumber('RATE_LIMIT_AUTH_WINDOW_MS', defaults.rateLimits.auth.windowMs, 1),
      max: getEnvNumber('RATE_LIMIT_AUTH_MAX', defaults.rateLimits.auth.max, 1),
    },
    bankScraping: {
      windowMs: getEnvNumber('RATE_LIMIT_BANK_WINDOW_MS', defaults.rateLimits.bankScraping.windowMs, 1),
      max: getEnvNumber('RATE_LIMIT_BANK_MAX', defaults.rateLimits.bankScraping.max, 1),
    },
  },
  bankScraper: {
    lookbackMonths: getEnvNumber('BANK_SCRAPER_LOOKBACK_MONTHS', defaults.bankScraper.lookbackMonths, 1),
    defaultTimeoutMs: getEnvNumber('BANK_SCRAPER_TIMEOUT_MS', defaults.bankScraper.defaultTimeoutMs, 1),
    headless: getEnvBoolean('BANK_SCRAPER_HEADLESS', defaults.bankScraper.headless),
  },
  workers: {
    nightlyRefreshEnabled: getEnvBoolean('ENABLE_NIGHTLY_REFRESH', defaults.workers.nightlyRefreshEnabled),
    nightlyRefreshCron: getEnvString('NIGHTLY_REFRESH_CRON', defaults.workers.nightlyRefreshCron),
    scrapingConcurrency: getEnvNumber('SCRAPING_WORKER_CONCURRENCY', defaults.workers.scrapingConcurrency, 1),
    transactionImportConcurrency: getEnvNumber('TRANSACTION_IMPORT_WORKER_CONCURRENCY', defaults.workers.transactionImportConcurrency, 1),
    patternRecomputeConcurrency: getEnvNumber('PATTERN_RECOMPUTE_WORKER_CONCURRENCY', defaults.workers.patternRecomputeConcurrency, 1),
  },
  queue: {
    removeOnCompleteAgeSeconds: getEnvNumber('QUEUE_REMOVE_ON_COMPLETE_AGE_SECONDS', defaults.queue.removeOnCompleteAgeSeconds, 1),
    removeOnFailAgeSeconds: getEnvNumber('QUEUE_REMOVE_ON_FAIL_AGE_SECONDS', defaults.queue.removeOnFailAgeSeconds, 1),
    nightlyRemoveOnCompleteAgeSeconds: getEnvNumber('NIGHTLY_QUEUE_REMOVE_ON_COMPLETE_AGE_SECONDS', defaults.queue.nightlyRemoveOnCompleteAgeSeconds, 1),
    nightlyRemoveOnFailAgeSeconds: getEnvNumber('NIGHTLY_QUEUE_REMOVE_ON_FAIL_AGE_SECONDS', defaults.queue.nightlyRemoveOnFailAgeSeconds, 1),
    patternRecomputeDebounceMs: getEnvNumber('PATTERN_RECOMPUTE_DEBOUNCE_MS', defaults.queue.patternRecomputeDebounceMs, 0),
  },
});

const DEVELOPMENT_RUNTIME_DEFAULTS: RuntimeDefaults = {
  rateLimits: {
    global: { windowMs: 60 * 1000, max: 1000 },
    auth: { windowMs: 15 * 60 * 1000, max: 100 },
    bankScraping: { windowMs: 60 * 60 * 1000, max: 100 },
  },
  bankScraper: {
    lookbackMonths: 12,
    defaultTimeoutMs: 2 * 60 * 1000,
    headless: true,
  },
  workers: {
    nightlyRefreshEnabled: false,
    nightlyRefreshCron: '0 2 * * *',
    scrapingConcurrency: 1,
    transactionImportConcurrency: 1,
    patternRecomputeConcurrency: 1,
  },
  queue: {
    removeOnCompleteAgeSeconds: 3600,
    removeOnFailAgeSeconds: 86400,
    nightlyRemoveOnCompleteAgeSeconds: 86400,
    nightlyRemoveOnFailAgeSeconds: 86400 * 7,
    patternRecomputeDebounceMs: 5000,
  },
};

const PRODUCTION_RUNTIME_DEFAULTS: RuntimeDefaults = {
  rateLimits: {
    global: { windowMs: 60 * 1000, max: 100 },
    auth: { windowMs: 15 * 60 * 1000, max: 10 },
    bankScraping: { windowMs: 60 * 60 * 1000, max: 10 },
  },
  bankScraper: {
    lookbackMonths: 12,
    defaultTimeoutMs: 60 * 1000,
    headless: true,
  },
  workers: {
    nightlyRefreshEnabled: true,
    nightlyRefreshCron: '0 2 * * *',
    scrapingConcurrency: 2,
    transactionImportConcurrency: 3,
    patternRecomputeConcurrency: 2,
  },
  queue: {
    removeOnCompleteAgeSeconds: 3600,
    removeOnFailAgeSeconds: 86400,
    nightlyRemoveOnCompleteAgeSeconds: 86400,
    nightlyRemoveOnFailAgeSeconds: 86400 * 7,
    patternRecomputeDebounceMs: 5000,
  },
};

abstract class Config {
  public port: number = +process.env.PORT;
  public isProduction: boolean;
  public loginExpiresIn: number;
  public refreshTokenExpiresIn: number;
  public mongoConnectionString: string;
  public redisUrl: string;
  public secretKey: string;
  public googleClientId: string;
  public corsUrls: string[];
  public log: Logger;
  public enablePatternPersistence: boolean;
  public rateLimits: RateLimitConfig;
  public bankScraper: BankScraperConfig;
  public workers: WorkerConfig;
  public queue: QueueConfig;
};

class DevelopmentConfig extends Config {
  public constructor() {
    super();
    this.isProduction = false;
    this.loginExpiresIn = 30 * 60 * 60;
    this.refreshTokenExpiresIn = 7 * 24 * 60 * 60; // 7 days — outlives the 30h access token
    this.mongoConnectionString = "mongodb://127.0.0.1:27017/numbers";
    this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.corsUrls = ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://localhost:8080'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.DEVELOPMENT));
    this.secretKey = 'secret';
    this.googleClientId = process.env.GOOGLE_CLIENT_ID;
    this.enablePatternPersistence = process.env.ENABLE_PATTERN_PERSISTENCE === 'true';
    const runtime = getRuntimeConfig(DEVELOPMENT_RUNTIME_DEFAULTS);
    this.rateLimits = runtime.rateLimits;
    this.bankScraper = runtime.bankScraper;
    this.workers = runtime.workers;
    this.queue = runtime.queue;
  };
};

class ProductionConfig extends Config {
  public constructor() {
    super();
    this.isProduction = true;
    this.loginExpiresIn = 15 * 60;
    this.refreshTokenExpiresIn = 7 * 24 * 60 * 60;
    this.mongoConnectionString = process.env.MONGO_CONNECTION_STRING;
    this.redisUrl = process.env.REDIS_URL;
    this.corsUrls = ['http://localhost:3000', 'http://localhost:8080', 'https://ea-numbers.vercel.app', 'https://ea-numbers-test.vercel.app'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.PRODUCTION));
    this.secretKey = process.env.SECRET_KEY;
    this.googleClientId = process.env.GOOGLE_CLIENT_ID;
    this.enablePatternPersistence = process.env.ENABLE_PATTERN_PERSISTENCE === 'true';
    const runtime = getRuntimeConfig(PRODUCTION_RUNTIME_DEFAULTS);
    this.rateLimits = runtime.rateLimits;
    this.bankScraper = runtime.bankScraper;
    this.workers = runtime.workers;
    this.queue = runtime.queue;
  };
};

const config = process.env.NODE_ENV === "production" ? new ProductionConfig() : new DevelopmentConfig();
export default config;
