import express, { NextFunction, Request, Response } from "express";
import { UserModel, CredentialsModel } from "../models";
import { authLogic } from "../bll";
import jwtService from "../utils/jwt";

const router = express.Router();

router.post("/signup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = new UserModel(req.body);
    const tokens = await authLogic.signup(user);
    res.status(201).json(tokens);
  } catch (err: any) {
    next(err);
  }
});

router.post("/signin", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const credentials = new CredentialsModel(req.body);
    const tokens = await authLogic.signin(credentials);
    res.status(201).json(tokens);
  } catch (err: any) {
    next(err);
  }
});

router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const payload = jwtService.verifyRefreshToken(refreshToken);
      if (payload?._id) {
        await authLogic.logout(payload._id);
      }
    }
    res.sendStatus(201);
  } catch (err: any) {
    next(err);
  }
});

router.post("/google", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credential, clientId } = req.body
    const tokens = await authLogic.google(credential, clientId);
    res.status(201).json(tokens);
  } catch (err: any) {
    next(err);
  }
});

router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    const tokens = await authLogic.refresh(refreshToken);
    res.json(tokens);
  } catch (err: any) {
    next(err);
  }
});

export default router;
