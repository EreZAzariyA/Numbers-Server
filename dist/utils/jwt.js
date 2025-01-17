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
const client_error_1 = __importDefault(require("../models/client-error"));
const helpers_1 = require("./helpers");
const users_1 = __importDefault(require("../bll/users"));
const secretKey = config_1.default.secretKey;
function getNewToken(user, customExpiresIn) {
    const token = jsonwebtoken_1.default.sign(user, secretKey, { expiresIn: customExpiresIn || config_1.default.loginExpiresIn });
    return token;
}
;
function createNewToken(data, customExpiresIn) {
    const token = jsonwebtoken_1.default.sign(data, secretKey, { expiresIn: customExpiresIn || config_1.default.loginExpiresIn });
    return token;
}
;
function verifyToken(request) {
    return new Promise((resolve, reject) => {
        var _a;
        try {
            const token = (_a = request.headers.authorization) === null || _a === void 0 ? void 0 : _a.substring(7);
            if (!token) {
                const error = new client_error_1.default(401, 'No token provide');
                reject(error);
            }
            jsonwebtoken_1.default.verify(token, secretKey, (err, decoded) => __awaiter(this, void 0, void 0, function* () {
                if (err) {
                    const error = new client_error_1.default(401, helpers_1.ErrorMessages.TOKEN_EXPIRED);
                    reject(error);
                }
                const user = decoded;
                if ((user === null || user === void 0 ? void 0 : user._id) && typeof user._id === 'string') {
                    const userPro = yield users_1.default.fetchUserProfile(user._id);
                    if (!userPro) {
                        const err = new client_error_1.default(401, 'User profile not found. Try to reconnect.');
                        reject(err);
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
function getUserFromToken(request) {
    const token = request.headers.authorization.substring(7);
    const payload = jsonwebtoken_1.default.decode(token);
    const user = payload;
    return user;
}
;
function getUserFromTokenString(token) {
    const payload = jsonwebtoken_1.default.decode(token);
    const user = payload;
    return user;
}
;
function fetchBankCredentialsFromToken(token) {
    return __awaiter(this, void 0, void 0, function* () {
        const payload = jsonwebtoken_1.default.decode(token);
        return payload;
    });
}
;
exports.default = {
    getNewToken,
    createNewToken,
    verifyToken,
    getUserFromToken,
    fetchBankCredentialsFromToken,
    getUserFromTokenString
};
