require('dotenv').config();
import { name, version } from '../../package.json';
import Logger from 'bunyan';
import { ENV_TYPE, getEnvBoolean, getEnvNumber, getEnvString, getLogger, getLogLevel, requireEnv } from './helpers';
import type { BankScraperConfig, QueueConfig, RateLimitConfig, RuntimeDefaults, WorkerConfig } from './types';

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
    alertsGenerationEnabled: getEnvBoolean('ENABLE_ALERTS_GENERATION', defaults.workers.alertsGenerationEnabled),
    alertsGenerationCron: getEnvString('ALERTS_GENERATION_CRON', defaults.workers.alertsGenerationCron),
    proactiveAnalysisEnabled: getEnvBoolean('ENABLE_PROACTIVE_ANALYSIS', defaults.workers.proactiveAnalysisEnabled),
    proactiveAnalysisDailyCron: getEnvString('PROACTIVE_ANALYSIS_DAILY_CRON', defaults.workers.proactiveAnalysisDailyCron),
    proactiveAnalysisWeeklyCron: getEnvString('PROACTIVE_ANALYSIS_WEEKLY_CRON', defaults.workers.proactiveAnalysisWeeklyCron),
    proactiveAnalysisIncomeCron: getEnvString('PROACTIVE_ANALYSIS_INCOME_CRON', defaults.workers.proactiveAnalysisIncomeCron),
    proactiveAnalysisDigestCron: getEnvString('PROACTIVE_ANALYSIS_DIGEST_CRON', defaults.workers.proactiveAnalysisDigestCron),
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
    defaultTimeoutMs: 30 * 1000,
    headless: true,
  },
  workers: {
    nightlyRefreshEnabled: false,
    nightlyRefreshCron: '0 2 * * *',
    scrapingConcurrency: 1,
    transactionImportConcurrency: 1,
    patternRecomputeConcurrency: 1,
    alertsGenerationEnabled: false,
    alertsGenerationCron: '0 5 * * *',
    proactiveAnalysisEnabled: false,
    proactiveAnalysisDailyCron: '0 6 * * *',
    proactiveAnalysisWeeklyCron: '0 7 * * 1',
    proactiveAnalysisIncomeCron: '0 8 1 * *',
    proactiveAnalysisDigestCron: '0 8 * * *',
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
    auth: { windowMs: 15 * 60 * 1000, max: 5 },
    bankScraping: { windowMs: 60 * 60 * 1000, max: 5 },
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
    alertsGenerationEnabled: true,
    alertsGenerationCron: '0 5 * * *',
    proactiveAnalysisEnabled: true,
    proactiveAnalysisDailyCron: '0 6 * * *',
    proactiveAnalysisWeeklyCron: '0 7 * * 1',
    proactiveAnalysisIncomeCron: '0 8 1 * *',
    proactiveAnalysisDigestCron: '0 8 * * *',
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
  public port: number;
  public isProduction: boolean;
  public loginExpiresIn: number;
  public refreshTokenExpiresIn: number;
  public mongoConnectionString: string;
  public redisUrl: string;
  public qdrantUrl: string;
  public secretKey: string;
  public googleClientId: string;
  public corsUrls: string[];
  public log: Logger;
  public enablePatternPersistence: boolean;
  public rateLimits: RateLimitConfig;
  public bankScraper: BankScraperConfig;
  public workers: WorkerConfig;
  public queue: QueueConfig;

  public constructor() {
    this.port = getEnvNumber('PORT', 5000, 1);
    this.refreshTokenExpiresIn = 7 * 24 * 60 * 60;
    this.mongoConnectionString = requireEnv('MONGO_CONNECTION_STRING');
    this.redisUrl = requireEnv('REDIS_URL');
    this.qdrantUrl = requireEnv('QDRANT_URL');
    this.secretKey = requireEnv('SECRET_KEY');
    this.googleClientId = requireEnv('GOOGLE_CLIENT_ID');
    this.enablePatternPersistence = process.env.ENABLE_PATTERN_PERSISTENCE === 'true';
  }
};

class DevelopmentConfig extends Config {
  public constructor() {
    super();
    this.isProduction = false;
    this.loginExpiresIn = 30 * 60 * 60;
    this.corsUrls = ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://localhost:8080'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.DEVELOPMENT));
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
    this.corsUrls = ['http://localhost:3000', 'http://localhost:8080', 'https://ea-numbers.erezdev.com', 'https://ea-numbers.test.erezdev.com'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.PRODUCTION));
    const runtime = getRuntimeConfig(PRODUCTION_RUNTIME_DEFAULTS);
    this.rateLimits = runtime.rateLimits;
    this.bankScraper = runtime.bankScraper;
    this.workers = runtime.workers;
    this.queue = runtime.queue;
  };
};

const config = process.env.NODE_ENV === "production" ? new ProductionConfig() : new DevelopmentConfig();
export default config;
