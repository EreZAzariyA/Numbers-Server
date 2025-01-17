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
exports.createUpdateQuery = exports.createBank = exports.insertBankAccount = exports.getBankData = exports.createCredentials = exports.isCardProviderCompany = exports.CreditCardProviders = exports.SupportedCompanies = void 0;
const moment_1 = __importDefault(require("moment"));
const israeli_bank_scrapers_by_e_a_1 = require("israeli-bank-scrapers-by-e.a");
const banks_1 = __importDefault(require("../bll/banks"));
const client_error_1 = __importDefault(require("../models/client-error"));
const helpers_1 = require("./helpers");
const jwt_1 = __importDefault(require("./jwt"));
const bank_model_1 = require("../models/bank-model");
const Banks_1 = require("../collections/Banks");
exports.SupportedCompanies = {
    [israeli_bank_scrapers_by_e_a_1.CompanyTypes.discount]: israeli_bank_scrapers_by_e_a_1.CompanyTypes.discount,
    [israeli_bank_scrapers_by_e_a_1.CompanyTypes.max]: israeli_bank_scrapers_by_e_a_1.CompanyTypes.max,
    [israeli_bank_scrapers_by_e_a_1.CompanyTypes.behatsdaa]: israeli_bank_scrapers_by_e_a_1.CompanyTypes.behatsdaa,
    [israeli_bank_scrapers_by_e_a_1.CompanyTypes.leumi]: israeli_bank_scrapers_by_e_a_1.CompanyTypes.leumi,
    [israeli_bank_scrapers_by_e_a_1.CompanyTypes.visaCal]: israeli_bank_scrapers_by_e_a_1.CompanyTypes.visaCal,
};
exports.CreditCardProviders = [
    israeli_bank_scrapers_by_e_a_1.CompanyTypes.visaCal,
    israeli_bank_scrapers_by_e_a_1.CompanyTypes.max,
    israeli_bank_scrapers_by_e_a_1.CompanyTypes.behatsdaa,
];
const isCardProviderCompany = (company) => {
    return exports.CreditCardProviders.includes(israeli_bank_scrapers_by_e_a_1.CompanyTypes[company]) || false;
};
exports.isCardProviderCompany = isCardProviderCompany;
const createCredentials = (details) => {
    if (!exports.SupportedCompanies[details.companyId]) {
        throw new client_error_1.default(500, `${helpers_1.ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
    }
    let credentials = null;
    switch (details.companyId) {
        case exports.SupportedCompanies[israeli_bank_scrapers_by_e_a_1.CompanyTypes.discount]:
            credentials = {
                id: details.id,
                password: details.password,
                num: details.num
            };
            break;
        case exports.SupportedCompanies[israeli_bank_scrapers_by_e_a_1.CompanyTypes.max]:
            credentials = {
                username: details.username,
                password: details.password
            };
            break;
        case exports.SupportedCompanies[israeli_bank_scrapers_by_e_a_1.CompanyTypes.visaCal]:
            credentials = {
                username: details.username,
                password: details.password
            };
            break;
    }
    ;
    return credentials;
};
exports.createCredentials = createCredentials;
const getBankData = (details) => __awaiter(void 0, void 0, void 0, function* () {
    const lastYear = (0, moment_1.default)().subtract('1', 'years').calendar();
    const options = {
        companyId: israeli_bank_scrapers_by_e_a_1.CompanyTypes[details.companyId],
        startDate: new Date(lastYear),
        combineInstallments: false,
        showBrowser: false,
        defaultTimeout: 10000
    };
    const credentials = (0, exports.createCredentials)(details);
    const scraper = (0, israeli_bank_scrapers_by_e_a_1.createScraper)(options);
    const scrapeResult = yield scraper.scrape(credentials);
    return scrapeResult;
});
exports.getBankData = getBankData;
const insertBankAccount = (user_id, details, account) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const banksAccount = yield banks_1.default.fetchMainAccount(user_id);
    const currBankAccount = (_a = banksAccount === null || banksAccount === void 0 ? void 0 : banksAccount.banks) === null || _a === void 0 ? void 0 : _a.find((b) => {
        return b.bankName.toLowerCase() === details.companyId.toLowerCase();
    });
    if (currBankAccount) {
        return yield updateBank(currBankAccount, user_id, account, details);
    }
    try {
        const newBank = yield (0, exports.createBank)(details.companyId, details, account);
        yield Banks_1.Accounts.findOneAndUpdate({ user_id: user_id }, { $push: { banks: newBank } }, { new: true, upsert: true }).exec();
        return newBank;
    }
    catch (err) {
        console.log({ err });
    }
});
exports.insertBankAccount = insertBankAccount;
const updateBank = (currBankAccount, user_id, account, details) => __awaiter(void 0, void 0, void 0, function* () {
    const query = (0, exports.createUpdateQuery)(account, details);
    const options = {
        user_id: user_id,
        'banks._id': currBankAccount._id
    };
    const projection = {
        new: true,
        upsert: true
    };
    try {
        const bankAccounts = yield Banks_1.Accounts.findOneAndUpdate(options, query, projection).exec();
        return bankAccounts.banks.find((b) => { var _a, _b; return ((_a = b._id) === null || _a === void 0 ? void 0 : _a.toString()) === ((_b = currBankAccount._id) === null || _b === void 0 ? void 0 : _b.toString()); });
    }
    catch (error) {
        console.log(error);
        return;
    }
});
const createBank = (bankName, credentialsDetails, account) => __awaiter(void 0, void 0, void 0, function* () {
    const isCardProvider = (0, exports.isCardProviderCompany)(credentialsDetails.companyId);
    const bankAccount = new bank_model_1.BankModel(Object.assign({ bankName,
        isCardProvider, lastConnection: new Date().valueOf(), details: {
            accountNumber: account.accountNumber,
            balance: account.balance,
        }, cardsPastOrFutureDebit: account.cardsPastOrFutureDebit, extraInfo: account.info, pastOrFutureDebits: account === null || account === void 0 ? void 0 : account.pastOrFutureDebits, savings: account === null || account === void 0 ? void 0 : account.saving, loans: account === null || account === void 0 ? void 0 : account.loans }, ((credentialsDetails === null || credentialsDetails === void 0 ? void 0 : credentialsDetails.save) && {
        credentials: jwt_1.default.createNewToken(credentialsDetails),
    })));
    return bankAccount;
});
exports.createBank = createBank;
const createUpdateQuery = (account, details) => ({
    $set: Object.assign({ 'banks.$.lastConnection': new Date().valueOf(), 'banks.$.details': {
            balance: account === null || account === void 0 ? void 0 : account.balance,
        }, 'banks.$.extraInfo': account === null || account === void 0 ? void 0 : account.info, 'banks.$.pastOrFutureDebits': account === null || account === void 0 ? void 0 : account.pastOrFutureDebits, 'banks.$.cardsPastOrFutureDebit': account === null || account === void 0 ? void 0 : account.cardsPastOrFutureDebit, 'banks.$.savings': account === null || account === void 0 ? void 0 : account.saving, 'banks.$.loans': account === null || account === void 0 ? void 0 : account.loans }, (details.save && {
        'banks.$.credentials': jwt_1.default.createNewToken(details)
    }))
});
exports.createUpdateQuery = createUpdateQuery;
