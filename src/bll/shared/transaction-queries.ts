import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { Transactions, CardTransactions } from '../../collections';

export type CompletedTransactions = { regularTxns: unknown[]; cardTxns: unknown[] };

// Fetch completed transactions from both the bank and card collections for a
// user, applying the same extra filter (typically a date range) to both.
export const fetchCompletedTransactions = async (
  user_id: string,
  filter: Record<string, unknown> = {},
): Promise<CompletedTransactions> => {
  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({ user_id, status: TransactionStatuses.Completed, ...filter }).lean().exec(),
    CardTransactions.find({ user_id, status: TransactionStatuses.Completed, ...filter }).lean().exec(),
  ]);
  return { regularTxns, cardTxns };
};
