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
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = __importDefault(require("./config"));
const cache_service_1 = __importDefault(require("./cache-service"));
const models_1 = require("../models");
const bll_1 = require("../bll");
const helpers_1 = require("./helpers");
class JWTServices {
    constructor() {
        this.secretKey = config_1.default.secretKey;
    }
    getNewToken(user, customExpiresIn) {
        const token = jsonwebtoken_1.default.sign(user, this.secretKey, { expiresIn: customExpiresIn || config_1.default.loginExpiresIn });
        return token;
    }
    ;
    createNewToken(data, customExpiresIn) {
        const token = jsonwebtoken_1.default.sign(data, this.secretKey, { expiresIn: customExpiresIn || config_1.default.loginExpiresIn });
        return token;
    }
    ;
    verifyToken(request) {
        return new Promise((resolve, reject) => {
            var _a;
            try {
                const token = (_a = request.headers.authorization) === null || _a === void 0 ? void 0 : _a.substring(7);
                if (!token) {
                    const error = new models_1.ClientError(401, 'No token provide');
                    reject(error);
                }
                jsonwebtoken_1.default.verify(token, this.secretKey, (err, decoded) => __awaiter(this, void 0, void 0, function* () {
                    if (err) {
                        const error = new models_1.ClientError(401, helpers_1.ErrorMessages.TOKEN_EXPIRED);
                        reject(error);
                        return;
                    }
                    const user = decoded;
                    if ((user === null || user === void 0 ? void 0 : user._id) && typeof user._id === 'string') {
                        const cacheKey = `user-profile:${user._id}`;
                        let userPro = yield cache_service_1.default.get(cacheKey);
                        if (!userPro) {
                            userPro = yield bll_1.usersLogic.fetchUserProfile(user._id);
                            if (userPro) {
                                yield cache_service_1.default.set(cacheKey, userPro, 300);
                            }
                        }
                        if (!userPro) {
                            reject(new models_1.ClientError(401, 'User profile not found. Try to reconnect.'));
                            return;
                        }
                    }
                    resolve(!!token);
                }));
            }
            catch (err) {
                reject(err);
            }
        });
    }
    ;
    getUserFromToken(request) {
        const token = request.headers.authorization.substring(7);
        const payload = jsonwebtoken_1.default.decode(token);
        const user = payload;
        return user;
    }
    ;
    getUserFromTokenString(token) {
        const payload = jsonwebtoken_1.default.decode(token);
        const user = payload;
        return user;
    }
    ;
    fetchBankCredentialsFromToken(token) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = jsonwebtoken_1.default.decode(token);
            return payload;
        });
    }
    ;
    createRefreshToken(userId) {
        return jsonwebtoken_1.default.sign({ _id: userId }, this.secretKey, { expiresIn: config_1.default.refreshTokenExpiresIn });
    }
    ;
    verifyRefreshToken(token) {
        try {
            return jsonwebtoken_1.default.verify(token, this.secretKey);
        }
        catch (_a) {
            return null;
        }
    }
    ;
}
;
const jwtService = new JWTServices();
exports.default = jwtService;
