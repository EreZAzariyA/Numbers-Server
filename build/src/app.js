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
require('dotenv').config();
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const events_1 = require("events");
const http_1 = require("http");
const config_1 = __importDefault(require("./utils/config"));
const dal_1 = require("./dal");
const middlewares_1 = require("./middlewares");
const rate_limiter_1 = require("./middlewares/rate-limiter");
const health_1 = __importDefault(require("./routes/health"));
const routes_1 = require("./routes");
const scraping_worker_1 = require("./workers/scraping-worker");
const transaction_import_worker_1 = require("./workers/transaction-import-worker");
const pattern_recompute_worker_1 = require("./workers/pattern-recompute-worker");
const nightly_refresh_1 = require("./workers/nightly-refresh");
const socket_1 = require("./dal/socket");
const recurring_overrides_1 = __importDefault(require("./routes/recurring-overrides"));
const runtime_status_1 = require("./utils/runtime-status");
const connectRedis_1 = require("./utils/connectRedis");
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
app.use(health_1.default);
app.use(express_1.default.json({ limit: '10mb' }));
app.use((0, cors_1.default)({
    credentials: true,
    origin: config_1.default.corsUrls,
    methods: "GET, HEAD, PUT, PATCH, POST, DELETE"
}));
app.use(middlewares_1.globalLimiter);
app.use('/api/auth', middlewares_1.authLimiter, routes_1.authenticationRouter);
app.use('/api/users', middlewares_1.verifyToken, routes_1.usersRouter);
app.use('/api/transactions', middlewares_1.verifyToken, routes_1.transactionsRouter);
app.use('/api/categories', middlewares_1.verifyToken, routes_1.categoriesRouter);
app.use('/api/banks', middlewares_1.verifyToken, routes_1.bankRouter);
app.use('/api/jobs', middlewares_1.verifyToken, routes_1.jobsRouter);
app.use('/api/forecast', middlewares_1.verifyToken, routes_1.forecastRouter);
app.use('/api/savings-goals', middlewares_1.verifyToken, routes_1.savingsGoalsRouter);
app.use('/api/financial-health', middlewares_1.verifyToken, routes_1.financialHealthRouter);
app.use('/api/cash-flow', middlewares_1.verifyToken, routes_1.cashFlowRouter);
app.use('/api/recurring', middlewares_1.verifyToken, recurring_overrides_1.default);
app.use('/api/agent', middlewares_1.verifyToken, routes_1.agentChatRouter);
app.use("*", (_, res) => {
    res.status(404).send('Route Not Found');
});
const validateConfig = () => {
    if (isNaN(config_1.default.port)) {
        throw new Error(`Invalid port number: ${config_1.default.port}`);
    }
    if (!config_1.default.mongoConnectionString) {
        throw new Error('Mongo connection string is missing');
    }
    if (!config_1.default.secretKey) {
        throw new Error('Secret key is missing');
    }
};
const bootstrap = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        validateConfig();
        const collectionName = yield (0, dal_1.connectToMongoDB)();
        const redisAvailable = yield (0, dal_1.connectRedis)();
        let workersEnabled = false;
        if (redisAvailable) {
            (0, rate_limiter_1.initializeRedisBackedRateLimiters)();
            (0, scraping_worker_1.startScrapingWorker)();
            (0, transaction_import_worker_1.startTransactionImportWorker)();
            if (config_1.default.enablePatternPersistence) {
                (0, pattern_recompute_worker_1.startPatternRecomputeWorker)();
            }
            yield (0, nightly_refresh_1.scheduleNightlyRefresh)();
            workersEnabled = true;
        }
        (0, runtime_status_1.setWorkersEnabled)(workersEnabled);
        socket_1.socketIo.initSocketIo(httpServer);
        httpServer.listen(config_1.default.port);
        yield (0, events_1.once)(httpServer, 'listening');
        const snapshot = (0, runtime_status_1.getRuntimeSnapshot)();
        const redisTarget = (0, connectRedis_1.getRedisTarget)();
        const startupDiagnostics = {
            port: config_1.default.port,
            isProduction: config_1.default.isProduction,
            mongoName: collectionName,
            redisTarget,
            redisAvailable,
            workersEnabled,
            degradedMode: snapshot.degradedMode,
            localRedisCommand: config_1.default.isProduction ? undefined : 'docker compose up -d redis',
        };
        const logMethod = snapshot.degradedMode ? 'warn' : 'info';
        config_1.default.log[logMethod](startupDiagnostics, 'Server started');
    }
    catch (err) {
        config_1.default.log.error({ err: err.message }, 'Server bootstrap failed');
        process.exit(1);
    }
});
void bootstrap();
app.use(middlewares_1.errorsHandler);
exports.default = app;
