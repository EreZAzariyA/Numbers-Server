require('dotenv').config();
import cors from "cors";
import express, { Response } from "express";
import config from "./utils/config";
import { connectToMongoDB } from "./dal";
import { errorsHandler, verifyToken } from "./middlewares";
import {
  authenticationRouter,
  bankRouter,
  categoriesRouter,
  transactionsRouter,
  usersRouter,
} from './routes';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  credentials: true,
  origin: config.corsUrls,
  methods: "GET, HEAD, PUT, PATCH, POST, DELETE"
}));

app.use('/api/auth', authenticationRouter);
app.use('/api/users', verifyToken, usersRouter);
app.use('/api/transactions', verifyToken, transactionsRouter);
app.use('/api/categories', verifyToken, categoriesRouter);
app.use('/api/banks', verifyToken, bankRouter);

app.use("*", (_, res: Response) => {
  res.status(404).send('Route Not Found');
});

if (config.isProduction) {
  if (isNaN(config.port)) {
    config.log.warn({ PORT: config.port }, 'Invalid port number');
    process.exit(0);
  };
  if (!config.mongoConnectionString) {
    config.log.warn({ MONGO_CONNECTION_STRING: config.mongoConnectionString }, 'Mongo connection string is missing');
    process.exit(0);
  };
  if (!config.secretKey) {
    config.log.warn({ SECRET_KEY: config.secretKey }, 'Secret key is missing');
    process.exit(0);
  };
}

app.listen(config.port, () => {
  config.log.info(`Listening on port: ${config.port}, isProduction: ${config.isProduction}`);

  connectToMongoDB().then((collectionName) => {
    config.log.info(`Successfully connected to: ${collectionName}`);
  });
});

app.use(errorsHandler);

export default app;