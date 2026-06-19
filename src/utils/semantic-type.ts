import { TransactionTypes } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { classifySettlement } from './settlement-detection';
import { isCardProviderCompany } from './helpers';
import { getTransactionAmount, getTransactionTextSource } from './transaction-semantics';

export interface SemanticTypeInput {
  type?: string | null;
  installments?: { total?: number | null } | null;
  companyId?: string;
}

type TextInput = Parameters<typeof getTransactionTextSource>[0];
type AmountInput = Parameters<typeof getTransactionAmount>[0];

/**
 * Canonical semantic-type inference used at write time by both bank-scraper
 * ingestion and the backfill migration, so a transaction is typed identically
 * regardless of how it entered the system.
 *
 * `companyId` must be supplied (it is not present on raw scraper transactions),
 * otherwise card charges/refunds cannot be distinguished from bank movements.
 */
export const inferSemanticType = (transaction: SemanticTypeInput): string => {
  const text = getTransactionTextSource(transaction as TextInput);
  if (classifySettlement(text, false) !== 'normal') {
    return 'card_settlement';
  }

  if (
    transaction.type === TransactionTypes.Installments ||
    (transaction.installments?.total ?? 0) > 1
  ) {
    return 'installment';
  }

  const amount = getTransactionAmount(transaction as AmountInput);
  if (amount >= 0) {
    return isCardProviderCompany(transaction.companyId) ? 'refund' : 'deposit';
  }

  return isCardProviderCompany(transaction.companyId) ? 'merchant_charge' : 'bank_transfer';
};
