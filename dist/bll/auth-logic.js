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
const client_error_1 = __importDefault(require("../models/client-error"));
const user_model_1 = require("../models/user-model");
const bcrypt_utils_1 = require("../utils/bcrypt-utils");
const jwt_1 = __importDefault(require("../utils/jwt"));
const google_1 = __importDefault(require("../utils/google"));
const helpers_1 = require("../utils/helpers");
const google_auth_library_1 = require("google-auth-library");
const client = new google_auth_library_1.OAuth2Client();
class AuthenticationLogic {
    constructor() {
        this.signup = (user) => __awaiter(this, void 0, void 0, function* () {
            const newEncryptedPassword = yield (0, bcrypt_utils_1.encryptPassword)(user.services.password);
            user.services.password = newEncryptedPassword;
            const errors = user.validateSync();
            if (errors) {
                throw new client_error_1.default(500, errors.message);
            }
            const savedUser = yield user.save();
            const userWithoutServices = (0, helpers_1.removeServicesFromUser)(savedUser);
            const token = jwt_1.default.getNewToken(userWithoutServices);
            return token;
        });
        this.signin = (credentials) => __awaiter(this, void 0, void 0, function* () {
            const user = yield user_model_1.UserModel.findOne({ 'emails.email': credentials.email }).exec();
            if (!user) {
                throw new client_error_1.default(400, helpers_1.ErrorMessages.INCORRECT_PASSWORD);
            }
            if (user.loginAttempts.attempts >= helpers_1.MAX_LOGIN_ATTEMPTS) {
                throw new client_error_1.default(500, helpers_1.ErrorMessages.MAX_LOGIN_ATTEMPTS);
            }
            const passwordMatch = yield (0, bcrypt_utils_1.comparePassword)(credentials.password, user.services.password || '');
            if (!passwordMatch) {
                user.loginAttempts = {
                    attempts: user.loginAttempts.attempts + 1 || 1,
                    lastAttemptDate: new Date().valueOf()
                };
                yield user.save({ validateBeforeSave: true });
                throw new client_error_1.default(400, helpers_1.ErrorMessages.INCORRECT_PASSWORD);
            }
            user.loginAttempts = {
                attempts: 0,
                lastAttemptDate: new Date().valueOf()
            };
            yield user.save({ validateBeforeSave: true });
            const userWithoutServices = (0, helpers_1.removeServicesFromUser)(user);
            const token = jwt_1.default.getNewToken(userWithoutServices);
            return token;
        });
        this.google = (credential, clientId) => __awaiter(this, void 0, void 0, function* () {
            const loginTicket = yield client.verifyIdToken({ idToken: credential, audience: clientId });
            const email = loginTicket.getPayload().email;
            if (!email) {
                throw new client_error_1.default(400, 'Some error while trying to get the user email');
            }
            const isSigned = yield user_model_1.UserModel.exists({ 'emails.email': email }).exec();
            let user = null;
            if (isSigned) {
                user = yield user_model_1.UserModel.findOne({ 'emails.email': email }).select('-services').exec();
            }
            else {
                const payload = loginTicket.getPayload();
                user = yield google_1.default.createUserForGoogleAccounts(payload);
            }
            if (!user) {
                throw new client_error_1.default(500, helpers_1.ErrorMessages.SOME_ERROR);
            }
            const userWithoutServices = (0, helpers_1.removeServicesFromUser)(user);
            const token = jwt_1.default.getNewToken(userWithoutServices);
            return token;
        });
    }
}
;
const authLogic = new AuthenticationLogic();
exports.default = authLogic;
