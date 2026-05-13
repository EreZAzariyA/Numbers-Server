require('dotenv').config();
import cors from "cors";
import express, { Response } from "express";
import { once } from "events";
import { createServer } from "http";
import config from "./utils/config";
import { connectToMongoDB, connectRedis } from "./dal";
import { errorsHandler, verifyToken, globalLimiter, authLimiter } from "./middlewares";
import { initializeRedisBackedRateLimiters } from "./middlewares/rate-limiter";
import healthRouter from './routes/health';
import {
  authenticationRouter,
  bankRouter,
  categoriesRouter,
  transactionsRouter,
  usersRouter,
  jobsRouter,
  forecastRouter,
  savingsGoalsRouter,
  financialHealthRouter,
  cashFlowRouter,
  agentChatRouter,
} from './routes';
import { startScrapingWorker } from './workers/scraping-worker';
import { startTransactionImportWorker } from './workers/transaction-import-worker';
import { startPatternRecomputeWorker } from './workers/pattern-recompute-worker';
import { scheduleNightlyRefresh } from './workers/nightly-refresh';
import { socketIo } from './dal/socket';
import recurringOverridesRouter from './routes/recurring-overrides';
import { getRuntimeSnapshot, setWorkersEnabled } from './utils/runtime-status';
import { getRedisTarget } from './utils/connectRedis';

const app = express();
const httpServer = createServer(app);

app.use(healthRouter);
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  credentials: true,
  origin: config.corsUrls,
  methods: "GET, HEAD, PUT, PATCH, POST, DELETE"
}));
app.use(globalLimiter);

app.use('/api/auth', authLimiter, authenticationRouter);
app.use('/api/users', verifyToken, usersRouter);
app.use('/api/transactions', verifyToken, transactionsRouter);
app.use('/api/categories', verifyToken, categoriesRouter);
app.use('/api/banks', verifyToken, bankRouter);
app.use('/api/jobs', verifyToken, jobsRouter);
app.use('/api/forecast', verifyToken, forecastRouter);
app.use('/api/savings-goals', verifyToken, savingsGoalsRouter);
app.use('/api/financial-health', verifyToken, financialHealthRouter);
app.use('/api/cash-flow', verifyToken, cashFlowRouter);
app.use('/api/recurring', verifyToken, recurringOverridesRouter);
app.use('/api/agent', verifyToken, agentChatRouter);

app.use("*", (_, res: Response) => {
  res.status(404).send('Route Not Found');
});

const validateConfig = (): void => {
  if (isNaN(config.port)) {
    throw new Error(`Invalid port number: ${config.port}`);
  }

  if (!config.mongoConnectionString) {
    throw new Error('Mongo connection string is missing');
  }

  if (!config.secretKey) {
    throw new Error('Secret key is missing');
  }
};

const bootstrap = async (): Promise<void> => {
  try {
    validateConfig();

    const collectionName = await connectToMongoDB();
    const redisAvailable = await connectRedis();
    let workersEnabled = false;

    if (redisAvailable) {
      initializeRedisBackedRateLimiters();
      startScrapingWorker();
      startTransactionImportWorker();
      if (config.enablePatternPersistence) {
        startPatternRecomputeWorker();
      }
      await scheduleNightlyRefresh();
      workersEnabled = true;
    }
    setWorkersEnabled(workersEnabled);

    socketIo.initSocketIo(httpServer);
    httpServer.listen(config.port);
    await once(httpServer, 'listening');

    const snapshot = getRuntimeSnapshot();
    const redisTarget = getRedisTarget();
    const startupDiagnostics = {
      port: config.port,
      isProduction: config.isProduction,
      mongoName: collectionName,
      redisTarget,
      redisAvailable,
      workersEnabled,
      degradedMode: snapshot.degradedMode,
      localRedisCommand: config.isProduction ? undefined : 'docker compose up -d redis',
    };

    const logMethod = snapshot.degradedMode ? 'warn' : 'info';
    config.log[logMethod](startupDiagnostics, 'Server started');
  } catch (err: any) {
    config.log.error({ err: err.message }, 'Server bootstrap failed');
    process.exit(1);
  }
};

void bootstrap();

app.use(errorsHandler);

export default app;
