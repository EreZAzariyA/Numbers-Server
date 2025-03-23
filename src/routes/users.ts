import express, { NextFunction, Request, Response } from "express";
import { usersLogic } from "../bll";

const router = express.Router();

router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const user = await usersLogic.fetchUserProfile(user_id);
    res.status(200).json(user);
  } catch (err: any) {
    next(err);
  }
});

router.put('/config/theme/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const theme = req.body.theme;
    const selectedTheme = await usersLogic.changeTheme(user_id, theme);
    res.status(200).json(selectedTheme);
  } catch (err: any) {
    next(err);
  }
});

router.put('/config/language/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const language = req.body.language;
    const selectedLang = await usersLogic.changeLang(user_id, language);
    res.status(200).json(selectedLang);
  } catch (err: any) {
    next(err);
  }
});

export default router;