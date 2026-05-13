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
exports.enqueuePatternRecompute = exports.getPatternRecomputeQueue = exports.getTransactionImportQueue = exports.getScrapingQueue = exports.getRedisConnection = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = __importDefault(require("../utils/config"));
const redis_runtime_1 = require("../utils/redis-runtime");
let redisConnection = null;
let scrapingQueue = null;
let transactionImportQueue = null;
let patternRecomputeQueue = null;
const createQueue = (name) => {
    const defaultOptions = {
        connection: (0, exports.getRedisConnection)(),
        defaultJobOptions: {
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        },
    };
    return new bullmq_1.Queue(name, defaultOptions);
};
const getRedisConnection = () => {
    if (!redisConnection) {
        redisConnection = new ioredis_1.default(config_1.default.redisUrl || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
            lazyConnect: true,
            enableOfflineQueue: false,
        });
        redisConnection.on('ready', () => {
            (0, redis_runtime_1.markRedisConnectionAvailable)('bullmq', { redisUrl: config_1.default.redisUrl });
        });
        redisConnection.on('error', (err) => {
            (0, redis_runtime_1.markRedisConnectionUnavailable)('bullmq', err, { redisUrl: config_1.default.redisUrl });
        });
        redisConnection.on('close', () => {
            (0, redis_runtime_1.markRedisConnectionUnavailable)('bullmq', undefined, { redisUrl: config_1.default.redisUrl });
        });
    }
    return redisConnection;
};
exports.getRedisConnection = getRedisConnection;
const getScrapingQueue = () => {
    if (!scrapingQueue) {
        scrapingQueue = createQueue('bank-scraping');
    }
    return scrapingQueue;
};
exports.getScrapingQueue = getScrapingQueue;
const getTransactionImportQueue = () => {
    if (!transactionImportQueue) {
        transactionImportQueue = createQueue('transaction-import');
    }
    return transactionImportQueue;
};
exports.getTransactionImportQueue = getTransactionImportQueue;
const getPatternRecomputeQueue = () => {
    if (!patternRecomputeQueue) {
        patternRecomputeQueue = createQueue('pattern-recompute');
    }
    return patternRecomputeQueue;
};
exports.getPatternRecomputeQueue = getPatternRecomputeQueue;
/**
 * Debounced enqueue: uses a fixed job-id per user so that rapid writes
 * within 30s coalesce into a single recompute.
 */
const enqueuePatternRecompute = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, exports.getPatternRecomputeQueue)().add('recompute-patterns', { user_id }, {
        jobId: `recompute-${user_id}`,
        delay: 5000, // 5s debounce — absorb rapid successive writes
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
    });
});
exports.enqueuePatternRecompute = enqueuePatternRecompute;
