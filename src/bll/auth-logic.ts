import { googleClient } from "../dal";
import { IUserModel, ClientError, CredentialsModel, UserModel } from "../models";
import { comparePassword, encryptPassword } from "../utils/bcrypt-utils";
import cacheService from "../utils/cache-service";
import { isRedisAvailable, redisClient } from "../utils/connectRedis";
import config from "../utils/config";
import google from "../utils/google";
import { ErrorMessages, MAX_LOGIN_ATTEMPTS, removeServicesFromUser } from "../utils/helpers";
import jwtService from "../utils/jwt";

const client = googleClient;

interface AuthTokens {
  token: string;
  refreshToken: string;
}

class AuthenticationLogic {
  private ensureRedisBackedSession(action: string): void {
    if (!isRedisAvailable()) {
      throw new ClientError(503, `${action} is temporarily unavailable. Please try again later.`);
    }
  }

  private async issueTokens(user: IUserModel): Promise<AuthTokens> {
    const token = jwtService.getNewToken(user);
    const refreshToken = jwtService.createRefreshToken(user._id.toString());
    if (isRedisAvailable()) {
      await redisClient.set(`refresh:${user._id}`, refreshToken, { EX: config.refreshTokenExpiresIn });
    }
    return { token, refreshToken };
  }

  signup = async (user: IUserModel): Promise<AuthTokens> => {
    const newEncryptedPassword: string = await encryptPassword(user.services.password);
    user.services.password = newEncryptedPassword;

    const errors = user.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    const savedUser = await user.save();
    const userWithoutServices = removeServicesFromUser(savedUser);
    return this.issueTokens(userWithoutServices);
  };

  private async getLoginAttempts(email: string): Promise<number> {
    if (!redisClient.isOpen) return 0;
    const attempts = await redisClient.get(`login-attempts:${email}`);
    return attempts ? parseInt(attempts, 10) : 0;
  }

  private async incrementLoginAttempts(email: string): Promise<void> {
    if (!redisClient.isOpen) return;
    const key = `login-attempts:${email}`;
    await redisClient.incr(key);
    await redisClient.expire(key, 15 * 60);
  }

  private async clearLoginAttempts(email: string): Promise<void> {
    if (!redisClient.isOpen) return;
    await redisClient.del(`login-attempts:${email}`);
  }

  signin = async (credentials: CredentialsModel): Promise<AuthTokens> => {
    const user = await UserModel.findOne({ 'emails.email': credentials.email }).exec();
    if (!user) {
      throw new ClientError(400, ErrorMessages.INCORRECT_PASSWORD);
    }

    const attempts = await this.getLoginAttempts(credentials.email);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      throw new ClientError(500, ErrorMessages.MAX_LOGIN_ATTEMPTS);
    }

    const passwordMatch = await comparePassword(credentials.password, user.services.password || '');
    if (!passwordMatch) {
      await this.incrementLoginAttempts(credentials.email);
      throw new ClientError(400, ErrorMessages.INCORRECT_PASSWORD);
    }

    await this.clearLoginAttempts(credentials.email);
    await cacheService.del(`user-profile:${user._id}`);

    const userWithoutServices = removeServicesFromUser(user);
    return this.issueTokens(userWithoutServices);
  };

  google = async (credential: string, clientId: string): Promise<AuthTokens> => {
    const loginTicket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const email = loginTicket.getPayload().email;

    if (!email) {
      throw new ClientError(400 ,'Some error while trying to get the user email')
    }

    const isSigned = await UserModel.exists({ 'emails.email': email }).exec();
    let user: IUserModel = null;

    if (isSigned) {
      user = await UserModel.findOne({ 'emails.email': email }).select('-services').exec();
    } else {
      const payload = loginTicket.getPayload();
      user = await google.createUserForGoogleAccounts(payload);
    }
    if (!user) {
      throw new ClientError(500, ErrorMessages.SOME_ERROR);
    }

    const userWithoutServices = removeServicesFromUser(user);
    return this.issueTokens(userWithoutServices);
  };

  refresh = async (refreshToken: string): Promise<AuthTokens> => {
    if (!refreshToken) {
      throw new ClientError(401, ErrorMessages.TOKEN_EXPIRED);
    }
    this.ensureRedisBackedSession('Session refresh');

    const payload = jwtService.verifyRefreshToken(refreshToken);
    if (!payload?._id) {
      throw new ClientError(401, ErrorMessages.TOKEN_EXPIRED);
    }

    const stored = await redisClient.get(`refresh:${payload._id}`);
    if (stored !== refreshToken) {
      throw new ClientError(401, ErrorMessages.TOKEN_EXPIRED);
    }

    const user = await UserModel.findById(payload._id).select('-services').exec();
    if (!user) {
      throw new ClientError(401, 'User not found');
    }

    return this.issueTokens(user);
  };

  logout = async (userId: string): Promise<void> => {
    this.ensureRedisBackedSession('Logout');
    await redisClient.del(`refresh:${userId}`);
  };
};

const authLogic = new AuthenticationLogic();
export default authLogic;
