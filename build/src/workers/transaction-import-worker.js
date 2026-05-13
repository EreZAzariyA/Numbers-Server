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
exports.startTransactionImportWorker = void 0;
const bullmq_1 = require("bullmq");
const queues_1 = require("../queues");
const banks_1 = __importDefault(require("../bll/banks"));
const socket_1 = require("../dal/socket");
const processTransactionImport = (job) => __awaiter(void 0, void 0, void 0, function* () {
    const { transactions, user_id, companyId } = job.data;
    socket_1.socketIo.emitToUser(user_id, 'import:progress', {
        jobId: job.id,
        stage: 'importing',
        total: transactions.length,
    });
    yield job.updateProgress({ stage: 'importing', message: `Importing ${transactions.length} transactions...` });
    const result = yield banks_1.default.importTransactions(transactions, user_id, companyId);
    yield job.updateProgress({ stage: 'complete', message: `Imported ${result.length} transactions` });
    socket_1.socketIo.emitToUser(user_id, 'import:complete', {
        jobId: job.id,
        importedCount: result.length,
    });
    return { importedCount: result.length, transactions: result };
});
const startTransactionImportWorker = () => {
    const worker = new bullmq_1.Worker('transaction-import', processTransactionImport, {
        connection: (0, queues_1.getRedisConnection)(),
        concurrency: 3,
    });
    worker.on('completed', (job) => {
        console.info(`Transaction import job ${job.id} completed for user ${job.data.user_id}`);
    });
    worker.on('failed', (job, err) => {
        var _a;
        console.error(`Transaction import job ${job === null || job === void 0 ? void 0 : job.id} failed: ${err.message}`);
        if ((_a = job === null || job === void 0 ? void 0 : job.data) === null || _a === void 0 ? void 0 : _a.user_id) {
            socket_1.socketIo.emitToUser(job.data.user_id, 'import:failed', { jobId: job.id, error: err.message });
        }
    });
    return worker;
};
exports.startTransactionImportWorker = startTransactionImportWorker;
