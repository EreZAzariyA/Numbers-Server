import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import connectToMongoDB from "./dal/dal";
import errorsHandler from "./middlewares/errors-handler";
import authenticationRouter from "./routes/authentication";
import usersRouter from "./routes/users";
import invoicesRouter from "./routes/invoices";
import categoriesRouter from "./routes/categories";
import bankRouter from "./routes/bank";
import verifyToken from "./middlewares/verify-token";
import config from "./utils/config";

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authenticationRouter);
app.use('/api/user', verifyToken, usersRouter);
app.use('/api/invoices', verifyToken, invoicesRouter);
app.use('/api/categories', verifyToken, categoriesRouter);
app.use('/api/bank-account', verifyToken, bankRouter);

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