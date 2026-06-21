import { Worker, Job, Queue } from 'bullmq';
import { getRedisConnection } from '../queues';
import { Accounts } from '../collections';
import {
  runDailyExpenseReview,
  runWeeklySummary,
  runMonthEndRisk,
  runSubscriptionWatch,
  runIncomeDetection,
  runAnomalyDetection,
} from '../bll/analysis/proactive-analysis';
import { generateDashboardDigest } from '../bll/analysis/digest-generator';
import config from '../utils/config';

type ProactiveJobName = 'daily-batch' | 'weekly-batch' | 'income-check' | 'digest-generate';

let proactiveQueue: Queue | null = null;

const getProactiveQueue = (): Queue => {
  if (!proactiveQueue) {
    proactiveQueue = new Queue('proactive-analysis', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: config.queue.nightlyRemoveOnCompleteAgeSeconds },
        removeOnFail: { age: config.queue.nightlyRemoveOnFailAgeSeconds },
      },
    });
  }

  return proactiveQueue;
};

const safeRun = async (
  userId: string,
  label: string,
  fn: () => Promise<void>,
): Promise<boolean> => {
  try {
    await fn();
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    config.log.error({ user_id: userId }, `Proactive analysis [${label}] failed for user: ${message}`);
    return false;
  }
};

const processProactiveAnalysis = async (job: Job): Promise<void> => {
  const jobName = job.name as ProactiveJobName;
  config.log.info({ jobName }, 'Proactive analysis started');

  const accounts = await Accounts.find({ banks: { $exists: true, $ne: [] } }).lean().exec();

  let processed = 0;
  for (const account of accounts) {
    const userId = account.user_id.toString();

    if (jobName === 'daily-batch') {
      const results = await Promise.all([
        safeRun(userId, 'runDailyExpenseReview', () => runDailyExpenseReview(userId)),
        safeRun(userId, 'runAnomalyDetection', () => runAnomalyDetection(userId)),
        safeRun(userId, 'runSubscriptionWatch', () => runSubscriptionWatch(userId)),
      ]);
      if (results.every(Boolean)) {
        processed++;
      }
    } else if (jobName === 'weekly-batch') {
      const results = await Promise.all([
        safeRun(userId, 'runWeeklySummary', () => runWeeklySummary(userId)),
        safeRun(userId, 'runMonthEndRisk', () => runMonthEndRisk(userId)),
      ]);
      if (results.every(Boolean)) {
        processed++;
      }
    } else if (jobName === 'income-check') {
      const ok = await safeRun(userId, 'runIncomeDetection', () => runIncomeDetection(userId));
      if (ok) {
        processed++;
      }
    } else if (jobName === 'digest-generate') {
      const ok = await safeRun(userId, 'generateDashboardDigest', () =>
        generateDashboardDigest(userId, 'en'),
      );
      if (ok) {
        processed++;
      }
    }
  }

  config.log.info({ jobName, processed }, `Proactive analysis completed for ${processed} users`);
};

export const scheduleProactiveAnalysis = async (): Promise<Worker> => {
  const queue = getProactiveQueue();

  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add('daily-batch', {}, { repeat: { pattern: config.workers.proactiveAnalysisDailyCron } });
  await queue.add('weekly-batch', {}, { repeat: { pattern: config.workers.proactiveAnalysisWeeklyCron } });
  await queue.add('income-check', {}, { repeat: { pattern: config.workers.proactiveAnalysisIncomeCron } });
  await queue.add('digest-generate', {}, { repeat: { pattern: config.workers.proactiveAnalysisDigestCron } });

  const worker = new Worker('proactive-analysis', processProactiveAnalysis, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on('failed', (_job, err) => {
    config.log.error(`Proactive analysis job failed: ${err.message}`);
  });

  config.log.info({
    dailyCron: config.workers.proactiveAnalysisDailyCron,
    weeklyCron: config.workers.proactiveAnalysisWeeklyCron,
    incomeCron: config.workers.proactiveAnalysisIncomeCron,
    digestCron: config.workers.proactiveAnalysisDigestCron,
  }, 'Proactive analysis scheduled');

  return worker;
};
