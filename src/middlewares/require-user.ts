import { NextFunction, Request, Response } from 'express';
import { ClientError } from '../models';
import jwt from '../utils/jwt';

const getRequestUserId = (req: Request): string => {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    throw new ClientError(401, 'No token provide');
  }

  const user = jwt.getUserFromToken(req);
  const rawUserId = (user as any)?._id;
  return rawUserId?.toString?.() ?? String(rawUserId ?? '');
};

export const assertRequestUser = (req: Request, user_id: string): void => {
  const requestUserId = getRequestUserId(req);
  if (!requestUserId || requestUserId !== String(user_id)) {
    throw new ClientError(403, 'You are not allowed to access this user.');
  }
};

export const requireMatchingUserParam = (
  req: Request,
  _res: Response,
  next: NextFunction,
  user_id: string,
): void => {
  try {
    assertRequestUser(req, user_id);
    next();
  } catch (err: any) {
    next(err);
  }
};
