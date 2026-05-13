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
exports.startScrapingWorker = void 0;
const bullmq_1 = require("bullmq");
const queues_1 = require("../queues");
const bank_utils_1 = require("../utils/bank-utils");
const helpers_1 = require("../utils/helpers");
const banks_1 = __importDefault(require("../bll/banks"));
const bll_1 = require("../bll");
const socket_1 = require("../dal/socket");
const processScrapingJob = (job) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { user_id, bank_id, credentials, isRefresh } = job.data;
    socket_1.socketIo.emitToUser(user_id, 'scraping:started', { jobId: job.id, bankName: credentials.companyId });
    yield job.updateProgress({ stage: 'scraping', message: 'Connecting to bank...' });
    const scrapeResult = yield (0, bank_utils_1.getBankData)(credentials);
    if (scrapeResult.errorType || scrapeResult.errorMessage) {
        socket_1.socketIo.emitToUser(user_id, 'scraping:failed', { jobId: job.id, error: scrapeResult.errorMessage });
        throw new Error(`Scraper error: ${scrapeResult.errorMessage}`);
    }
    const account = (_a = scrapeResult.accounts) === null || _a === void 0 ? void 0 : _a[0];
    if (!account) {
        throw new Error('No account data returned from bank scraper');
    }
    socket_1.socketIo.emitToUser(user_id, 'scraping:progress', { jobId: job.id, stage: 'processing', percent: 50 });
    yield job.updateProgress({ stage: 'processing', message: 'Processing bank data...' });
    if (!isRefresh) {
        const defCategory = yield bll_1.categoriesLogic.fetchUserCategory(user_id, 'Others');
        if (!defCategory) {
            yield bll_1.categoriesLogic.addNewCategory('Others', user_id, { reuseExisting: true });
        }
    }
    let insertedTransactions = [];
    socket_1.socketIo.emitToUser(user_id, 'scraping:progress', { jobId: job.id, stage: 'saving', percent: 90 });
    yield job.updateProgress({ stage: 'saving', message: 'Saving bank data...' });
    if (isRefresh) {
        if ((account === null || account === void 0 ? void 0 : account.txns) && (0, helpers_1.isArrayAndNotEmpty)(account.txns)) {
            const transactions = yield banks_1.default.importTransactions(account.txns, user_id, credentials.companyId);
            insertedTransactions = [...insertedTransactions, ...transactions];
            socket_1.socketIo.emitToUser(user_id, 'scraping:progress', {
                jobId: job.id, stage: 'saving', percent: 90, importedCount: insertedTransactions.length
            });
        }
        if ((account === null || account === void 0 ? void 0 : account.cardsPastOrFutureDebit) && (0, helpers_1.isArrayAndNotEmpty)((_b = account.cardsPastOrFutureDebit) === null || _b === void 0 ? void 0 : _b.cardsBlock)) {
            const promises = account.cardsPastOrFutureDebit.cardsBlock
                .filter((card) => (0, helpers_1.isArrayAndNotEmpty)(card.txns))
                .map((card) => __awaiter(void 0, void 0, void 0, function* () {
                if (card.cardStatusCode && card.cardStatusCode === 9)
                    return;
                const cardTransactions = yield banks_1.default.importTransactions(card.txns, user_id, credentials.companyId);
                insertedTransactions = [...insertedTransactions, ...cardTransactions];
            }));
            yield Promise.all(promises);
            socket_1.socketIo.emitToUser(user_id, 'scraping:progress', {
                jobId: job.id, stage: 'saving', percent: 90, importedCount: insertedTransactions.length
            });
        }
        if ((account === null || account === void 0 ? void 0 : account.pastOrFutureDebits) && (0, helpers_1.isArrayAndNotEmpty)(account === null || account === void 0 ? void 0 : account.pastOrFutureDebits) && bank_id) {
            const updatedPastOrFutureDebits = yield banks_1.default.importPastOrFutureDebits(user_id, bank_id, account.pastOrFutureDebits);
            updatedPastOrFutureDebits.sort((a, b) => ((0, helpers_1.getFutureDebitDate)(a.debitMonth) - (0, helpers_1.getFutureDebitDate)(b.debitMonth)));
            account.pastOrFutureDebits = updatedPastOrFutureDebits;
        }
    }
    const bank = yield (0, bank_utils_1.insertBankAccount)(user_id, credentials, account);
    const result = {
        bank,
        account,
        importedTransactions: insertedTransactions,
    };
    socket_1.socketIo.emitToUser(user_id, 'scraping:complete', {
        jobId: job.id,
        bank,
        account,
        importedTransactions: insertedTransactions.length,
    });
    return result;
});
const startScrapingWorker = () => {
    const worker = new bullmq_1.Worker('bank-scraping', processScrapingJob, {
        connection: (0, queues_1.getRedisConnection)(),
        concurrency: 2,
    });
    worker.on('completed', (job) => {
        console.info(`Scraping job ${job.id} completed for user ${job.data.user_id}`);
    });
    worker.on('failed', (job, err) => {
        var _a;
        console.error(`Scraping job ${job === null || job === void 0 ? void 0 : job.id} failed: ${err.message}`);
        if ((_a = job === null || job === void 0 ? void 0 : job.data) === null || _a === void 0 ? void 0 : _a.user_id) {
            socket_1.socketIo.emitToUser(job.data.user_id, 'scraping:failed', { jobId: job.id, error: err.message });
        }
    });
    return worker;
};
exports.startScrapingWorker = startScrapingWorker;
