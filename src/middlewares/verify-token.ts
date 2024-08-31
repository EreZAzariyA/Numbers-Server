import { NextFunction, Request, Response } from "express";
import ClientError from "../models/client-error";
import jwt from "../utils/jwt";

const verifyToken = async(req: Request, res: Response, next: NextFunction):Promise<void> => {
  try {
    const isValid = await jwt.verifyToken(req);
    if (!isValid) {
      const error = new ClientError(401, "Invalid or expired token");
      next(error);
    }
  } catch (err: any) {
    next(err);
  }

  next();
};

export default verifyToken;
