import express, { NextFunction, Request, Response } from "express";
import savingsGoalsLogic from "../bll/savings-goals";
import { ISavingsGoalModel } from "../models/savings-goal-model";

const router = express.Router();

router.get("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const language = (req.query.language as string) || 'en';
    const goals = await savingsGoalsLogic.fetchGoals(user_id, language);
    res.status(200).json(goals);
  } catch (err: any) {
    next(err);
  }
});

router.post("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const goal = req.body as ISavingsGoalModel;
    const added = await savingsGoalsLogic.addGoal(user_id, goal);
    res.status(201).json(added);
  } catch (err: any) {
    next(err);
  }
});

router.put("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const goal = req.body as ISavingsGoalModel;
    const updated = await savingsGoalsLogic.updateGoal(user_id, goal);
    res.status(200).json(updated);
  } catch (err: any) {
    next(err);
  }
});

router.delete("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const { goal_id } = req.body;
    await savingsGoalsLogic.removeGoal(user_id, goal_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;
