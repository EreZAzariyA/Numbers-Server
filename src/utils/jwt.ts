import { Request } from "express";
import jwt, { VerifyErrors } from "jsonwebtoken";
import config from "./config";
import cacheService from "./cache-service";
import { ClientError, IUserModel } from "../models";
import { usersLogic } from "../bll";
import { ErrorMessages, UserBankCredentials } from "./helpers";

class JWTServices {
  private secretKey: string = config.secretKey;

  public getNewToken(user: IUserModel, customExpiresIn?: number): string {
    const token = jwt.sign(user, this.secretKey, { expiresIn: customExpiresIn || config.loginExpiresIn });
    return token;
  };
  
  public createNewToken(data: any, customExpiresIn?: number): string {
    const token = jwt.sign(data, this.secretKey, { expiresIn: customExpiresIn || config.loginExpiresIn });
    return token;
  };  

  public verifyToken(request: Request): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const token = request.headers.authorization?.substring(7);
        if (!token) {
          const error = new ClientError(401, 'No token provide');
          reject(error);
        }

        jwt.verify(token, this.secretKey, async (err: VerifyErrors, decoded: IUserModel) => {
          if (err) {
            const error = new ClientError(401, ErrorMessages.TOKEN_EXPIRED);
            reject(error);
            return;
          }

          const user: IUserModel = decoded;
          if (user?._id && typeof user._id === 'string') {
            const cacheKey = `user-profile:${user._id}`;
            let userPro = await cacheService.get<IUserModel>(cacheKey);
            if (!userPro) {
              userPro = await usersLogic.fetchUserProfile(user._id);
              if (userPro) {
                await cacheService.set(cacheKey, userPro, 300);
              }
            }
            if (!userPro) {
              reject(new ClientError(401, 'User profile not found. Try to reconnect.'));
              return;
            }
          }

          resolve(!!token);
        });
      }
      catch (err: any) {
        reject(err);
      }
    });
  };

  public getUserFromToken(request: Request): IUserModel {
    const token = request.headers.authorization.substring(7);
    const payload = jwt.decode(token);
    const user = (payload as IUserModel);
    return user;
  };

  public getUserFromTokenString(token: string): IUserModel {
    const payload = jwt.decode(token);
    const user = (payload as IUserModel);
    return user;
  };

  public async fetchBankCredentialsFromToken(token: string): Promise<UserBankCredentials> {
    const payload = jwt.decode(token);
    return (payload as any);
  };

  public createRefreshToken(userId: string): string {
    return jwt.sign({ _id: userId }, this.secretKey, { expiresIn: config.refreshTokenExpiresIn });
  };

  public verifyRefreshToken(token: string): { _id: string } | null {
    try {
      return jwt.verify(token, this.secretKey) as { _id: string };
    } catch {
      return null;
    }
  };
};

const jwtService = new JWTServices();
export default jwtService;