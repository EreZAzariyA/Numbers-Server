import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues';
import { getBankData, insertBankAccount } from '../utils/bank-utils';
import { UserBankCredentials, isArrayAndNotEmpty, getFutureDebitDate } from '../utils/helpers';
import bankLogic from '../bll/banks';
import { categoriesLogic } from '../bll';
import { socketIo } from '../dal/socket';

export interface ScrapingJobData {
  user_id: string;
  bank_id?: string;
  companyId: string;
  credentials: UserBankCredentials;
  isRefresh: boolean;
}

export interface ScrapingJobResult {
  bank: any;
  account: any;
  importedTransactions?: any[];
}

const processScrapingJob = async (job: Job<ScrapingJobData>): Promise<ScrapingJobResult> => {
  const { user_id, bank_id, credentials, isRefresh } = job.data;

  socketIo.emitToUser(user_id, 'scraping:started', { jobId: job.id, bankName: credentials.companyId });
  await job.updateProgress({ stage: 'scraping', message: 'Connecting to bank...' });

  const scrapeResult = await getBankData(credentials);
  if (scrapeResult.errorType || scrapeResult.errorMessage) {
    socketIo.emitToUser(user_id, 'scraping:failed', { jobId: job.id, error: scrapeResult.errorMessage });
    throw new Error(`Scraper error: ${scrapeResult.errorMessage}`);
  }

  const account = scrapeResult.accounts?.[0];
  if (!account) {
    throw new Error('No account data returned from bank scraper');
  }
  socketIo.emitToUser(user_id, 'scraping:progress', { jobId: job.id, stage: 'processing', percent: 50 });
  await job.updateProgress({ stage: 'processing', message: 'Processing bank data...' });

  if (!isRefresh) {
    const defCategory = await categoriesLogic.fetchUserCategory(user_id, 'Others');
    if (!defCategory) {
      await categoriesLogic.addNewCategory('Others', user_id);
    }
  }

  let insertedTransactions = [];

  socketIo.emitToUser(user_id, 'scraping:progress', { jobId: job.id, stage: 'saving', percent: 90 });
  await job.updateProgress({ stage: 'saving', message: 'Saving bank data...' });

  if (isRefresh) {
    if (account?.txns && isArrayAndNotEmpty(account.txns)) {
      const transactions = await bankLogic.importTransactions(account.txns, user_id, credentials.companyId);
      insertedTransactions = [...insertedTransactions, ...transactions];
      socketIo.emitToUser(user_id, 'scraping:progress', {
        jobId: job.id, stage: 'saving', percent: 90, importedCount: insertedTransactions.length
      });
    }

    if (account?.cardsPastOrFutureDebit && isArrayAndNotEmpty(account.cardsPastOrFutureDebit?.cardsBlock)) {
      const promises = account.cardsPastOrFutureDebit.cardsBlock
        .filter((card: any) => isArrayAndNotEmpty(card.txns))
        .map(async (card: any) => {
          if (card.cardStatusCode && card.cardStatusCode === 9) return;
          const cardTransactions = await bankLogic.importTransactions(card.txns, user_id, credentials.companyId);
          insertedTransactions = [...insertedTransactions, ...cardTransactions];
        });
      await Promise.all(promises);
      socketIo.emitToUser(user_id, 'scraping:progress', {
        jobId: job.id, stage: 'saving', percent: 90, importedCount: insertedTransactions.length
      });
    }

    if (account?.pastOrFutureDebits && isArrayAndNotEmpty(account?.pastOrFutureDebits) && bank_id) {
      const updatedPastOrFutureDebits = await bankLogic.importPastOrFutureDebits(
        user_id, bank_id, account.pastOrFutureDebits
      );
      updatedPastOrFutureDebits.sort((a: any, b: any) => (getFutureDebitDate(a.debitMonth) - getFutureDebitDate(b.debitMonth)));
      account.pastOrFutureDebits = updatedPastOrFutureDebits;
    }
  }

  const bank = await insertBankAccount(user_id, credentials, account);

  const result = {
    bank,
    account,
    importedTransactions: insertedTransactions,
  };

  socketIo.emitToUser(user_id, 'scraping:complete', {
    jobId: job.id,
    bank,
    account,
    importedTransactions: insertedTransactions.length,
  });

  return result;
};

export const startScrapingWorker = () => {
  const worker = new Worker('bank-scraping', processScrapingJob, {
    connection: redisConnection,
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    console.info(`Scraping job ${job.id} completed for user ${job.data.user_id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Scraping job ${job?.id} failed: ${err.message}`);
    if (job?.data?.user_id) {
      socketIo.emitToUser(job.data.user_id, 'scraping:failed', { jobId: job.id, error: err.message });
    }
  });

  return worker;
};
