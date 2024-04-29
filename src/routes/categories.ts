import express, { NextFunction, Request, Response } from "express";
import categoriesLogic from "../bll/categories-logic";

const router = express.Router();

router.get("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const categories = await categoriesLogic.fetchCategoriesByUserId(user_id);
    res.status(201).json(categories);
  } catch (err: any) {
    next(err);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = req.body;
    const addedCategory = await categoriesLogic.addNewCategory(category);
    res.status(201).json(addedCategory);
  } catch (err: any) {
    next(err);
  }
});

router.put("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categoryToUpdate = req.body;
    const updatedCategory = await categoriesLogic.updateCategory(categoryToUpdate);
    res.status(201).json(updatedCategory);
  } catch (err: any) {
    next(err);
  }
});

router.delete("/:category_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category_id = req.params.category_id;
    await categoriesLogic.removeCategory(category_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;