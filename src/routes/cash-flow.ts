import express, { NextFunction, Request, Response } from 'express';
import { calculateCashFlowProjection } from '../bll/cash-flow-projection';

const router = express.Router();

router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const result = await calculateCashFlowProjection(user_id);
    res.status(200).json(result);
  } catch (err: any) {
    next(err);
  }
});

export default router;
