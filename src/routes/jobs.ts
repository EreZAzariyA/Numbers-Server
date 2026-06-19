import express, { NextFunction, Request, Response } from 'express';
import { getScrapingQueue, getTransactionImportQueue } from '../queues';
import { isRedisAvailable } from '../utils/connectRedis';
import { createRedisQueueUnavailableError } from '../utils/redis-runtime';

const router = express.Router();

router.get('/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isRedisAvailable()) {
      throw createRedisQueueUnavailableError('job-status');
    }

    const { jobId } = req.params;
    const { queue: queueName } = req.query;

    const queue = queueName === 'transaction-import' ? getTransactionImportQueue() : getScrapingQueue();
    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    const state = await job.getState();
    return res.status(200).json({
      id: job.id,
      state,
      progress: job.progress,
      result: job.returnvalue,
      failedReason: job.failedReason,
    });
  } catch (err: any) {
    next(err);
  }
});

export default router;
