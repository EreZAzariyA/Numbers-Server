"use strict";
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
const user_model_1 = require("../models/user-model");
const client_error_1 = __importDefault(require("../models/client-error"));
const bank_utils_1 = require("../utils/bank-utils");
const helpers_1 = require("../utils/helpers");
const jwt_1 = __importDefault(require("../utils/jwt"));
const categories_1 = __importDefault(require("./categories"));
const Transactions_1 = require("../collections/Transactions");
const transactions_1 = __importDefault(require("./transactions"));
const Card_Transactions_1 = require("../collections/Card-Transactions");
const Banks_1 = require("../collections/Banks");
;
;
class BankLogic {
    constructor() {
        this.fetchMainAccount = (user_id_1, ...args_1) => __awaiter(this, [user_id_1, ...args_1], void 0, function* (user_id, query = {}) {
            return Banks_1.Accounts.findOne(Object.assign({ user_id }, query)).exec();
        });
        this.fetchOneBankAccount = (user_id, bank_id) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const mainAccount = yield this.fetchMainAccount(user_id);
            return (_a = mainAccount === null || mainAccount === void 0 ? void 0 : mainAccount.banks) === null || _a === void 0 ? void 0 : _a.find((bank) => { var _a; return ((_a = bank._id) === null || _a === void 0 ? void 0 : _a.toString()) === bank_id; });
        });
        this.fetchBankData = (details, user_id) => __awaiter(this, void 0, void 0, function* () {
            const user = yield user_model_1.UserModel.findById(user_id).exec();
            if (!user) {
                throw new client_error_1.default(500, helpers_1.ErrorMessages.USER_NOT_FOUND);
            }
            if (!bank_utils_1.SupportedCompanies[details.companyId]) {
                throw new client_error_1.default(500, `${helpers_1.ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
            }
            const scrapeResult = yield (0, bank_utils_1.getBankData)(details);
            if (scrapeResult.errorType || scrapeResult.errorMessage) {
                console.error(`Scraper error on 'BankLogic/fetchBankData': ${scrapeResult.errorMessage}.`);
                throw new client_error_1.default(500, helpers_1.ErrorMessages.SOME_ERROR_TRY_AGAIN);
            }
            try {
                const account = scrapeResult.accounts[0];
                const bank = yield (0, bank_utils_1.insertBankAccount)(user_id, details, account);
                return {
                    account,
                    bank
                };
            }
            catch (err) {
                console.log(err);
                throw new client_error_1.default(500, 'Error');
            }
        });
        this.refreshBankData = (bank_id, user_id, newDetailsCredentials) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const bankAccount = yield bankLogic.fetchOneBankAccount(user_id, bank_id);
            if (!bankAccount) {
                throw new client_error_1.default(500, 'Some error while trying to find user with this account. Please contact us');
            }
            const credentials = newDetailsCredentials ? newDetailsCredentials : bankAccount === null || bankAccount === void 0 ? void 0 : bankAccount.credentials;
            if (!credentials) {
                throw new client_error_1.default(500, 'Some error while trying to load saved credentials. Please contact us');
            }
            const decodedCredentials = yield jwt_1.default.fetchBankCredentialsFromToken(credentials);
            if (!decodedCredentials) {
                throw new client_error_1.default(500, 'Some error while trying to load decoded credentials. Please contact us');
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
                throw new client_error_1.default(500, scrapeResult.errorMessage);
            }
            const account = scrapeResult.accounts[0];
            let insertedTransactions = [];
            if ((account === null || account === void 0 ? void 0 : account.txns) && (0, helpers_1.isArrayAndNotEmpty)(account.txns)) {
                try {
                    const transactions = yield this.importTransactions(account.txns, user_id, details.companyId);
                    insertedTransactions = [...insertedTransactions, ...transactions];
                }
                catch (err) {
                    throw new client_error_1.default(500, err.message);
                }
            }
            if ((account === null || account === void 0 ? void 0 : account.cardsPastOrFutureDebit) && (0, helpers_1.isArrayAndNotEmpty)((_a = account.cardsPastOrFutureDebit) === null || _a === void 0 ? void 0 : _a.cardsBlock)) {
                const promises = account.cardsPastOrFutureDebit.cardsBlock
                    .filter((card) => (0, helpers_1.isArrayAndNotEmpty)(card.txns))
                    .map((card) => __awaiter(this, void 0, void 0, function* () {
                    if (card.cardStatusCode && card.cardStatusCode === 9)
                        return;
                    try {
                        const cardTransactions = yield this.importTransactions(card.txns, user_id, details.companyId);
                        insertedTransactions = [...insertedTransactions, ...cardTransactions];
                    }
                    catch (error) {
                        throw new client_error_1.default(500, (error === null || error === void 0 ? void 0 : error.message) || error);
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
                    throw new client_error_1.default(500, err.message);
                }
            }
            try {
                const bank = yield (0, bank_utils_1.insertBankAccount)(user_id, details, account);
                return {
                    bank,
                    importedTransactions: insertedTransactions,
                    // todo: add importedCategories
                };
            }
            catch (err) {
                throw new client_error_1.default(500, err.message);
            }
        });
        this.updateBankAccountDetails = (bank_id, user_id, newDetails) => __awaiter(this, void 0, void 0, function* () {
            const bankAccount = yield bankLogic.fetchOneBankAccount(user_id, bank_id);
            if (!bankAccount) {
                throw new client_error_1.default(500, helpers_1.ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
            }
            const credentials = bankAccount === null || bankAccount === void 0 ? void 0 : bankAccount.credentials;
            if (credentials) {
                const decodedCredentials = yield jwt_1.default.fetchBankCredentialsFromToken(credentials);
                if (!decodedCredentials) {
                    throw new client_error_1.default(500, helpers_1.ErrorMessages.DECODED_CREDENTIALS_NOT_LOADED);
                }
                const oldCredentials = [];
                oldCredentials.push(decodedCredentials);
            }
            const newDetailsCredentials = jwt_1.default.createNewToken(newDetails);
            const refreshedBankData = yield this.refreshBankData(bank_id, user_id, newDetailsCredentials);
            return refreshedBankData;
        });
        this.importTransactions = (transactions, user_id, companyId) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            let defCategory = yield categories_1.default.fetchUserCategory(user_id, 'Others');
            if (!defCategory) {
                try {
                    defCategory = yield categories_1.default.addNewCategory('Others', user_id);
                }
                catch (err) {
                    throw new Error(`[bankLogic/importTransactions]: Some error while trying to add default category - ${err === null || err === void 0 ? void 0 : err.message}`);
                }
            }
            const isCardTransactions = (0, bank_utils_1.isCardProviderCompany)(companyId);
            const transactionsToInsert = [];
            const cardsTransactionsToInsert = [];
            let inserted = [];
            for (const originalTransaction of transactions) {
                const { status, date, originalAmount, chargedAmount, description, categoryDescription, category, identifier, cardNumber, } = originalTransaction;
                const existedTransaction = yield transactions_1.default
                    .fetchUserBankTransaction(originalTransaction, companyId, user_id);
                if (existedTransaction) {
                    if (((_a = existedTransaction.status) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== (status === null || status === void 0 ? void 0 : status.toLowerCase())) {
                        try {
                            const trans = yield transactions_1.default.updateTransactionStatus(existedTransaction, status);
                            inserted.push(trans);
                        }
                        catch (err) {
                            console.log(`Some error while trying to update transaction ${existedTransaction.identifier} - ${err === null || err === void 0 ? void 0 : err.message}`);
                            throw new client_error_1.default(500, `Some error while trying to update transaction ${existedTransaction.identifier}`);
                        }
                    }
                    continue;
                }
                const originalCategory = category !== null && category !== void 0 ? category : categoryDescription;
                let originalTransactionCategory = yield categories_1.default.fetchUserCategory(user_id, originalCategory);
                if (!(originalTransactionCategory === null || originalTransactionCategory === void 0 ? void 0 : originalTransactionCategory._id)) {
                    if (category !== null && category !== void 0 ? category : categoryDescription) {
                        originalTransactionCategory = yield categories_1.default.addNewCategory(category !== null && category !== void 0 ? category : categoryDescription, user_id);
                    }
                    else {
                        originalTransactionCategory = defCategory;
                    }
                }
                const transaction = {
                    user_id,
                    date,
                    description,
                    companyId,
                    status,
                    identifier,
                    amount: originalAmount || chargedAmount,
                    category_id: originalTransactionCategory._id,
                };
                if (isCardTransactions) {
                    const transToInsert = new Card_Transactions_1.CardTransactions(Object.assign(Object.assign(Object.assign({}, transaction), originalTransaction), { cardNumber }));
                    cardsTransactionsToInsert.push(transToInsert);
                }
                else {
                    const transToInsert = new Transactions_1.Transactions(transaction);
                    transactionsToInsert.push(transToInsert);
                }
            }
            try {
                if (isCardTransactions) {
                    const insertedCardsTrans = yield Card_Transactions_1.CardTransactions.insertMany(cardsTransactionsToInsert, {
                        ordered: false,
                        throwOnValidationError: false,
                    });
                    inserted = [...inserted, ...insertedCardsTrans];
                }
                else {
                    const insertedTrans = yield Transactions_1.Transactions.insertMany(transactionsToInsert, {
                        ordered: false,
                        throwOnValidationError: false,
                    });
                    inserted = [...inserted, ...insertedTrans];
                }
                return inserted;
            }
            catch (err) {
                console.log({ ['bankLogic/importTransactions']: err === null || err === void 0 ? void 0 : err.message, inserted });
                throw new client_error_1.default(500, 'An error occurred while importing transactions');
            }
        });
        this.importPastOrFutureDebits = (user_id_1, bank_id_1, ...args_1) => __awaiter(this, [user_id_1, bank_id_1, ...args_1], void 0, function* (user_id, bank_id, pastOrFutureDebits = []) {
            const bankAccount = yield this.fetchOneBankAccount(user_id, bank_id);
            const bankPastOrFutureDebits = bankAccount.pastOrFutureDebits || [];
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
                const banks = bankAccount.banks.map((bank) => {
                    if (bank._id.toString() === bank_id.toString()) {
                        bank.isMainAccount = true;
                    }
                    else {
                        bank.isMainAccount = false;
                    }
                    return bank;
                });
                yield Banks_1.Accounts.findOneAndUpdate({ user_id: bankAccount.user_id }, { $set: { banks } }).exec();
            }
            catch (err) {
                throw new client_error_1.default(500, `Error saving the document: ${err}`);
            }
        });
    }
}
;
const bankLogic = new BankLogic();
exports.default = bankLogic;
