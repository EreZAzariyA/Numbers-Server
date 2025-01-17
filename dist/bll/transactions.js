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
exports.getTotalTransactionsAmounts = void 0;
const transactions_1 = require("israeli-bank-scrapers-by-e.a/lib/transactions");
const client_error_1 = __importDefault(require("../models/client-error"));
const Transactions_1 = require("../collections/Transactions");
const Card_Transactions_1 = require("../collections/Card-Transactions");
const bank_utils_1 = require("../utils/bank-utils");
const getTotalTransactionsAmounts = (transactions) => {
    return transactions.reduce((acc, t) => acc + t.amount, 0);
};
exports.getTotalTransactionsAmounts = getTotalTransactionsAmounts;
class TransactionsLogic {
    constructor() {
        this.fetchUserTransactions = (user_id, params, type) => __awaiter(this, void 0, void 0, function* () {
            const { query, projection, options } = params;
            const collection = type === 'creditCards' ? Card_Transactions_1.CardTransactions : Transactions_1.Transactions;
            let transactions = [];
            let total = 0;
            total = yield collection.countDocuments(Object.assign({ user_id }, query));
            transactions = yield collection.find(Object.assign({ user_id }, query), projection, Object.assign(Object.assign({}, options), { sort: { 'date': -1 } }));
            return {
                transactions,
                total
            };
        });
        this.fetchUserBankTransaction = (transaction, companyId, user_id) => __awaiter(this, void 0, void 0, function* () {
            const isCardTransaction = (0, bank_utils_1.isCardProviderCompany)(companyId);
            let trans = undefined;
            const query = Object.assign({}, ((transaction === null || transaction === void 0 ? void 0 : transaction.identifier) ? {
                identifier: isCardTransaction ? transaction.identifier.toString() : transaction.identifier
            } : Object.assign(Object.assign(Object.assign({}, ((transaction === null || transaction === void 0 ? void 0 : transaction.memo) ? {
                memo: transaction.memo
            } : {})), ((transaction === null || transaction === void 0 ? void 0 : transaction.date) ? {
                date: transaction.date
            } : {})), { companyId, description: transaction.description, amount: transaction.chargedAmount || transaction.originalAmount })));
            let collection = Transactions_1.Transactions;
            if (isCardTransaction) {
                collection = Card_Transactions_1.CardTransactions;
            }
            trans = yield collection.findOne(Object.assign({ user_id }, query)).exec();
            return trans;
        });
        this.newTransaction = (user_id, transaction, type) => __awaiter(this, void 0, void 0, function* () {
            if (!user_id) {
                throw new client_error_1.default(500, 'User id is missing');
            }
            const isCardTransaction = (0, bank_utils_1.isCardProviderCompany)(transaction.companyId) || type !== 'transactions';
            let newTransaction = null;
            if (isCardTransaction) {
                newTransaction = new Card_Transactions_1.CardTransactions(Object.assign({ user_id, cardNumber: (transaction === null || transaction === void 0 ? void 0 : transaction.cardNumber) || null }, transaction));
            }
            else {
                newTransaction = new Transactions_1.Transactions(Object.assign({ user_id }, transaction));
            }
            const errors = newTransaction.validateSync();
            if (errors) {
                throw new client_error_1.default(500, errors.message);
            }
            return newTransaction.save();
        });
        this.updateTransaction = (user_id_1, transaction_1, ...args_1) => __awaiter(this, [user_id_1, transaction_1, ...args_1], void 0, function* (user_id, transaction, type = 'Account') {
            const isCardTransaction = type !== 'transactions';
            const collection = isCardTransaction ? Card_Transactions_1.CardTransactions : Transactions_1.Transactions;
            const currentTransaction = yield collection.findOne({ user_id, _id: transaction._id }).exec();
            if (!currentTransaction) {
                throw new client_error_1.default(400, 'User transaction not found');
            }
            const updatedTransaction = yield collection.findOneAndUpdate({ user_id, _id: transaction._id }, {
                $set: Object.assign(Object.assign({}, transaction), { date: transaction.date, category_id: transaction.category_id, description: transaction.description, amount: transaction.amount, status: transaction.status || transactions_1.TransactionStatuses.Completed })
            }, { new: true }).exec();
            const errors = updatedTransaction.validateSync();
            if (errors) {
                throw new client_error_1.default(500, errors.message);
            }
            return updatedTransaction;
        });
        this.updateTransactionStatus = (transaction, status) => __awaiter(this, void 0, void 0, function* () {
            const isCardProvider = (0, bank_utils_1.isCardProviderCompany)(transaction.companyId);
            const query = {
                _id: transaction._id,
                query: { $set: { status } },
                projection: { new: true }
            };
            if (isCardProvider) {
                return yield Card_Transactions_1.CardTransactions.findByIdAndUpdate(query).exec();
            }
            return yield Transactions_1.Transactions.findByIdAndUpdate(query).exec();
        });
        this.removeTransaction = (user_id_1, transaction_id_1, ...args_1) => __awaiter(this, [user_id_1, transaction_id_1, ...args_1], void 0, function* (user_id, transaction_id, type = 'transactions') {
            const isCardTransaction = type !== 'transactions';
            const query = { user_id, _id: transaction_id };
            // const transactionToRemove = await Transactions.findById(transaction_id).exec();
            // const amountToUpdate = getAmountToUpdate(transactionToRemove.amount);
            try {
                if (isCardTransaction) {
                    yield Card_Transactions_1.CardTransactions.findOneAndDelete(query).exec();
                }
                yield Transactions_1.Transactions.findByIdAndDelete(query).exec();
                // await categoriesLogic.updateCategorySpentAmount(
                //   transactionToRemove.user_id,
                //   transactionToRemove.category_id,
                //   amountToUpdate
                // );
            }
            catch (err) {
                console.log(err);
            }
        });
    }
}
;
const transactionsLogic = new TransactionsLogic();
exports.default = transactionsLogic;
