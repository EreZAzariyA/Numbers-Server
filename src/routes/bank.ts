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

router.post('/import-transactions/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { transactions, companyId } = req.body;
    const response = await bankLogic.importTransactions(transactions, user_id, companyId);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

router.put('/refresh-bank-data/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { bankAccount_id } = req.body;
    const response = await bankLogic.refreshBankData(bankAccount_id, user_id);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

router.put('/update-bank-details/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { bankAccount_id, newCredentials } = req.body;
    const response = await bankLogic.updateBankAccountDetails(bankAccount_id, user_id, newCredentials);
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