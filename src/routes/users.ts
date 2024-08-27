import express, { NextFunction, Request, Response } from "express";
import usersLogic from "../bll/users";

const router = express.Router();

router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const user = await usersLogic.getUserById(user_id);
    res.status(200).json(user);
  } catch (err: any) {
    next(err);
  }
});

router.put('/config/theme', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { theme, user_id } = req.body;
    const selectedTheme = await usersLogic.changeTheme(user_id, theme);
    res.status(200).json(selectedTheme);
  } catch (err: any) {
    next(err);
  }
});

router.put('/config/language', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {user_id, language } = req.body;
    const selectedLang = await usersLogic.changeLang(user_id, language);
    res.status(200).json(selectedLang);
  } catch (err: any) {
    next(err);
  }
});

export default router;