import { toDateStr } from './date-helpers';

type TransactionLike = {
  amount?: number | null;
  chargedAmount?: number | null;
  originalAmount?: number | null;
  eventDate?: string | Date | null;
  postingDate?: string | Date | null;
  billingDate?: string | Date | null;
  date?: string | Date | null;
  processedDate?: string | Date | null;
  description?: string | null;
  memo?: string | null;
  providerCategoryName?: string | null;
  category?: string | null;
  categoryDescription?: string | null;
  counterparty?: string | null;
  channel?: string | null;
  channelName?: string | null;
  semanticType?: string | null;
  merchantId?: string | null;
  mcc?: string | number | null;
  cardLast4?: string | number | null;
  cardNumber?: string | number | null;
  cardUniqueId?: string | null;
  rawTransaction?: any;
};

const toDateString = (value?: string | Date | null): string => (value ? toDateStr(value) : '');

export const getTransactionAmount = (transaction: TransactionLike): number =>
  transaction.amount ?? transaction.chargedAmount ?? transaction.originalAmount ?? 0;

export const getEventDate = (transaction: TransactionLike): string =>
  toDateString(
    transaction.eventDate ??
    transaction.date ??
    transaction.postingDate ??
    transaction.processedDate,
  );

export const getPostingDate = (transaction: TransactionLike): string =>
  toDateString(
    transaction.postingDate ??
    transaction.processedDate ??
    transaction.eventDate ??
    transaction.date,
  );

export const getProviderCategoryName = (transaction: TransactionLike): string =>
  transaction.providerCategoryName ??
  transaction.category ??
  transaction.categoryDescription ??
  '';

export const getCounterparty = (transaction: TransactionLike): string =>
  transaction.counterparty ??
  transaction.memo ??
  transaction.channelName ??
  transaction.channel ??
  '';

export const getMerchantId = (transaction: TransactionLike): string =>
  transaction.merchantId ??
  transaction.rawTransaction?.merchantId ??
  transaction.rawTransaction?.merchantID ??
  '';

export const getMcc = (transaction: TransactionLike): string | number | null =>
  transaction.mcc ??
  transaction.rawTransaction?.mcc ??
  null;

export const getCardLast4 = (transaction: TransactionLike): string =>
  String(transaction.cardLast4 ?? transaction.cardNumber ?? '').trim();

const inferLegacySemanticType = (transaction: TransactionLike): string => {
  const amount = getTransactionAmount(transaction);
  const category = getProviderCategoryName(transaction).toLowerCase();
  const description = getTransactionTextSource(transaction).toLowerCase();

  if (transaction.rawTransaction?.mcc) {
    return amount >= 0 ? 'refund' : 'merchant_charge';
  }
  if (transaction.rawTransaction?.merchantId || transaction.rawTransaction?.merchantID) {
    return amount >= 0 ? 'refund' : 'merchant_charge';
  }
  if (category.includes('הוראת קבע') || description.includes('הוראת קבע')) {
    return 'standing_order';
  }
  if (category.includes('עמלה') || description.includes('עמלה')) {
    return 'bank_fee';
  }
  if (amount >= 0) {
    return 'deposit';
  }
  return 'bank_transfer';
};

export const getSemanticType = (transaction: TransactionLike): string =>
  transaction.semanticType ?? inferLegacySemanticType(transaction);

export const getTransactionTextSource = (transaction: TransactionLike): string =>
  [
    transaction.description,
    transaction.memo,
    getProviderCategoryName(transaction),
    getCounterparty(transaction),
  ].filter(Boolean).join(' ');
