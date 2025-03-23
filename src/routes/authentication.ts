import express, { NextFunction, Request, Response } from "express";
import { UserModel, CredentialsModel } from "../models";
import { authLogic } from "../bll";

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
    res.status(201).json(token);
  } catch (err: any) {
    next(err);
  }
});

router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.sendStatus(201);
  } catch (err: any) {
    next(err);
  }
});

router.post("/google", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credential, clientId } = req.body
    const token = await authLogic.google(credential, clientId);
    res.status(201).json(token);
  } catch (err: any) {
    next(err);
  }
});

export default router;