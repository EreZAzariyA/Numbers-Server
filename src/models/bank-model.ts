import { AccountInfoType, PastOrFutureDebitType, CardBlockType, AccountSavesType } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import { Document, model, Schema } from "mongoose";

const AccountInfoScheme = new Schema<AccountInfoType>({
  accountName: String,
  accountAvailableBalance: Number,
  accountBalance: Number,
  accountStatusCode: String,
  accountCurrencyCode: String,
  accountCurrencyLongName: String,
  handlingBranchID: String,
  handlingBranchName: String,
  privateBusinessFlag: String
}, { _id: false });

const PastOrFutureDebitsScheme = new Schema<PastOrFutureDebitType>({
  debitMonth: String,
  monthlyNumberOfTransactions: Number,
  monthlyNISDebitSum: Number,
  monthlyUSDDebitSum: Number,
  monthlyEURDebitSum: Number
}, { _id: false });

const CreditCardsScheme = new Schema<CardBlockType>({
  cardHolderFirstName: String,
  cardHolderLastName: String,
  cardName: String,
  cardNumber: String,
  cardFrameworkNotUsed: Number,
  cardFrameworkUsed: Number,
  cardTypeDescription: String,
  cardFamilyDescription: String,
  cardValidityDate: String,
  dateOfUpcomingDebit: String,
  NISTotalDebit: Number,
  USDTotalDebit: Number,
  EURTotalDebit: Number,
}, { _id: false });

const AccountSavesScheme = new Schema<AccountSavesType>({
  businessDate: String,
  totalDepositsCurrentValue: Number,
  currencyCode: String
}, { _id: false });

export interface IBankModal extends Document {
  bankName: string;
  credentials: string;
  details: {
    accountNumber: string;
    balance: number;
  };
  lastConnection: number;
  extraInfo: Partial<AccountInfoType>;
  pastOrFutureDebits: PastOrFutureDebitType[];
  creditCards: CardBlockType[];
  savings: AccountSavesType;
  createdAt: Date;
  updatedAt: Date;
};

const BankScheme = new Schema<IBankModal>({
  bankName: {
    type: String,
    required: [true, "Bank name is missing"],
  },
  credentials: String,
  details: {
    accountNumber: Number,
    balance: Number
  },
  lastConnection: {
    type: Number,
    default: new Date().valueOf()
  },
  extraInfo: AccountInfoScheme,
  pastOrFutureDebits: [PastOrFutureDebitsScheme],
  creditCards: [CreditCardsScheme],
  savings: AccountSavesScheme
});

export interface IBanksModal extends Document {
  user_id: Schema.Types.ObjectId;
  banks: IBankModal[];
};

const BanksSchema = new Schema<IBanksModal>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, "User id is missing"]
  },
  banks: [BankScheme]
}, {
  versionKey: false,
  autoIndex: true,
});

export const BankModel = model('Banks', BankScheme);
export const UserBanks = model('UserBanks', BanksSchema, 'banks');