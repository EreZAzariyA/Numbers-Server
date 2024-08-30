import { Request } from "express";
import jwt, { VerifyErrors } from "jsonwebtoken";
import config from "./config";
import { IUserModel } from "../models/user-model";
import { UserBankCredentialModel } from "../bll/banks";

const secretKey = config.secretKey;

function getNewToken(user: IUserModel, customExpiresIn?: string): string {
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
      const token = request.headers.authorization?.substring(7);
      if (!token) {
        reject('No token provide');
      }

      jwt.verify(token, secretKey, (err: VerifyErrors) => {
        if (err) {
          reject(err.message);
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
  const user = (payload as IUserModel);
  return user;
};

function getUserFromTokenString(token: string): IUserModel {
  const payload = jwt.decode(token);
  const user = (payload as IUserModel);
  return user;
};

async function fetchBankCredentialsFromToken(token: string): Promise<UserBankCredentialModel> {
  const payload = jwt.decode(token);
  return (payload as any);
};

export default {
  getNewToken,
  createNewToken,
  verifyToken,
  getUserFromToken,
  fetchBankCredentialsFromToken,
  getUserFromTokenString
};
