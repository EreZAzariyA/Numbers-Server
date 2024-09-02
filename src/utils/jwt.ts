import { Request } from "express";
import jwt, { VerifyErrors } from "jsonwebtoken";
import config from "./config";
import { IUserModel } from "../models/user-model";
import { UserBankCredentialModel } from "../bll/banks";
import ClientError from "../models/client-error";
import { ErrorMessages } from "./helpers";

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
        const error = new ClientError(401, 'No token provide');
        return reject(error);
      }

      jwt.verify(token, secretKey, (err: VerifyErrors) => {
        if (err) {
          const error = new ClientError(401, ErrorMessages.TOKEN_EXPIRED);
          return reject(error);
        }

        resolve(!!token);
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
