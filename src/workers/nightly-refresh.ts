import { Worker, Job, Queue } from 'bullmq';
import { redisConnection, scrapingQueue, enqueuePatternRecompute } from '../queues';
import { Accounts } from '../collections';
import jwt from '../utils/jwt';
import { ScrapingJobData } from './scraping-worker';
import config from '../utils/config';

const nightlyQueue = new Queue('nightly-refresh', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 86400 * 7 },
  },
});

const processNightlyRefresh = async (_job: Job): Promise<void> => {
  config.log.info('Nightly bank refresh started');

  const accounts = await Accounts.find({ banks: { $exists: true, $ne: [] } }).lean().exec();

  let queued = 0;
  for (const account of accounts) {
    for (const bank of account.banks) {
      if (!bank.credentials) continue;

      try {
        const decoded = await jwt.fetchBankCredentialsFromToken(bank.credentials);
        if (!decoded) continue;

        const jobData: ScrapingJobData = {
          user_id: account.user_id.toString(),
          bank_id: bank._id?.toString(),
          companyId: decoded.companyId,
          credentials: {
            companyId: decoded.companyId,
            id: decoded.id,
            password: decoded.password,
            num: decoded.num,
            save: decoded.save,
            username: decoded.username,
          },
          isRefresh: true,
        };

        await scrapingQueue.add('nightly-refresh', jobData);
        queued++;
      } catch (err: any) {
        config.log.error(
          { user_id: account.user_id, bank_id: bank._id },
          `Failed to queue nightly refresh for bank: ${err.message}`
        );
      }
    }
  }

  config.log.info(`Nightly refresh queued ${queued} bank scraping jobs`);

  // Trigger pattern recompute for each user after nightly bank import.
  if (config.enablePatternPersistence) {
    for (const account of accounts) {
      try {
        await enqueuePatternRecompute(account.user_id.toString());
      } catch (err: any) {
        config.log.warn({ user_id: account.user_id }, `Failed to enqueue nightly pattern recompute: ${err.message}`);
      }
    }
    config.log.info(`Nightly pattern recompute enqueued for ${accounts.length} users`);
  }
};

export const scheduleNightlyRefresh = async (): Promise<Worker> => {
  // Remove stale repeatable jobs from previous startups (idempotent)
  const repeatableJobs = await nightlyQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await nightlyQueue.removeRepeatableByKey(job.key);
  }

  await nightlyQueue.add('nightly-refresh-trigger', {}, {
    repeat: { pattern: '0 2 * * *' },
  });

  const worker = new Worker('nightly-refresh', processNightlyRefresh, {
    connection: redisConnection,
    concurrency: 1,
  });

  worker.on('completed', () => {
    config.log.info('Nightly bank refresh job completed');
  });

  worker.on('failed', (_job, err) => {
    config.log.error(`Nightly refresh job failed: ${err.message}`);
  });

  config.log.info('Nightly bank refresh scheduled (daily at 02:00)');
  return worker;
};
