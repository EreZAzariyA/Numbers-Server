import { Worker, Job, Queue } from 'bullmq';
import { getRedisConnection } from '../queues';
import { Accounts } from '../collections';
import { generateAlertsForUser } from '../bll/alert-generation';
import config from '../utils/config';

let alertsQueue: Queue | null = null;

const getAlertsQueue = (): Queue => {
  if (!alertsQueue) {
    alertsQueue = new Queue('alerts-generation', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: config.queue.nightlyRemoveOnCompleteAgeSeconds },
        removeOnFail: { age: config.queue.nightlyRemoveOnFailAgeSeconds },
      },
    });
  }

  return alertsQueue;
};

const processAlertsGeneration = async (_job: Job): Promise<void> => {
  config.log.info('Alert generation started');

  const accounts = await Accounts.find({ banks: { $exists: true, $ne: [] } }).lean().exec();

  let processed = 0;
  for (const account of accounts) {
    try {
      await generateAlertsForUser(account.user_id.toString());
      processed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      config.log.error({ user_id: account.user_id }, `Alert generation failed for user: ${message}`);
    }
  }

  config.log.info(`Alert generation completed for ${processed} users`);
};

export const scheduleAlertsGeneration = async (): Promise<Worker> => {
  const queue = getAlertsQueue();

  // Remove stale repeatable jobs from previous startups (idempotent).
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add('alerts-generation-trigger', {}, {
    repeat: { pattern: config.workers.alertsGenerationCron },
  });

  const worker = new Worker('alerts-generation', processAlertsGeneration, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on('failed', (_job, err) => {
    config.log.error(`Alert generation job failed: ${err.message}`);
  });

  config.log.info({ cron: config.workers.alertsGenerationCron }, 'Alert generation scheduled');
  return worker;
};
