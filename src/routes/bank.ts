import express, { NextFunction, Request, Response } from "express";
import bankLogic from "../bll/banks";

const router = express.Router();

router.get('/fetch-all-banks-accounts/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const banks = await bankLogic.fetchBanksAccounts(user_id);
    return res.status(200).json(banks);
  } catch (err: any) {
    next(err);
  }
});

router.get('/fetch-bank-account/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const bank_id = req.body.bank_id;
    const bank = await bankLogic.fetchOneBankAccount(user_id, bank_id);
    return res.status(200).json(bank);
  } catch (err: any) {
    next(err);
  }
});

router.post('/connect-bank/:user_id', async (req: Request, res: Response, next: NextFunction) => {
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
    const bank_id = req.body.bank_id;
    const response = await bankLogic.refreshBankData(bank_id, user_id);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

router.put('/update-bank-details/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { bankName, newCredentials } = req.body;
    const response = await bankLogic.updateBankAccountDetails(bankName, user_id, newCredentials);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

export default router;