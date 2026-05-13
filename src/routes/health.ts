import express, { Request, Response } from 'express';
import { getLivenessSnapshot, getRuntimeSnapshot } from '../utils/runtime-status';

const router = express.Router();

router.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json(getLivenessSnapshot());
});

router.get('/readyz', (_req: Request, res: Response) => {
  const snapshot = getRuntimeSnapshot();
  res.status(snapshot.status === 'down' ? 503 : 200).json(snapshot);
});

export default router;
