import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import config from '../utils/config';

const redisUrl = new URL(config.redisUrl || 'redis://localhost:6379');
export const redisConnection = new IORedis({
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port) || 6379,
  maxRetriesPerRequest: null,
});

const defaultOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
};

export const scrapingQueue = new Queue('bank-scraping', defaultOptions);
export const transactionImportQueue = new Queue('transaction-import', defaultOptions);
export const patternRecomputeQueue = new Queue('pattern-recompute', defaultOptions);

/**
 * Debounced enqueue: uses a fixed job-id per user so that rapid writes
 * within 30s coalesce into a single recompute.
 */
export const enqueuePatternRecompute = async (user_id: string): Promise<void> => {
  await patternRecomputeQueue.add(
    'recompute-patterns',
    { user_id },
    {
      jobId: `recompute-${user_id}`,
      delay: 5000, // 5s debounce — absorb rapid successive writes
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    },
  );
};
