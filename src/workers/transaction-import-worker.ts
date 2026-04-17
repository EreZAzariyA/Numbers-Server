import { Worker, Job } from 'bullmq';
import { Transaction } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { redisConnection } from '../queues';
import bankLogic from '../bll/banks';
import { socketIo } from '../dal/socket';

export interface TransactionImportJobData {
  user_id: string;
  transactions: Transaction[];
  companyId: string;
}

const processTransactionImport = async (job: Job<TransactionImportJobData>) => {
  const { transactions, user_id, companyId } = job.data;

  socketIo.emitToUser(user_id, 'import:progress', {
    jobId: job.id,
    stage: 'importing',
    total: transactions.length,
  });
  await job.updateProgress({ stage: 'importing', message: `Importing ${transactions.length} transactions...` });

  const result = await bankLogic.importTransactions(transactions, user_id, companyId);

  await job.updateProgress({ stage: 'complete', message: `Imported ${result.length} transactions` });

  socketIo.emitToUser(user_id, 'import:complete', {
    jobId: job.id,
    importedCount: result.length,
  });

  return { importedCount: result.length, transactions: result };
};

export const startTransactionImportWorker = () => {
  const worker = new Worker('transaction-import', processTransactionImport, {
    connection: redisConnection,
    concurrency: 3,
  });

  worker.on('completed', (job) => {
    console.info(`Transaction import job ${job.id} completed for user ${job.data.user_id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Transaction import job ${job?.id} failed: ${err.message}`);
    if (job?.data?.user_id) {
      socketIo.emitToUser(job.data.user_id, 'import:failed', { jobId: job.id, error: err.message });
    }
  });

  return worker;
};
