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
const getGoogleDetails = (token) => __awaiter(void 0, void 0, void 0, function* () {
    if (!token) {
        throw new Error('Access token not found');
    }
    const response = yield fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    if (!response.ok) {
        throw new client_error_1.default(response.status, 'Failed to fetch user details');
    }
    const userDetails = yield response.json();
    return userDetails;
});
const createUserForGoogleAccounts = (payload) => {
    const user = new user_model_1.UserModel({
        emails: {
            email: payload.email,
            isValidate: payload.email_verified
        },
        profile: {
            first_name: payload.given_name || '',
            last_name: payload.family_name || '',
            image_url: payload.picture || ''
        },
        services: {
            google: Object.assign({}, payload)
        }
    });
    const errors = user.validateSync();
    if (errors) {
        Object.keys(errors.errors).forEach((field) => {
            throw new client_error_1.default(500, errors.errors[field].message);
        });
    }
    ;
    return user.save();
};
exports.default = {
    getGoogleDetails,
    createUserForGoogleAccounts
};
