import express, { NextFunction, Request, Response } from "express";
import transactionsLogic from "../bll/transactions";

const router = express.Router();

router.get("/:user_id", async (req: Request, res: Response, next: NextFunction) => {  
  try {
    const user_id = req.params.user_id;
    const transactions = await transactionsLogic.fetchUserTransactions(user_id);
    res.status(201).json(transactions);
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

router.put("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const transaction = req.body;
    const updatedTransaction = await transactionsLogic.updateTransaction(user_id, transaction);
    res.status(201).json(updatedTransaction);
  } catch (err: any) {
    next(err);
  }
});

router.delete("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transaction_id, user_id } = req.body;
    await transactionsLogic.removeTransaction(transaction_id, user_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;