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
exports.startPatternRecomputeWorker = void 0;
const bullmq_1 = require("bullmq");
const queues_1 = require("../queues");
const pattern_service_1 = require("../bll/recurring/pattern-service");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const socket_1 = require("../dal/socket");
const config_1 = __importDefault(require("../utils/config"));
const processPatternRecompute = (job) => __awaiter(void 0, void 0, void 0, function* () {
    const { user_id } = job.data;
    config_1.default.log.info({ user_id, jobId: job.id }, 'Pattern recompute started');
    yield (0, pattern_service_1.recomputePatterns)(user_id);
    // Invalidate caches that depend on patterns.
    yield Promise.all([
        cache_service_1.default.del(`cashFlow:${user_id}`),
        cache_service_1.default.del(`patterns:${user_id}`),
    ]);
    // Notify connected FE clients so they can refetch.
    socket_1.socketIo.emitToUser(user_id, 'patterns:updated', { updatedAt: new Date().toISOString() });
    config_1.default.log.info({ user_id, jobId: job.id }, 'Pattern recompute completed');
});
const startPatternRecomputeWorker = () => {
    const worker = new bullmq_1.Worker('pattern-recompute', processPatternRecompute, {
        connection: (0, queues_1.getRedisConnection)(),
        concurrency: 2,
    });
    worker.on('completed', (job) => {
        config_1.default.log.info(`Pattern recompute job ${job.id} completed`);
    });
    worker.on('failed', (job, err) => {
        config_1.default.log.error(`Pattern recompute job ${job === null || job === void 0 ? void 0 : job.id} failed: ${err.message}`);
    });
    return worker;
};
exports.startPatternRecomputeWorker = startPatternRecomputeWorker;
