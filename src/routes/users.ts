import express, { NextFunction, Request, Response } from "express";
import usersLogic from "../bll/users";

const router = express.Router();

router.put('/:user_id/theme', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const themeColor = req.body.theme;
    await usersLogic.changeTheme(user_id, themeColor);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

router.put('/:user_id/lang', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const lang = req.body.lang;
    await usersLogic.changeLang(user_id, lang);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;