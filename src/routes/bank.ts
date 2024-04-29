import express, { NextFunction, Request, Response } from "express";
import bankLogic from "../bll/bank-logic";

const router = express.Router();

router.post('/fetch-bank-data/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const details = req.body;
    const response = await bankLogic.fetchBankData(details, user_id);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

router.post('/import-data/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const transactions = req.body;
    const response = await bankLogic.importTransactions(transactions, user_id);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log({body: req.body});
    console.log({res});
  } catch (err: any) {
    next(err);
  }
});

export default router;