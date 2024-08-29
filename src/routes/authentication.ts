import express, { NextFunction, Request, Response } from "express";
import authLogic from "../bll/auth-logic";
import CredentialsModel from "../models/credentials-model";
import { UserModel } from "../models/user-model";

const router = express.Router();

router.post("/signup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = new UserModel(req.body);
    const token = await authLogic.signup(user);
    res.status(201).json(token);
  } catch (err: any) {
    next(err);
  }
});

router.post("/signin", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const credentials = new CredentialsModel(req.body);
    const token = await authLogic.signin(credentials);
    if (!!token) {
      res.status(201).json(token);
    } else {
      res.status(401);
    }
  } catch (err: any) {
    next(err);
  }
});

router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict'
    });
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

router.post("/google", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await authLogic.google(req.body);
    res.status(201).json(token);
  } catch (err: any) {
    next(err);
  }
});

export default router;