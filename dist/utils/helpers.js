"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.asNumString = exports.getFutureDebitDate = exports.isArrayAndNotEmpty = exports.isArray = exports.removeServicesFromUser = exports.ErrorMessages = exports.MAX_LOGIN_ATTEMPTS = void 0;
const moment_1 = __importDefault(require("moment"));
exports.MAX_LOGIN_ATTEMPTS = 5;
var ErrorMessages;
(function (ErrorMessages) {
    ErrorMessages["NAME_IN_USE"] = "Name is already in use.";
    ErrorMessages["SOME_ERROR"] = "Some error, please contact us.";
    ErrorMessages["SOME_ERROR_TRY_AGAIN"] = "Some error, please try again later.";
    ErrorMessages["INCORRECT_LOGIN_ATTEMPT"] = "Incorrect ID or Password.";
    ErrorMessages["BANK_ACCOUNT_NOT_FOUND"] = "We did not found any bank account related to this ID";
    ErrorMessages["MAX_LOGIN_ATTEMPTS"] = "You have pass the maximum login attempts. Please try again more 24 hours..";
    ErrorMessages["INCORRECT_PASSWORD"] = "Email or password are incorrect";
    ErrorMessages["COMPANY_NOT_SUPPORTED"] = "Company not supported";
    ErrorMessages["USER_NOT_FOUND"] = "User not found";
    ErrorMessages["USER_ID_MISSING"] = "User id is missing";
    ErrorMessages["USER_BANK_ACCOUNT_NOT_FOUND"] = "Some error while trying to find user with this account. Please contact us.";
    ErrorMessages["CREDENTIALS_SAVED_NOT_LOADED"] = "Some error while trying to load saved credentials. Please contact us.";
    ErrorMessages["DECODED_CREDENTIALS_NOT_LOADED"] = "Some error while trying to load decoded credentials. Please contact us.";
    ErrorMessages["TOKEN_EXPIRED"] = "Invalid or expired token";
})(ErrorMessages || (exports.ErrorMessages = ErrorMessages = {}));
;
const removeServicesFromUser = (user) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _a = user.toObject(), { services } = _a, rest = __rest(_a, ["services"]);
    return rest;
};
exports.removeServicesFromUser = removeServicesFromUser;
const isArray = (arr) => {
    return Array.isArray(arr);
};
exports.isArray = isArray;
const isArrayAndNotEmpty = (arr) => {
    return (0, exports.isArray)(arr) && arr.length > 0;
};
exports.isArrayAndNotEmpty = isArrayAndNotEmpty;
const getFutureDebitDate = (dateString) => {
    if (typeof dateString === 'string') {
        const month = parseInt(dateString === null || dateString === void 0 ? void 0 : dateString.substring(0, 2)) - 1 || 0;
        const year = parseInt(dateString === null || dateString === void 0 ? void 0 : dateString.substring(2)) || 0;
        return new Date(year, month, 1).valueOf() || 0;
    }
    return (0, moment_1.default)(dateString).valueOf();
};
exports.getFutureDebitDate = getFutureDebitDate;
const asNumString = (num = 0, digits = 2) => {
    if (!num || typeof num !== 'number') {
        return '0';
    }
    const formattedNumber = num === null || num === void 0 ? void 0 : num.toFixed(digits);
    return parseFloat(formattedNumber || '0').toLocaleString();
};
exports.asNumString = asNumString;
