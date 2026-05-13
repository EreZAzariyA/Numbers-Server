"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardTransactions = void 0;
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const mongoose_1 = require("mongoose");
;
const CardTransactionsSchema = new mongoose_1.Schema({
    user_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: [true, 'User id is missing'],
    },
    cardNumber: {
        type: mongoose_1.Schema.Types.Mixed,
    },
    cardLast4: {
        type: mongoose_1.Schema.Types.Mixed,
    },
    cardUniqueId: {
        type: String,
        trim: true,
    },
    type: {
        type: String,
        trim: true,
    },
    eventDate: {
        type: String,
        trim: true,
        required: [true, "Date is missing"],
    },
    postingDate: {
        type: String,
        trim: true,
    },
    billingDate: {
        type: String,
        trim: true,
    },
    date: {
        type: String,
        trim: true,
    },
    processedDate: {
        type: String,
        trim: true,
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
    companyId: String,
    originalAmount: { type: Number },
    originalCurrency: {
        type: String,
        trim: true,
    },
    chargedAmount: { type: Number },
    chargedCurrency: {
        type: String,
        trim: true,
    },
    memo: {
        type: String,
        trim: true,
    },
    installments: {
        number: { type: Number },
        total: { type: Number },
    },
    semanticType: {
        type: String,
        trim: true,
    },
    providerCategoryId: {
        type: mongoose_1.Schema.Types.Mixed,
    },
    providerCategoryName: {
        type: String,
        trim: true,
    },
    merchantId: {
        type: String,
        trim: true,
    },
    mcc: {
        type: mongoose_1.Schema.Types.Mixed,
    },
    counterparty: {
        type: String,
        trim: true,
    },
    category: {
        type: String,
        trim: true,
    },
    categoryDescription: {
        type: String,
        trim: true,
    },
    channel: {
        type: String,
        trim: true,
    },
    channelName: {
        type: String,
        trim: true,
    },
    rawTransaction: { type: mongoose_1.Schema.Types.Mixed },
}, {
    versionKey: false,
    autoIndex: true,
    timestamps: true
});
exports.CardTransactions = (0, mongoose_1.model)('CardTransactions', CardTransactionsSchema, 'cardTransactions');
