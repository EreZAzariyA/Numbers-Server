"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require(".");
const collections_1 = require("../collections");
const models_1 = require("../models");
const helpers_1 = require("../utils/helpers");
const jwt_1 = __importDefault(require("../utils/jwt"));
const bank_utils_1 = require("../utils/bank-utils");
const transactions_1 = require("./transactions");
const config_1 = __importDefault(require("../utils/config"));
const connectRedis_1 = require("../utils/connectRedis");
const transaction_semantics_1 = require("../utils/transaction-semantics");
;
;
const getErrorMessage = (error) => {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === "string" ? error : helpers_1.ErrorMessages.SOME_ERROR_TRY_AGAIN;
};
const isSupportedCompany = (companyId) => Object.prototype.hasOwnProperty.call(helpers_1.SupportedCompanies, companyId);
const hasTransactions = (card) => {
    return Boolean((card === null || card === void 0 ? void 0 : card.txns) && (0, helpers_1.isArrayAndNotEmpty)(card.txns));
};
class BankLogic {
    constructor() {
        this.fetchMainAccount = (user_id_1, ...args_1) => __awaiter(this, [user_id_1, ...args_1], void 0, function* (user_id, query = {}) {
            return collections_1.Accounts.findOne(Object.assign({ user_id }, query)).exec();
        });
        this.fetchMainAccountResponse = (user_id) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const mainAccount = yield this.fetchMainAccount(user_id);
            return Object.assign(Object.assign({}, ((mainAccount === null || mainAccount === void 0 ? void 0 : mainAccount._id) && { _id: mainAccount._id.toString() })), { user_id: (_b = (_a = mainAccount === null || mainAccount === void 0 ? void 0 : mainAccount.user_id) === null || _a === void 0 ? void 0 : _a.toString()) !== null && _b !== void 0 ? _b : user_id, banks: (_c = mainAccount === null || mainAccount === void 0 ? void 0 : mainAccount.banks) !== null && _c !== void 0 ? _c : [] });
        });
        this.fetchOneBankAccount = (user_id, bank_id) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const mainAccount = yield this.fetchMainAccount(user_id);
            return (_a = mainAccount === null || mainAccount === void 0 ? void 0 : mainAccount.banks) === null || _a === void 0 ? void 0 : _a.find((bank) => { var _a; return ((_a = bank._id) === null || _a === void 0 ? void 0 : _a.toString()) === bank_id; });
        });
        this.fetchBankData = (details, user_id) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const user = yield models_1.UserModel.findById(user_id).exec();
            if (!user) {
                throw new models_1.ClientError(500, helpers_1.ErrorMessages.USER_NOT_FOUND);
            }
            if (!isSupportedCompany(details.companyId)) {
                throw new models_1.ClientError(500, `${helpers_1.ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
            }
            const scrapeResult = yield (0, bank_utils_1.getBankData)(details);
            if (scrapeResult.errorType || scrapeResult.errorMessage) {
                console.error(`Scraper error on 'BankLogic/fetchBankData': ${scrapeResult.errorMessage}.`);
                throw new models_1.ClientError(500, helpers_1.ErrorMessages.SOME_ERROR_TRY_AGAIN);
            }
            try {
                const account = (_a = scrapeResult.accounts) === null || _a === void 0 ? void 0 : _a[0];
                if (!account) {
                    throw new models_1.ClientError(500, 'No account data returned from bank scraper');
                }
                const bank = yield (0, bank_utils_1.insertBankAccount)(user_id, details, account);
                return {
                    account,
                    bank
                };
            }
            catch (err) {
                console.log(err);
                throw new models_1.ClientError(500, getErrorMessage(err));
            }
        });
        this.refreshBankData = (bank_id, user_id, newDetailsCredentials) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const bankAccount = yield this.fetchOneBankAccount(user_id, bank_id);
            if (!bankAccount) {
                throw new models_1.ClientError(500, 'Some error while trying to find user with this account. Please contact us');
            }
            const credentials = newDetailsCredentials ? newDetailsCredentials : bankAccount === null || bankAccount === void 0 ? void 0 : bankAccount.credentials;
            if (!credentials) {
                throw new models_1.ClientError(500, 'Some error while trying to load saved credentials. Please contact us');
            }
            const decodedCredentials = yield jwt_1.default.fetchBankCredentialsFromToken(credentials);
            if (!decodedCredentials) {
                throw new models_1.ClientError(500, 'Some error while trying to load decoded credentials. Please contact us');
            }
            const details = {
                companyId: decodedCredentials.companyId,
                id: decodedCredentials.id,
                password: decodedCredentials.password,
                num: decodedCredentials.num,
                save: decodedCredentials.save,
                username: decodedCredentials.username
            };
            const scrapeResult = yield (0, bank_utils_1.getBankData)(details);
            if (scrapeResult.errorType || scrapeResult.errorMessage) {
                throw new models_1.ClientError(500, getErrorMessage(scrapeResult.errorMessage));
            }
            const account = (_a = scrapeResult.accounts) === null || _a === void 0 ? void 0 : _a[0];
            if (!account) {
                throw new models_1.ClientError(500, 'No account data returned from bank scraper');
            }
            let insertedTransactions = [];
            if ((account === null || account === void 0 ? void 0 : account.txns) && (0, helpers_1.isArrayAndNotEmpty)(account.txns)) {
                try {
                    const transactions = yield this.importTransactions(account.txns, user_id, details.companyId);
                    insertedTransactions = [...insertedTransactions, ...transactions];
                }
                catch (err) {
                    throw new models_1.ClientError(500, getErrorMessage(err));
                }
            }
            const cardsBlocks = (_c = (_b = account.cardsPastOrFutureDebit) === null || _b === void 0 ? void 0 : _b.cardsBlock) !== null && _c !== void 0 ? _c : [];
            if ((0, helpers_1.isArrayAndNotEmpty)(cardsBlocks)) {
                const promises = cardsBlocks
                    .filter(hasTransactions)
                    .map((card) => __awaiter(this, void 0, void 0, function* () {
                    if (card.cardStatusCode && card.cardStatusCode === 9)
                        return;
                    try {
                        const cardTransactions = yield this.importTransactions(card.txns, user_id, details.companyId);
                        insertedTransactions = [...insertedTransactions, ...cardTransactions];
                    }
                    catch (error) {
                        throw new models_1.ClientError(500, getErrorMessage(error));
                    }
                }));
                yield Promise.all(promises);
            }
            if ((account === null || account === void 0 ? void 0 : account.pastOrFutureDebits) && (0, helpers_1.isArrayAndNotEmpty)(account === null || account === void 0 ? void 0 : account.pastOrFutureDebits)) {
                try {
                    const updatedPastOrFutureDebits = yield this.importPastOrFutureDebits(user_id, bank_id, account.pastOrFutureDebits);
                    updatedPastOrFutureDebits.sort((a, b) => ((0, helpers_1.getFutureDebitDate)(a.debitMonth) - (0, helpers_1.getFutureDebitDate)(b.debitMonth)));
                    account.pastOrFutureDebits = updatedPastOrFutureDebits;
                }
                catch (err) {
                    throw new models_1.ClientError(500, getErrorMessage(err));
                }
            }
            try {
                const bank = yield (0, bank_utils_1.insertBankAccount)(user_id, details, account);
                return {
                    bank,
                    account,
                    importedTransactions: insertedTransactions,
                    // todo: add importedCategories
                };
            }
            catch (err) {
                throw new models_1.ClientError(500, getErrorMessage(err));
            }
        });
        this.updateBankAccountDetails = (bank_id, user_id, newDetails) => __awaiter(this, void 0, void 0, function* () {
            const bankAccount = yield this.fetchOneBankAccount(user_id, bank_id);
            if (!bankAccount) {
                throw new models_1.ClientError(500, helpers_1.ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
            }
            const credentials = bankAccount === null || bankAccount === void 0 ? void 0 : bankAccount.credentials;
            if (credentials) {
                const decodedCredentials = yield jwt_1.default.fetchBankCredentialsFromToken(credentials);
                if (!decodedCredentials) {
                    throw new models_1.ClientError(500, helpers_1.ErrorMessages.DECODED_CREDENTIALS_NOT_LOADED);
                }
            }
            const newDetailsCredentials = jwt_1.default.createNewToken(newDetails);
            const refreshedBankData = yield this.refreshBankData(bank_id, user_id, newDetailsCredentials);
            return refreshedBankData;
        });
        this.importTransactions = (transactions, user_id, companyId) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            let defCategory = yield _1.categoriesLogic.fetchUserCategory(user_id, 'Others');
            if (!defCategory) {
                try {
                    defCategory = yield _1.categoriesLogic.addNewCategory('Others', user_id, { reuseExisting: true });
                }
                catch (err) {
                    throw new Error(`[bankLogic/importTransactions]: Some error while trying to add default category - ${getErrorMessage(err)}`);
                }
            }
            const isCardTransactions = (0, helpers_1.isCardProviderCompany)(companyId);
            const transactionsToInsert = [];
            const cardsTransactionsToInsert = [];
            let inserted = [];
            for (const originalTransaction of transactions) {
                const { status, originalAmount, chargedAmount, description, identifier, } = originalTransaction;
                if (!identifier)
                    continue;
                const existedTransaction = yield _1.transactionsLogic
                    .fetchUserBankTransaction(originalTransaction, companyId, user_id);
                if (existedTransaction) {
                    if (((_a = existedTransaction.status) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== (status === null || status === void 0 ? void 0 : status.toLowerCase())) {
                        try {
                            const trans = yield _1.transactionsLogic.updateTransactionStatus(existedTransaction, status);
                            inserted.push(trans);
                        }
                        catch (err) {
                            console.log(`Some error while trying to update transaction ${existedTransaction.identifier} - ${getErrorMessage(err)}`);
                            throw new models_1.ClientError(500, `Some error while trying to update transaction ${existedTransaction.identifier}`);
                        }
                    }
                    continue;
                }
                const eventDate = (0, transaction_semantics_1.getEventDate)(originalTransaction);
                const postingDate = (0, transaction_semantics_1.getPostingDate)(originalTransaction);
                const providerCategoryName = (0, transaction_semantics_1.getProviderCategoryName)(originalTransaction);
                const originalCategory = providerCategoryName;
                let originalTransactionCategory = yield _1.categoriesLogic.fetchUserCategory(user_id, originalCategory);
                if (!(originalTransactionCategory === null || originalTransactionCategory === void 0 ? void 0 : originalTransactionCategory._id)) {
                    if (providerCategoryName) {
                        originalTransactionCategory = yield _1.categoriesLogic.addNewCategory(providerCategoryName, user_id, { reuseExisting: true });
                    }
                    else {
                        originalTransactionCategory = defCategory;
                    }
                }
                const transaction = {
                    user_id,
                    eventDate,
                    postingDate,
                    billingDate: originalTransaction.billingDate,
                    date: eventDate,
                    processedDate: postingDate,
                    description,
                    companyId,
                    status,
                    identifier,
                    amount: chargedAmount !== null && chargedAmount !== void 0 ? chargedAmount : originalAmount,
                    category_id: originalTransactionCategory._id,
                    semanticType: (0, transaction_semantics_1.getSemanticType)(originalTransaction),
                    providerCategoryId: originalTransaction.providerCategoryId,
                    providerCategoryName,
                    merchantId: originalTransaction.merchantId,
                    mcc: originalTransaction.mcc,
                    counterparty: originalTransaction.counterparty,
                    cardUniqueId: originalTransaction.cardUniqueId,
                    cardLast4: (0, transaction_semantics_1.getCardLast4)(originalTransaction),
                };
                if (isCardTransactions) {
                    const transToInsert = new collections_1.CardTransactions(Object.assign(Object.assign(Object.assign({}, originalTransaction), transaction), { cardNumber: (0, transaction_semantics_1.getCardLast4)(originalTransaction) || undefined, cardLast4: (0, transaction_semantics_1.getCardLast4)(originalTransaction) || undefined }));
                    cardsTransactionsToInsert.push(transToInsert);
                }
                else {
                    const transToInsert = new collections_1.Transactions(Object.assign(Object.assign({}, originalTransaction), transaction));
                    transactionsToInsert.push(transToInsert);
                }
            }
            try {
                if (isCardTransactions) {
                    const insertedCardsTrans = yield collections_1.CardTransactions.insertMany(cardsTransactionsToInsert, {
                        ordered: false,
                        throwOnValidationError: false,
                    });
                    inserted = [...inserted, ...insertedCardsTrans];
                }
                else {
                    const insertedTrans = yield collections_1.Transactions.insertMany(transactionsToInsert, {
                        ordered: false,
                        throwOnValidationError: false,
                    });
                    inserted = [...inserted, ...insertedTrans];
                }
                if (inserted.length > 0) {
                    yield (0, transactions_1.invalidateUserDerivedCaches)(user_id);
                    if (config_1.default.enablePatternPersistence && (0, connectRedis_1.isRedisAvailable)()) {
                        try {
                            const { enqueuePatternRecompute } = yield Promise.resolve().then(() => __importStar(require('../queues')));
                            yield enqueuePatternRecompute(user_id);
                        }
                        catch (_) { /* worker may not be available */ }
                    }
                }
                return inserted;
            }
            catch (err) {
                // MongoBulkWriteError (e.g. E11000 duplicate key) — expected when re-importing existing
                // transactions. Extract successfully inserted docs and continue rather than failing the job.
                if ((err === null || err === void 0 ? void 0 : err.name) === 'MongoBulkWriteError') {
                    inserted = [...inserted, ...((_b = err === null || err === void 0 ? void 0 : err.insertedDocs) !== null && _b !== void 0 ? _b : [])];
                    if (inserted.length > 0) {
                        yield (0, transactions_1.invalidateUserDerivedCaches)(user_id);
                        if (config_1.default.enablePatternPersistence && (0, connectRedis_1.isRedisAvailable)()) {
                            try {
                                const { enqueuePatternRecompute } = yield Promise.resolve().then(() => __importStar(require('../queues')));
                                yield enqueuePatternRecompute(user_id);
                            }
                            catch (_) { /* worker may not be available */ }
                        }
                    }
                    return inserted;
                }
                console.log({ ['bankLogic/importTransactions']: err === null || err === void 0 ? void 0 : err.message, inserted });
                throw new models_1.ClientError(500, 'An error occurred while importing transactions');
            }
        });
        this.importPastOrFutureDebits = (user_id_1, bank_id_1, ...args_1) => __awaiter(this, [user_id_1, bank_id_1, ...args_1], void 0, function* (user_id, bank_id, pastOrFutureDebits = []) {
            const bankAccount = yield this.fetchOneBankAccount(user_id, bank_id);
            const bankPastOrFutureDebits = (bankAccount === null || bankAccount === void 0 ? void 0 : bankAccount.pastOrFutureDebits) || [];
            pastOrFutureDebits.forEach((debit) => {
                if (!bankPastOrFutureDebits.find((d) => d.debitMonth === debit.debitMonth)) {
                    bankPastOrFutureDebits.push(debit);
                }
            });
            return bankPastOrFutureDebits;
        });
        this.setMainBankAccount = (user_id, bank_id) => __awaiter(this, void 0, void 0, function* () {
            try {
                const bankAccount = yield this.fetchMainAccount(user_id, { 'banks._id': bank_id });
                if (!bankAccount) {
                    throw new models_1.ClientError(500, helpers_1.ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
                }
                const banks = bankAccount.banks.map((bank) => {
                    if (bank._id.toString() === bank_id.toString()) {
                        bank.isMainAccount = true;
                    }
                    else {
                        bank.isMainAccount = false;
                    }
                    return bank;
                });
                yield collections_1.Accounts.findOneAndUpdate({ user_id: bankAccount.user_id }, { $set: { banks } }).exec();
            }
            catch (err) {
                throw new models_1.ClientError(500, `Error saving the document: ${getErrorMessage(err)}`);
            }
        });
        this.removeBankAccount = (user_id, bank_id) => __awaiter(this, void 0, void 0, function* () {
            const bankAccount = yield this.fetchOneBankAccount(user_id, bank_id);
            if (!bankAccount) {
                throw new models_1.ClientError(500, helpers_1.ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
            }
            yield collections_1.Accounts.findOneAndUpdate({ user_id }, {
                $pull: {
                    banks: { _id: bankAccount._id }
                }
            }).exec();
        });
    }
}
;
const bankLogic = new BankLogic();
exports.default = bankLogic;
