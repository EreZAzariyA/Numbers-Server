require('dotenv').config();
import cors from "cors";
import express, { Response } from "express";
import path from "path";
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
  adminRouter,
  notificationsRouter,
} from './routes';
import { startScrapingWorker } from './workers/scraping-worker';
import { startTransactionImportWorker } from './workers/transaction-import-worker';
import { startPatternRecomputeWorker } from './workers/pattern-recompute-worker';
import { scheduleNightlyRefresh } from './workers/nightly-refresh';
import { scheduleAlertsGeneration } from './workers/alerts-generation';
import { socketIo } from './dal/socket';
import recurringOverridesRouter from './routes/recurring-overrides';
import { getRuntimeSnapshot, setWorkersEnabled } from './utils/runtime-status';
import { getRedisTarget } from './utils/connectRedis';

const app = express();
// Behind a reverse proxy (IIS/ARR). Trust the first proxy hop so that
// req.ip, req.protocol, secure cookies, and express-rate-limit use the
// real client IP from X-Forwarded-* instead of 127.0.0.1.
app.set('trust proxy', 1);
const httpServer = createServer(app);

app.use(healthRouter);
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  credentials: true,
  origin: config.corsUrls,
  methods: "GET, HEAD, PUT, PATCH, POST, DELETE"
}));
app.use('/api', globalLimiter);

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
app.use('/api/admin', verifyToken, adminRouter);
app.use('/api/notifications', verifyToken, notificationsRouter);

if (config.isProduction) {
  const publicDir = path.join(__dirname, '../../public');
  app.use(express.static(publicDir));
  app.get('*', (_, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  app.use('*', (_, res: Response) => {
    res.status(404).send('Route Not Found');
  });
}

const validateConfig = (): void => {
  if (isNaN(config.port)) {
    throw new Error('PORT environment variable is missing or is not a valid number');
  }

  if (!config.mongoConnectionString) {
    throw new Error('MONGO_CONNECTION_STRING environment variable is required');
  }

  if (!config.secretKey) {
    throw new Error('SECRET_KEY environment variable is required');
  }

  if (!config.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is required');
  }

  if (config.isProduction && !process.env.BANK_CREDENTIALS_ENCRYPTION_SECRET) {
    throw new Error(
      'BANK_CREDENTIALS_ENCRYPTION_SECRET environment variable is required in production — ' +
      'it must remain identical across deploys or previously saved bank credentials will become undecryptable'
    );
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
      if (config.workers.nightlyRefreshEnabled) {
        await scheduleNightlyRefresh();
      } else {
        config.log.info('Nightly bank refresh scheduling is disabled');
      }
      if (config.workers.alertsGenerationEnabled) {
        await scheduleAlertsGeneration();
      } else {
        config.log.info('Alert generation scheduling is disabled');
      }
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
      nightlyRefreshEnabled: config.workers.nightlyRefreshEnabled,
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
