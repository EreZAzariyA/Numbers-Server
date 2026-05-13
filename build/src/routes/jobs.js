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
const express_1 = __importDefault(require("express"));
const queues_1 = require("../queues");
const connectRedis_1 = require("../utils/connectRedis");
const redis_runtime_1 = require("../utils/redis-runtime");
const router = express_1.default.Router();
router.get('/:jobId', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!(0, connectRedis_1.isRedisAvailable)()) {
            throw (0, redis_runtime_1.createRedisQueueUnavailableError)('job-status');
        }
        const { jobId } = req.params;
        const { queue: queueName } = req.query;
        const queue = queueName === 'transaction-import' ? (0, queues_1.getTransactionImportQueue)() : (0, queues_1.getScrapingQueue)();
        const job = yield queue.getJob(jobId);
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }
        const state = yield job.getState();
        return res.status(200).json({
            id: job.id,
            state,
            progress: job.progress,
            result: job.returnvalue,
            failedReason: job.failedReason,
        });
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
