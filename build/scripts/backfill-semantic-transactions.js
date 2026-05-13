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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
const mongoose_1 = __importDefault(require("mongoose"));
const collections_1 = require("../src/collections");
const config_1 = __importDefault(require("../src/utils/config"));
const helpers_1 = require("../src/utils/helpers");
const settlement_detection_1 = require("../src/utils/settlement-detection");
const transaction_semantics_1 = require("../src/utils/transaction-semantics");
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const BATCH_SIZE = 500;
const inferSemanticType = (transaction) => {
    var _a, _b;
    const text = (0, transaction_semantics_1.getTransactionTextSource)(transaction);
    if ((0, settlement_detection_1.classifySettlement)(text, false) !== 'normal') {
        return 'card_settlement';
    }
    if (transaction.type === transactions_1.TransactionTypes.Installments ||
        ((_b = (_a = transaction.installments) === null || _a === void 0 ? void 0 : _a.total) !== null && _b !== void 0 ? _b : 0) > 1) {
        return 'installment';
    }
    const amount = (0, transaction_semantics_1.getTransactionAmount)(transaction);
    if (amount >= 0) {
        return (0, helpers_1.isCardProviderCompany)(transaction.companyId) ? 'refund' : 'deposit';
    }
    return (0, helpers_1.isCardProviderCompany)(transaction.companyId) ? 'merchant_charge' : 'bank_transfer';
};
const buildUpdate = (transaction) => {
    var _a, _b;
    const merchantId = (0, transaction_semantics_1.getMerchantId)(transaction) || undefined;
    const mcc = (_a = (0, transaction_semantics_1.getMcc)(transaction)) !== null && _a !== void 0 ? _a : undefined;
    const cardLast4 = (0, transaction_semantics_1.getCardLast4)(transaction) || undefined;
    return Object.assign(Object.assign({ eventDate: (0, transaction_semantics_1.getEventDate)(transaction), postingDate: (0, transaction_semantics_1.getPostingDate)(transaction), providerCategoryName: (0, transaction_semantics_1.getProviderCategoryName)(transaction) || null, counterparty: (0, transaction_semantics_1.getCounterparty)(transaction) || null, cardLast4: cardLast4 !== null && cardLast4 !== void 0 ? cardLast4 : null, semanticType: transaction.semanticType || inferSemanticType(transaction), merchantId: merchantId !== null && merchantId !== void 0 ? merchantId : null, mcc: mcc !== null && mcc !== void 0 ? mcc : null }, (merchantId ? {} : { merchantId: null })), (cardLast4 ? { cardNumber: (_b = transaction.cardNumber) !== null && _b !== void 0 ? _b : cardLast4 } : {}));
};
const backfillCollection = (collection, label) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c;
    let processed = 0;
    let updated = 0;
    let batch = [];
    const cursor = collection.find({}).lean().cursor();
    try {
        for (var _d = true, _e = __asyncValues(cursor), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
            _c = _f.value;
            _d = false;
            const transaction = _c;
            processed += 1;
            const update = buildUpdate(transaction);
            batch.push({
                updateOne: {
                    filter: { _id: transaction._id },
                    update: { $set: update },
                },
            });
            if (batch.length >= BATCH_SIZE) {
                const result = yield collection.bulkWrite(batch, { ordered: false });
                updated += result.modifiedCount + result.upsertedCount;
                console.log(`[${label}] processed ${processed}, updated ${updated}`);
                batch = [];
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
        }
        finally { if (e_1) throw e_1.error; }
    }
    if (batch.length > 0) {
        const result = yield collection.bulkWrite(batch, { ordered: false });
        updated += result.modifiedCount + result.upsertedCount;
    }
    console.log(`[${label}] done. processed=${processed}, updated=${updated}`);
});
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    if (!config_1.default.mongoConnectionString) {
        throw new Error('Mongo connection string is missing');
    }
    yield mongoose_1.default.connect(config_1.default.mongoConnectionString);
    console.log(`Connected to ${config_1.default.mongoConnectionString}`);
    try {
        yield backfillCollection(collections_1.Transactions, 'transactions');
        yield backfillCollection(collections_1.CardTransactions, 'cardTransactions');
    }
    finally {
        yield mongoose_1.default.disconnect();
    }
});
void run().catch((error) => {
    console.error('Semantic backfill failed', error);
    process.exit(1);
});
