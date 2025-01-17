"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankModel = exports.BankScheme = void 0;
const mongoose_1 = require("mongoose");
const AccountInfoScheme = new mongoose_1.Schema({
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
const PastOrFutureDebitsScheme = new mongoose_1.Schema({
    debitMonth: String,
    monthlyNumberOfTransactions: Number,
    monthlyNISDebitSum: Number,
    monthlyUSDDebitSum: Number,
    monthlyEURDebitSum: Number
}, { _id: false });
const CreditCardsScheme = new mongoose_1.Schema({
    firstName: String,
    lastName: String,
    cardUniqueId: String,
    last4Digits: String,
    cardName: String,
    cardNumber: String,
    cardFramework: Number,
    cardFrameworkNotUsed: Number,
    cardFrameworkUsed: Number,
    cardStatusCode: Number,
    cardTypeDescription: String,
    cardFamilyDescription: String,
    cardValidityDate: String,
    dateOfUpcomingDebit: String,
    cardImage: String,
    NISTotalDebit: Number,
    USDTotalDebit: Number,
    EURTotalDebit: Number,
});
const CardsPastOrFutureDebitsScheme = new mongoose_1.Schema({
    accountCreditFramework: Number,
    accountFrameworkNotUsed: Number,
    accountFrameworkUsed: Number,
    cardsBlock: [CreditCardsScheme]
}, { _id: false });
const AccountSavesScheme = new mongoose_1.Schema({
    businessDate: String,
    totalDepositsCurrentValue: Number,
    currencyCode: String
}, { _id: false });
const LoanScheme = new mongoose_1.Schema({
    currentTimestamp: Number,
    summary: {
        currentMonthTotalPayment: Number,
        totalBalance: Number,
        totalBalanceCurrency: String,
    },
    loans: [{
            loanAccount: String,
            loanName: String,
            numOfPayments: String,
            numOfPaymentsRemained: String,
            numOfPaymentsMade: String,
            establishmentDate: String,
            establishmentChannelCode: String,
            loanCurrency: String,
            loanAmount: Number,
            totalInterestRate: Number,
            firstPaymentDate: String,
            lastPaymentDate: String,
            nextPaymentDate: String,
            previousPaymentDate: String,
            nextPayment: Number,
            previousPayment: Number,
            baseInterestDescription: String,
            loanBalance: Number,
            prepaymentPenaltyFee: Number,
            totalLoanBalance: Number,
            finishDate: String,
            loanRefundStatus: String,
            establishmentValueDate: String,
            currentMonthPayment: Number,
            numberOfPartialPrepayments: String,
            loanPurpose: String
        }]
}, { _id: false });
;
exports.BankScheme = new mongoose_1.Schema({
    bankName: {
        type: String,
        required: [true, "Bank name is missing"],
    },
    credentials: String,
    isMainAccount: Boolean,
    isCardProvider: Boolean,
    details: {
        accountNumber: {
            type: Number,
            default: undefined
        },
        balance: {
            type: Number,
            default: undefined
        }
    },
    lastConnection: {
        type: Number,
        default: new Date().valueOf()
    },
    extraInfo: AccountInfoScheme,
    savings: AccountSavesScheme,
    pastOrFutureDebits: [PastOrFutureDebitsScheme],
    cardsPastOrFutureDebit: CardsPastOrFutureDebitsScheme,
    loans: LoanScheme
});
exports.BankModel = (0, mongoose_1.model)('Bank', exports.BankScheme);
