import { googleClient } from "../dal";
import { IUserModel, ClientError, CredentialsModel, UserModel } from "../models";
import { comparePassword, encryptPassword } from "../utils/bcrypt-utils";
import cacheService from "../utils/cache-service";
import { isRedisAvailable, redisClient } from "../utils/connectRedis";
import config from "../utils/config";
import google from "../utils/google";
import { ErrorMessages, MAX_LOGIN_ATTEMPTS, removeServicesFromUser } from "../utils/helpers";
import jwtService from "../utils/jwt";
import {
  logRedisFeatureMode,
  logRedisOperationFailure,
} from "../utils/redis-runtime";

const client = googleClient;

interface AuthTokens {
  token: string;
  refreshToken: string;
}

class AuthenticationLogic {
  private async issueTokens(user: IUserModel): Promise<AuthTokens> {
    const token = jwtService.getNewToken(user);
    const refreshToken = jwtService.createRefreshToken(user._id.toString());
    if (isRedisAvailable()) {
      try {
        await redisClient.set(`refresh:${user._id}`, refreshToken, { EX: config.refreshTokenExpiresIn });
        logRedisFeatureMode('auth-session-persistence', true, {
          availableMessage: 'Redis-backed session persistence is available again.',
          unavailableMessage: 'Redis-backed session persistence is unavailable; refresh and logout are degraded.',
          unavailableLevel: 'warn',
        });
      } catch (err: any) {
        logRedisFeatureMode('auth-session-persistence', false, {
          availableMessage: 'Redis-backed session persistence is available again.',
          unavailableMessage: 'Redis-backed session persistence is unavailable; refresh and logout are degraded.',
          unavailableLevel: 'warn',
        });
        logRedisOperationFailure('auth-session-persistence', 'set-refresh-token', err, {
          user_id: user._id?.toString?.(),
        });
      }
    } else {
      logRedisFeatureMode('auth-session-persistence', false, {
        availableMessage: 'Redis-backed session persistence is available again.',
        unavailableMessage: 'Redis-backed session persistence is unavailable; refresh and logout are degraded.',
        unavailableLevel: 'warn',
      });
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
    if (!isRedisAvailable()) {
      logRedisFeatureMode('auth-login-attempts', false, {
        availableMessage: 'Redis-backed login-attempt tracking is available again.',
        unavailableMessage: 'Redis-backed login-attempt tracking is unavailable; shared login throttling is degraded.',
        unavailableLevel: 'warn',
      });
      return 0;
    }
    const attempts = await redisClient.get(`login-attempts:${email}`);
    return attempts ? parseInt(attempts, 10) : 0;
  }

  private async incrementLoginAttempts(email: string): Promise<void> {
    if (!isRedisAvailable()) {
      logRedisFeatureMode('auth-login-attempts', false, {
        availableMessage: 'Redis-backed login-attempt tracking is available again.',
        unavailableMessage: 'Redis-backed login-attempt tracking is unavailable; shared login throttling is degraded.',
        unavailableLevel: 'warn',
      });
      return;
    }
    const key = `login-attempts:${email}`;
    await redisClient.incr(key);
    await redisClient.expire(key, 15 * 60);
  }

  private async clearLoginAttempts(email: string): Promise<void> {
    if (!isRedisAvailable()) return;
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

  google = async (credential: string): Promise<AuthTokens> => {
    // Pin the audience to our own client id from server config. Never trust a
    // client-supplied audience: doing so would accept Google ID tokens minted for
    // other OAuth apps, enabling account takeover by token replay.
    const loginTicket = await client.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const payload = loginTicket.getPayload();
    const email = payload.email;

    if (!email) {
      throw new ClientError(400, 'Some error while trying to get the user email');
    }

    // Only trust an email Google has verified — an unverified address could belong
    // to someone else and would otherwise match an existing account.
    if (!payload.email_verified) {
      throw new ClientError(400, ErrorMessages.GOOGLE_EMAIL_NOT_VERIFIED);
    }

    const isSigned = await UserModel.exists({ 'emails.email': email }).exec();
    let user: IUserModel = null;

    if (isSigned) {
      user = await UserModel.findOne({ 'emails.email': email }).select('-services').exec();
    } else {
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

    const payload = jwtService.verifyRefreshToken(refreshToken);
    if (!payload?._id) {
      throw new ClientError(401, ErrorMessages.TOKEN_EXPIRED);
    }

    // When Redis is up, enforce the server-side allowlist so revoked refresh
    // tokens are rejected. When Redis is down we degrade gracefully: a
    // cryptographically valid, unexpired refresh token is still accepted, so a
    // Redis outage no longer logs every active user out on page refresh. The
    // accepted tradeoff is that logout/revocation cannot take effect while
    // Redis is unavailable.
    if (isRedisAvailable()) {
      const stored = await redisClient.get(`refresh:${payload._id}`);
      if (stored !== refreshToken) {
        throw new ClientError(401, ErrorMessages.TOKEN_EXPIRED);
      }
    } else {
      logRedisFeatureMode('auth-session-refresh', false, {
        availableMessage: 'Redis-backed session refresh validation is available again.',
        unavailableMessage: 'Redis is unavailable; refreshing sessions without server-side revocation checks.',
        unavailableLevel: 'warn',
      });
    }

    const user = await UserModel.findById(payload._id).select('-services').exec();
    if (!user) {
      throw new ClientError(401, 'User not found');
    }

    // Issue a fresh access token but keep the existing refresh token. Rotating it
    // here would invalidate concurrent refreshes — e.g. React StrictMode firing
    // the startup refresh twice, or the response interceptor retrying a 401 while
    // the page-load refresh is still in flight — logging the user straight back out.
    const token = jwtService.getNewToken(user);
    return { token, refreshToken };
  };

  logout = async (userId: string): Promise<void> => {
    // Best-effort revocation: drop the server-side refresh token when Redis is
    // reachable. If Redis is down we skip it — the caller still clears the
    // client cookie, so the session ends on this device regardless.
    if (isRedisAvailable()) {
      await redisClient.del(`refresh:${userId}`);
    }
  };
};

const authLogic = new AuthenticationLogic();
export default authLogic;
