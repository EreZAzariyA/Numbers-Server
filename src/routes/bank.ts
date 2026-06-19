import express, { NextFunction, Request, Response } from "express";
import bankLogic from "../bll/banks";
import { bankScrapingLimiter } from "../middlewares";
import { getScrapingQueue, getTransactionImportQueue } from "../queues";
import { isRedisAvailable } from "../utils/connectRedis";
import { createRedisQueueUnavailableError } from "../utils/redis-runtime";
import { decryptBankCredentials } from "../utils/bank-credentials";
import { ScrapingJobData } from "../workers/scraping-worker";
import { requireMatchingUserParam } from "../middlewares/require-user";

const router = express.Router();
router.param('user_id', requireMatchingUserParam);

const ensureQueueingAvailable = (feature: string): void => {
  if (!isRedisAvailable()) {
    throw createRedisQueueUnavailableError(feature);
  }
};

router.get('/fetch-user-banks-accounts/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const banks = await bankLogic.fetchMainAccountResponse(user_id);
    return res.status(200).json(banks);
  } catch (err: any) {
    next(err);
  }
});

router.get('/fetch-bank-account/:user_id/:bank_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, bank_id } = req.params;
    const bank = await bankLogic.fetchOneBankAccount(user_id, bank_id);
    return res.status(200).json(bank);
  } catch (err: any) {
    next(err);
  }
});

router.post('/connect-bank/:user_id', bankScrapingLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    ensureQueueingAvailable('bank-sync');
    const user_id = req.params.user_id;
    const details = req.body;
    const jobData: ScrapingJobData = {
      user_id,
      companyId: details.companyId,
      credentials: details,
      isRefresh: false,
    };
    const job = await getScrapingQueue().add('connect-bank', jobData);
    res.status(202).json({ jobId: job.id });
  } catch (err: any) {
    next(err);
  }
});

router.post('/import-transactions/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    ensureQueueingAvailable('transaction-import');
    const user_id = req.params.user_id;
    const { transactions, companyId } = req.body;
    const job = await getTransactionImportQueue().add('import-transactions', {
      user_id,
      transactions,
      companyId,
    });
    res.status(202).json({ jobId: job.id });
  } catch (err: any) {
    next(err);
  }
});

router.put('/refresh-bank-data/:user_id', bankScrapingLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    ensureQueueingAvailable('bank-refresh');
    const user_id = req.params.user_id;
    const bank_id = req.body.bank_id;

    const bankAccount = await bankLogic.fetchOneBankAccount(user_id, bank_id);
    if (!bankAccount?.credentials) {
      return res.status(400).json({ message: 'Bank credentials not found' });
    }

    const decodedCredentials = decryptBankCredentials(bankAccount.credentials);
    if (!decodedCredentials) {
      return res.status(400).json({ message: 'Bank credentials not found' });
    }
    const credentials = {
      companyId: decodedCredentials.companyId,
      id: decodedCredentials.id,
      password: decodedCredentials.password,
      num: decodedCredentials.num,
      save: decodedCredentials.save,
      username: decodedCredentials.username,
    };

    const jobData: ScrapingJobData = {
      user_id,
      bank_id,
      companyId: credentials.companyId,
      credentials,
      isRefresh: true,
    };
    const job = await getScrapingQueue().add('refresh-bank', jobData);
    res.status(202).json({ jobId: job.id });
  } catch (err: any) {
    next(err);
  }
});

router.put('/update-bank-details/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { bank_id, newCredentials } = req.body;
    const response = await bankLogic.updateBankAccountDetails(bank_id, user_id, newCredentials);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

router.post('/set-main-account/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const bank_id = req.body.bank_id;
    await bankLogic.setMainBankAccount(user_id, bank_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

router.delete('/remove-bank/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const bank_id = req.body.bank_id;
    await bankLogic.removeBankAccount(user_id, bank_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;
