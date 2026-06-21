import express, { NextFunction, Request, Response } from "express";
import { UserModel, CredentialsModel } from "../models";
import { authLogic } from "../bll";
import jwtService from "../utils/jwt";
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
} from "../utils/auth-cookie";

const router = express.Router();

router.post("/signup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = new UserModel(req.body);
    const { token, refreshToken } = await authLogic.signup(user);
    setRefreshTokenCookie(req, res, refreshToken);
    res.status(201).json({ token });
  } catch (err: any) {
    next(err);
  }
});

router.post("/signin", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const credentials = new CredentialsModel(req.body);
    const { token, refreshToken } = await authLogic.signin(credentials);
    setRefreshTokenCookie(req, res, refreshToken);
    res.status(201).json({ token });
  } catch (err: any) {
    next(err);
  }
});

router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = readRefreshTokenCookie(req);
    if (refreshToken) {
      const payload = jwtService.verifyRefreshToken(refreshToken);
      if (payload?._id) {
        await authLogic.logout(payload._id);
      }
    }
    clearRefreshTokenCookie(req, res);
    res.sendStatus(201);
  } catch (err: any) {
    next(err);
  }
});

router.post("/google", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credential } = req.body;
    const { token, refreshToken } = await authLogic.google(credential);
    setRefreshTokenCookie(req, res, refreshToken);
    res.status(201).json({ token });
  } catch (err: any) {
    next(err);
  }
});

router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = readRefreshTokenCookie(req);
    const { token, refreshToken: renewedRefreshToken } = await authLogic.refresh(refreshToken);
    // Re-set the same cookie to slide its expiry forward on each active session.
    setRefreshTokenCookie(req, res, renewedRefreshToken);
    res.json({ token });
  } catch (err: any) {
    next(err);
  }
});

export default router;
