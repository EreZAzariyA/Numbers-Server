import express, { NextFunction, Request, Response } from 'express';
import adminLogic from '../bll/admin';
import requireAdmin from '../middlewares/require-admin';
import { isRedisAvailable } from '../utils/connectRedis';
import { createRedisQueueUnavailableError } from '../utils/redis-runtime';

const router = express.Router();
router.use(requireAdmin);

const ensureQueueingAvailable = (feature: string): void => {
  if (!isRedisAvailable()) {
    throw createRedisQueueUnavailableError(feature);
  }
};

router.get('/users', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await adminLogic.listAllUsers();
    res.status(200).json(users);
  } catch (err: unknown) {
    next(err);
  }
});

router.post('/reindex', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    ensureQueueingAvailable('admin-reindex-all');
    const result = await adminLogic.reindexAllUsers();
    res.status(202).json(result);
  } catch (err: unknown) {
    next(err);
  }
});

router.post('/reindex/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    ensureQueueingAvailable('admin-reindex-user');
    const { user_id } = req.params;
    const result = await adminLogic.reindexUser(user_id);
    res.status(202).json(result);
  } catch (err: unknown) {
    next(err);
  }
});

export default router;
