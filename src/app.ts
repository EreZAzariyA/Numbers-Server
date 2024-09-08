import cors from "cors";
import express, { Response } from "express";
import config from "./utils/config";
import connectToMongoDB from "./dal/dal";
import errorsHandler from "./middlewares/errors-handler";
import verifyToken from "./middlewares/verify-token";
import authenticationRouter from "./routes/authentication";
import usersRouter from "./routes/users";
import transactionsRouter from "./routes/transactions";
import categoriesRouter from "./routes/categories";
import bankRouter from "./routes/bank";

const app = express();
app.use(express.json());
app.use(cors({
  origin: ['http://127.0.0.1:3000', 'http://localhost:3000', 'https://ea-numbers.vercel.app'],
  credentials: true
}));

app.use('/api/auth', authenticationRouter);
app.use('/api/users', verifyToken, usersRouter);
app.use('/api/transactions', verifyToken, transactionsRouter);
app.use('/api/categories', verifyToken, categoriesRouter);
app.use('/api/banks', verifyToken, bankRouter);

app.use("*", (_, res: Response) => {
  res.status(404).send('Route Not Found');
});

app.listen(config.port, () => {
  console.log(`Listening on port: ${config.port}, isProduction: ${config.isProduction}`);
  connectToMongoDB().then((collectionName) => {
    console.log(`Successfully connected to: ${collectionName}`);
  });
});

app.use(errorsHandler);

export default app;