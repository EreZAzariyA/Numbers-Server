import { NextFunction, Request, Response } from 'express';
import { ClientError } from '../models';
import jwt from '../utils/jwt';

const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const user = jwt.getUserFromToken(req);
    if ((user as unknown as { role?: string }).role !== 'admin') {
      next(new ClientError(403, 'Admin access required.'));
      return;
    }
    next();
  } catch (err: unknown) {
    next(err);
  }
};

export default requireAdmin;
