import { NextFunction, Request, Response } from "express";
import ClientError from "../models/client-error";
import jwt from "../utils/jwt";

const verifyToken = async(req: Request, res: Response, next: NextFunction):Promise<void> => {
  try {
    const isValid = await jwt.verifyToken(req);
    if (!isValid) {
      next(new ClientError(401, "Invalid or expired token"));
      return;
    }
    next();
  } catch (err: any) {
    next(err);
  }
};

export default verifyToken;
