import { Request } from "express";
import jwt, { JwtPayload, VerifyErrors } from "jsonwebtoken";
import config from "./config";
import { IUserModel } from "../models/user-model";

const secretKey = config.secretKey;

function getNewToken(user: Partial<IUserModel>, customExpiresIn?: string): string {
  const token = jwt.sign(user, secretKey, { expiresIn: customExpiresIn || config.loginExpiresIn });
  return token;
};

function createNewToken(data: any, customExpiresIn?: string): string {
  const token = jwt.sign(data, secretKey, { expiresIn: customExpiresIn || config.loginExpiresIn });
  return token;
};

function verifyToken(request: Request): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      if (!request.headers.authorization) {
        resolve(false);
        return;
      }
      const token = request.headers.authorization.substring(7);
      if (!token) {
        resolve(false);
        return;
      }
      jwt.verify(token, secretKey, (err: VerifyErrors, payload: JwtPayload) => { // payload = { user: { firstName: ___, } }
        if (err) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    }
    catch (err: any) {
      reject(err);
    }
  });
};

function getUserFromToken(request: Request): IUserModel {
  const token = request.headers.authorization.substring(7);
  const payload = jwt.decode(token);
  const user = (payload as any).user;
  return user;
};

export default {
  getNewToken,
  createNewToken,
  verifyToken,
  getUserFromToken
};
