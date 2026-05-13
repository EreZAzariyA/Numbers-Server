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
const transaction_semantics_1 = require("../src/utils/transaction-semantics");
const BATCH_SIZE = 500;
const buildUpdate = (transaction) => {
    const eventDate = (0, transaction_semantics_1.getEventDate)(transaction) || null;
    const postingDate = (0, transaction_semantics_1.getPostingDate)(transaction) || null;
    return {
        eventDate,
        postingDate,
        date: eventDate,
        processedDate: postingDate,
    };
};
const normalizeCollection = (collection, label) => __awaiter(void 0, void 0, void 0, function* () {
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
            batch.push({
                updateOne: {
                    filter: { _id: transaction._id },
                    update: { $set: buildUpdate(transaction) },
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
        yield normalizeCollection(collections_1.Transactions, 'transactions');
        yield normalizeCollection(collections_1.CardTransactions, 'cardTransactions');
    }
    finally {
        yield mongoose_1.default.disconnect();
    }
});
void run().catch((error) => {
    console.error('Transaction date normalization failed', error);
    process.exit(1);
});
