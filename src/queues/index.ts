import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import config from '../utils/config';
import {
  markRedisConnectionAvailable,
  markRedisConnectionUnavailable,
} from '../utils/redis-runtime';

let redisConnection: IORedis | null = null;
let scrapingQueue: Queue | null = null;
let transactionImportQueue: Queue | null = null;
let patternRecomputeQueue: Queue | null = null;

const createQueue = (name: string): Queue => {
  const defaultOptions: QueueOptions = {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: { age: config.queue.removeOnCompleteAgeSeconds },
      removeOnFail: { age: config.queue.removeOnFailAgeSeconds },
    },
  };

  return new Queue(name, defaultOptions);
};

export const getRedisConnection = (): IORedis => {
  if (!redisConnection) {
    redisConnection = new IORedis(config.redisUrl || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    redisConnection.on('ready', () => {
      markRedisConnectionAvailable('bullmq', { redisUrl: config.redisUrl });
    });

    redisConnection.on('error', (err: any) => {
      markRedisConnectionUnavailable('bullmq', err, { redisUrl: config.redisUrl });
    });

    redisConnection.on('close', () => {
      markRedisConnectionUnavailable('bullmq', undefined, { redisUrl: config.redisUrl });
    });
  }

  return redisConnection;
};

export const getScrapingQueue = (): Queue => {
  if (!scrapingQueue) {
    scrapingQueue = createQueue('bank-scraping');
  }

  return scrapingQueue;
};

export const getTransactionImportQueue = (): Queue => {
  if (!transactionImportQueue) {
    transactionImportQueue = createQueue('transaction-import');
  }

  return transactionImportQueue;
};

const getPatternRecomputeQueue = (): Queue => {
  if (!patternRecomputeQueue) {
    patternRecomputeQueue = createQueue('pattern-recompute');
  }

  return patternRecomputeQueue;
};

/**
 * Debounced enqueue: uses a fixed job-id per user so that rapid writes
 * coalesce into a single recompute.
 */
export const enqueuePatternRecompute = async (user_id: string): Promise<void> => {
  await getPatternRecomputeQueue().add(
    'recompute-patterns',
    { user_id },
    {
      jobId: `recompute-${user_id}`,
      delay: config.queue.patternRecomputeDebounceMs,
      removeOnComplete: { age: config.queue.removeOnCompleteAgeSeconds },
      removeOnFail: { age: config.queue.removeOnFailAgeSeconds },
    },
  );
};
