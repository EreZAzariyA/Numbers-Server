import express, { NextFunction, Request, Response } from "express";
import { CategoryModel } from "../models/category-model";
import { categoriesLogic } from "../bll";

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

router.post("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const categoryName = req.body.categoryName;
    const addedCategory = await categoriesLogic.addNewCategory(categoryName, user_id);
    res.status(201).json(addedCategory);
  } catch (err: any) {
    next(err);
  }
});

router.put("/:user_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const categoryToUpdate = new CategoryModel(req.body);
    const updatedCategory = await categoriesLogic.updateCategory(categoryToUpdate, user_id);
    res.status(201).json(updatedCategory);
  } catch (err: any) {
    next(err);
  }
});

router.delete("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category_id, user_id } = req.body;
    await categoriesLogic.removeCategory(category_id, user_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;