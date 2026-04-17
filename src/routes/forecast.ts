import express, { NextFunction, Request, Response } from 'express';
import { calculateForecast } from '../bll/forecast';

const router = express.Router();

router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const language = (req.query.language as string) || 'en';
    const forecast = await calculateForecast(user_id, language);
    res.status(200).json(forecast);
  } catch (err: any) {
    next(err);
  }
});

export default router;
