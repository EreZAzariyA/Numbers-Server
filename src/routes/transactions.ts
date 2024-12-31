import express, { NextFunction, Request, Response } from "express";
import transactionsLogic from "../bll/transactions";

type RequestBody = {
  type: string;
  query: object;
};

const router = express.Router();

router.get("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const { type = null, query = {} }: Partial<RequestBody>  = req.query;
    const { transactions, total } = await transactionsLogic.fetchUserTransactions(user_id, query, type);
    res.status(201).json({ transactions, total });
  } catch (err: any) {
    next(err);
  }
});

router.post("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const transaction = req.body;
    const addedTransaction = await transactionsLogic.newTransaction(user_id, transaction);
    res.status(201).json(addedTransaction);
  } catch (err: any) {
    next(err);
  }
});

router.put("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transaction = req.body;
    const updatedTransaction = await transactionsLogic.updateTransaction(transaction);
    res.status(201).json(updatedTransaction);
  } catch (err: any) {
    next(err);
  }
});

router.delete("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transaction_id } = req.body;
    await transactionsLogic.removeTransaction(transaction_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;