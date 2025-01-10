import express, { NextFunction, Request, Response } from "express";
import transactionsLogic, { TransactionParams } from "../bll/transactions";

type RequestBody = {
  type: string;
  query: TransactionParams;
};

const router = express.Router();

router.get("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { type = null, query }: Partial<RequestBody>  = req.query;
    const { transactions, total } = await transactionsLogic.fetchUserTransactions(user_id, query, type);
    res.status(201).json({ transactions, total });
  } catch (err: any) {
    next(err);
  }
});

router.post("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { transaction, type } = req.body;
    const addedTransaction = await transactionsLogic.newTransaction(user_id, transaction, type);
    res.status(201).json(addedTransaction);
  } catch (err: any) {
    next(err);
  }
});

router.put("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { transaction, type } = req.body;
    const updatedTransaction = await transactionsLogic.updateTransaction(user_id, transaction, type);
    res.status(201).json(updatedTransaction);
  } catch (err: any) {
    next(err);
  }
});

router.delete("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, transaction_id, type } = req.body;
    await transactionsLogic.removeTransaction(user_id, transaction_id, type);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;