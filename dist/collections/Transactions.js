"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transactions = void 0;
const mongoose_1 = require("mongoose");
const transactions_1 = require("israeli-bank-scrapers-by-e.a/lib/transactions");
;
const TransactionsSchema = new mongoose_1.Schema({
    user_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: [true, 'User id is missing'],
    },
    date: {
        type: String,
        trim: true,
        required: [true, "Date is missing"],
    },
    identifier: {
        type: mongoose_1.Schema.Types.Mixed,
        unique: true,
        sparse: true,
        default: undefined,
    },
    category_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: [true, "Category id is missing"],
    },
    description: {
        type: String,
        trim: true,
        required: [true, "Description is missing"],
    },
    amount: {
        type: Number,
        required: [true, "Amount is missing"],
    },
    status: {
        type: String,
        default: transactions_1.TransactionStatuses.Completed
    },
    companyId: String
}, {
    versionKey: false,
    autoIndex: true,
    timestamps: true
});
exports.Transactions = (0, mongoose_1.model)('Transactions', TransactionsSchema, 'transactions');
