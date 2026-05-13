"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dal_1 = require("../dal");
const models_1 = require("../models");
const bcrypt_utils_1 = require("../utils/bcrypt-utils");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const connectRedis_1 = require("../utils/connectRedis");
const config_1 = __importDefault(require("../utils/config"));
const google_1 = __importDefault(require("../utils/google"));
const helpers_1 = require("../utils/helpers");
const jwt_1 = __importDefault(require("../utils/jwt"));
const redis_runtime_1 = require("../utils/redis-runtime");
const client = dal_1.googleClient;
class AuthenticationLogic {
    constructor() {
        this.signup = (user) => __awaiter(this, void 0, void 0, function* () {
            const newEncryptedPassword = yield (0, bcrypt_utils_1.encryptPassword)(user.services.password);
            user.services.password = newEncryptedPassword;
            const errors = user.validateSync();
            if (errors) {
                throw new models_1.ClientError(500, errors.message);
            }
            const savedUser = yield user.save();
            const userWithoutServices = (0, helpers_1.removeServicesFromUser)(savedUser);
            return this.issueTokens(userWithoutServices);
        });
        this.signin = (credentials) => __awaiter(this, void 0, void 0, function* () {
            const user = yield models_1.UserModel.findOne({ 'emails.email': credentials.email }).exec();
            if (!user) {
                throw new models_1.ClientError(400, helpers_1.ErrorMessages.INCORRECT_PASSWORD);
            }
            const attempts = yield this.getLoginAttempts(credentials.email);
            if (attempts >= helpers_1.MAX_LOGIN_ATTEMPTS) {
                throw new models_1.ClientError(500, helpers_1.ErrorMessages.MAX_LOGIN_ATTEMPTS);
            }
            const passwordMatch = yield (0, bcrypt_utils_1.comparePassword)(credentials.password, user.services.password || '');
            if (!passwordMatch) {
                yield this.incrementLoginAttempts(credentials.email);
                throw new models_1.ClientError(400, helpers_1.ErrorMessages.INCORRECT_PASSWORD);
            }
            yield this.clearLoginAttempts(credentials.email);
            yield cache_service_1.default.del(`user-profile:${user._id}`);
            const userWithoutServices = (0, helpers_1.removeServicesFromUser)(user);
            return this.issueTokens(userWithoutServices);
        });
        this.google = (credential, clientId) => __awaiter(this, void 0, void 0, function* () {
            const loginTicket = yield client.verifyIdToken({ idToken: credential, audience: clientId });
            const email = loginTicket.getPayload().email;
            if (!email) {
                throw new models_1.ClientError(400, 'Some error while trying to get the user email');
            }
            const isSigned = yield models_1.UserModel.exists({ 'emails.email': email }).exec();
            let user = null;
            if (isSigned) {
                user = yield models_1.UserModel.findOne({ 'emails.email': email }).select('-services').exec();
            }
            else {
                const payload = loginTicket.getPayload();
                user = yield google_1.default.createUserForGoogleAccounts(payload);
            }
            if (!user) {
                throw new models_1.ClientError(500, helpers_1.ErrorMessages.SOME_ERROR);
            }
            const userWithoutServices = (0, helpers_1.removeServicesFromUser)(user);
            return this.issueTokens(userWithoutServices);
        });
        this.refresh = (refreshToken) => __awaiter(this, void 0, void 0, function* () {
            if (!refreshToken) {
                throw new models_1.ClientError(401, helpers_1.ErrorMessages.TOKEN_EXPIRED);
            }
            this.ensureRedisBackedSession('Session refresh');
            const payload = jwt_1.default.verifyRefreshToken(refreshToken);
            if (!(payload === null || payload === void 0 ? void 0 : payload._id)) {
                throw new models_1.ClientError(401, helpers_1.ErrorMessages.TOKEN_EXPIRED);
            }
            const stored = yield connectRedis_1.redisClient.get(`refresh:${payload._id}`);
            if (stored !== refreshToken) {
                throw new models_1.ClientError(401, helpers_1.ErrorMessages.TOKEN_EXPIRED);
            }
            const user = yield models_1.UserModel.findById(payload._id).select('-services').exec();
            if (!user) {
                throw new models_1.ClientError(401, 'User not found');
            }
            return this.issueTokens(user);
        });
        this.logout = (userId) => __awaiter(this, void 0, void 0, function* () {
            this.ensureRedisBackedSession('Logout');
            yield connectRedis_1.redisClient.del(`refresh:${userId}`);
        });
    }
    ensureRedisBackedSession(action) {
        if (!(0, connectRedis_1.isRedisAvailable)()) {
            throw (0, redis_runtime_1.createRedisSessionUnavailableError)(action.toLowerCase().replace(/\s+/g, '-'));
        }
    }
    issueTokens(user) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const token = jwt_1.default.getNewToken(user);
            const refreshToken = jwt_1.default.createRefreshToken(user._id.toString());
            if ((0, connectRedis_1.isRedisAvailable)()) {
                try {
                    yield connectRedis_1.redisClient.set(`refresh:${user._id}`, refreshToken, { EX: config_1.default.refreshTokenExpiresIn });
                    (0, redis_runtime_1.logRedisFeatureMode)('auth-session-persistence', true, {
                        availableMessage: 'Redis-backed session persistence is available again.',
                        unavailableMessage: 'Redis-backed session persistence is unavailable; refresh and logout are degraded.',
                        unavailableLevel: 'warn',
                    });
                }
                catch (err) {
                    (0, redis_runtime_1.logRedisFeatureMode)('auth-session-persistence', false, {
                        availableMessage: 'Redis-backed session persistence is available again.',
                        unavailableMessage: 'Redis-backed session persistence is unavailable; refresh and logout are degraded.',
                        unavailableLevel: 'warn',
                    });
                    (0, redis_runtime_1.logRedisOperationFailure)('auth-session-persistence', 'set-refresh-token', err, {
                        user_id: (_b = (_a = user._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a),
                    });
                }
            }
            else {
                (0, redis_runtime_1.logRedisFeatureMode)('auth-session-persistence', false, {
                    availableMessage: 'Redis-backed session persistence is available again.',
                    unavailableMessage: 'Redis-backed session persistence is unavailable; refresh and logout are degraded.',
                    unavailableLevel: 'warn',
                });
            }
            return { token, refreshToken };
        });
    }
    getLoginAttempts(email) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(0, connectRedis_1.isRedisAvailable)()) {
                (0, redis_runtime_1.logRedisFeatureMode)('auth-login-attempts', false, {
                    availableMessage: 'Redis-backed login-attempt tracking is available again.',
                    unavailableMessage: 'Redis-backed login-attempt tracking is unavailable; shared login throttling is degraded.',
                    unavailableLevel: 'warn',
                });
                return 0;
            }
            const attempts = yield connectRedis_1.redisClient.get(`login-attempts:${email}`);
            return attempts ? parseInt(attempts, 10) : 0;
        });
    }
    incrementLoginAttempts(email) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(0, connectRedis_1.isRedisAvailable)()) {
                (0, redis_runtime_1.logRedisFeatureMode)('auth-login-attempts', false, {
                    availableMessage: 'Redis-backed login-attempt tracking is available again.',
                    unavailableMessage: 'Redis-backed login-attempt tracking is unavailable; shared login throttling is degraded.',
                    unavailableLevel: 'warn',
                });
                return;
            }
            const key = `login-attempts:${email}`;
            yield connectRedis_1.redisClient.incr(key);
            yield connectRedis_1.redisClient.expire(key, 15 * 60);
        });
    }
    clearLoginAttempts(email) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(0, connectRedis_1.isRedisAvailable)())
                return;
            yield connectRedis_1.redisClient.del(`login-attempts:${email}`);
        });
    }
}
;
const authLogic = new AuthenticationLogic();
exports.default = authLogic;
