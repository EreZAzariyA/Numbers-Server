import { UserModel, IUserModel } from '../models/user-model';
import { Accounts } from '../collections';
import { getScrapingQueue, enqueuePatternRecompute } from '../queues';
import { decryptBankCredentials } from '../utils/bank-credentials';
import { ScrapingJobData } from '../workers/scraping-worker';
import config from '../utils/config';

export interface AdminUserSummary {
  _id: string;
  profile: IUserModel['profile'];
  emails: IUserModel['emails'];
  role: string;
  createdAt: Date;
}

class AdminLogic {
  listAllUsers = async (): Promise<AdminUserSummary[]> =>
    UserModel.find({}).select('-services').lean<AdminUserSummary[]>().exec();

  reindexUser = async (user_id: string): Promise<{ queued: number }> => {
    const account = await Accounts.findOne({ user_id }).lean().exec();
    if (!account) return { queued: 0 };

    const scrapingQueue = getScrapingQueue();
    let queued = 0;

    for (const bank of account.banks) {
      if (!bank.credentials) continue;
      const decoded = decryptBankCredentials(bank.credentials);
      if (!decoded) continue;

      const jobData: ScrapingJobData = {
        user_id: user_id.toString(),
        bank_id: bank._id?.toString(),
        companyId: decoded.companyId,
        credentials: decoded,
        isRefresh: true,
      };

      await scrapingQueue.add('admin-reindex', jobData);
      queued++;
    }

    if (config.enablePatternPersistence) {
      await enqueuePatternRecompute(user_id.toString());
    }

    return { queued };
  };

  reindexAllUsers = async (): Promise<{ usersQueued: number; banksQueued: number }> => {
    const accounts = await Accounts.find({ banks: { $exists: true, $ne: [] } }).lean().exec();
    const scrapingQueue = getScrapingQueue();
    let banksQueued = 0;
    let usersQueued = 0;

    for (const account of accounts) {
      let userBanksQueued = 0;

      for (const bank of account.banks) {
        if (!bank.credentials) continue;

        try {
          const decoded = decryptBankCredentials(bank.credentials);
          if (!decoded) continue;

          const jobData: ScrapingJobData = {
            user_id: account.user_id.toString(),
            bank_id: bank._id?.toString(),
            companyId: decoded.companyId,
            credentials: decoded,
            isRefresh: true,
          };

          await scrapingQueue.add('admin-reindex-all', jobData);
          userBanksQueued++;
          banksQueued++;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          config.log.error(
            { user_id: account.user_id, bank_id: bank._id },
            `Admin reindex: failed to queue bank: ${message}`,
          );
        }
      }

      if (userBanksQueued > 0) {
        if (config.enablePatternPersistence) {
          await enqueuePatternRecompute(account.user_id.toString());
        }
        usersQueued++;
      }
    }

    return { usersQueued, banksQueued };
  };
}

const adminLogic = new AdminLogic();
export default adminLogic;
