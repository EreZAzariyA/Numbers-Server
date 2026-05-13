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
exports.scheduleNightlyRefresh = void 0;
const bullmq_1 = require("bullmq");
const queues_1 = require("../queues");
const collections_1 = require("../collections");
const jwt_1 = __importDefault(require("../utils/jwt"));
const config_1 = __importDefault(require("../utils/config"));
let nightlyQueue = null;
const getNightlyQueue = () => {
    if (!nightlyQueue) {
        nightlyQueue = new bullmq_1.Queue('nightly-refresh', {
            connection: (0, queues_1.getRedisConnection)(),
            defaultJobOptions: {
                removeOnComplete: { age: 86400 },
                removeOnFail: { age: 86400 * 7 },
            },
        });
    }
    return nightlyQueue;
};
const processNightlyRefresh = (_job) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    config_1.default.log.info('Nightly bank refresh started');
    const accounts = yield collections_1.Accounts.find({ banks: { $exists: true, $ne: [] } }).lean().exec();
    const scrapingQueue = (0, queues_1.getScrapingQueue)();
    let queued = 0;
    for (const account of accounts) {
        for (const bank of account.banks) {
            if (!bank.credentials)
                continue;
            try {
                const decoded = yield jwt_1.default.fetchBankCredentialsFromToken(bank.credentials);
                if (!decoded)
                    continue;
                const jobData = {
                    user_id: account.user_id.toString(),
                    bank_id: (_a = bank._id) === null || _a === void 0 ? void 0 : _a.toString(),
                    companyId: decoded.companyId,
                    credentials: {
                        companyId: decoded.companyId,
                        id: decoded.id,
                        password: decoded.password,
                        num: decoded.num,
                        save: decoded.save,
                        username: decoded.username,
                    },
                    isRefresh: true,
                };
                yield scrapingQueue.add('nightly-refresh', jobData);
                queued++;
            }
            catch (err) {
                config_1.default.log.error({ user_id: account.user_id, bank_id: bank._id }, `Failed to queue nightly refresh for bank: ${err.message}`);
            }
        }
    }
    config_1.default.log.info(`Nightly refresh queued ${queued} bank scraping jobs`);
    // Trigger pattern recompute for each user after nightly bank import.
    if (config_1.default.enablePatternPersistence) {
        for (const account of accounts) {
            try {
                yield (0, queues_1.enqueuePatternRecompute)(account.user_id.toString());
            }
            catch (err) {
                config_1.default.log.warn({ user_id: account.user_id }, `Failed to enqueue nightly pattern recompute: ${err.message}`);
            }
        }
        config_1.default.log.info(`Nightly pattern recompute enqueued for ${accounts.length} users`);
    }
});
const scheduleNightlyRefresh = () => __awaiter(void 0, void 0, void 0, function* () {
    const nightlyQueue = getNightlyQueue();
    // Remove stale repeatable jobs from previous startups (idempotent)
    const repeatableJobs = yield nightlyQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        yield nightlyQueue.removeRepeatableByKey(job.key);
    }
    yield nightlyQueue.add('nightly-refresh-trigger', {}, {
        repeat: { pattern: '0 2 * * *' },
    });
    const worker = new bullmq_1.Worker('nightly-refresh', processNightlyRefresh, {
        connection: (0, queues_1.getRedisConnection)(),
        concurrency: 1,
    });
    worker.on('completed', () => {
        config_1.default.log.info('Nightly bank refresh job completed');
    });
    worker.on('failed', (_job, err) => {
        config_1.default.log.error(`Nightly refresh job failed: ${err.message}`);
    });
    config_1.default.log.info('Nightly bank refresh scheduled (daily at 02:00)');
    return worker;
});
exports.scheduleNightlyRefresh = scheduleNightlyRefresh;
