import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../queues';
import { recomputePatterns } from '../bll/recurring/pattern-service';
import cacheService from '../utils/cache-service';
import { socketIo } from '../dal/socket';
import config from '../utils/config';

interface PatternRecomputeJobData {
  user_id: string;
}

const processPatternRecompute = async (job: Job<PatternRecomputeJobData>): Promise<void> => {
  const { user_id } = job.data;
  config.log.info({ user_id, jobId: job.id }, 'Pattern recompute started');

  await recomputePatterns(user_id);

  // Invalidate caches that depend on patterns.
  await Promise.all([
    cacheService.del(`cashFlow:${user_id}`),
    cacheService.del(`patterns:${user_id}`),
  ]);

  // Notify connected FE clients so they can refetch.
  socketIo.emitToUser(user_id, 'patterns:updated', { updatedAt: new Date().toISOString() });

  config.log.info({ user_id, jobId: job.id }, 'Pattern recompute completed');
};

export const startPatternRecomputeWorker = () => {
  const worker = new Worker('pattern-recompute', processPatternRecompute, {
    connection: getRedisConnection(),
    concurrency: config.workers.patternRecomputeConcurrency,
  });

  worker.on('completed', (job) => {
    config.log.info(`Pattern recompute job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    config.log.error(`Pattern recompute job ${job?.id} failed: ${err.message}`);
  });

  return worker;
};
