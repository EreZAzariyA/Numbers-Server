import express, { NextFunction, Request, Response } from 'express';
import { calculateCashFlowProjection } from '../bll/cash-flow-projection';
import { compareSpendingPeriods } from '../bll/spending-comparison';
import { requireMatchingUserParam } from '../middlewares/require-user';

const router = express.Router();
router.param('user_id', requireMatchingUserParam);

router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const force = req.query.force === 'true';
    const result = await calculateCashFlowProjection(user_id, force);
    res.status(200).json(result);
  } catch (err: any) {
    next(err);
  }
});

/** GET /api/cash-flow/:user_id/comparison?force=true — this month vs last month spend. */
router.get('/:user_id/comparison', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const force = req.query.force === 'true';
    const result = await compareSpendingPeriods(user_id, force);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
