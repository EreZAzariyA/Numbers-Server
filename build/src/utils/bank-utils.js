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
exports.createUpdateQuery = exports.createBank = exports.insertBankAccount = exports.getBankData = exports.createCredentials = void 0;
const moment_1 = __importDefault(require("moment"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const israeli_bank_scrapers_for_e_a_servers_1 = require("israeli-bank-scrapers-for-e.a-servers");
const models_1 = require("../models");
const collections_1 = require("../collections");
const bll_1 = require("../bll");
const jwt_1 = __importDefault(require("./jwt"));
const helpers_1 = require("./helpers");
const requireString = (value, fieldName) => {
    if (value) {
        return value;
    }
    throw new models_1.ClientError(400, `${fieldName} is missing`);
};
const createCredentials = (details) => {
    if (!(0, helpers_1.isSupportedCompany)(details.companyId)) {
        throw new models_1.ClientError(500, `${helpers_1.ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
    }
    let credentials;
    switch (details.companyId) {
        case helpers_1.SupportedCompanies[israeli_bank_scrapers_for_e_a_servers_1.CompanyTypes.discount]:
            credentials = {
                id: details.id,
                password: details.password,
                num: details.num
            };
            break;
        case helpers_1.SupportedCompanies[israeli_bank_scrapers_for_e_a_servers_1.CompanyTypes.max]:
            credentials = {
                username: requireString(details.username, 'Username'),
                password: details.password
            };
            break;
        case helpers_1.SupportedCompanies[israeli_bank_scrapers_for_e_a_servers_1.CompanyTypes.visaCal]:
            credentials = {
                username: requireString(details.username, 'Username'),
                password: details.password
            };
            break;
        case helpers_1.SupportedCompanies[israeli_bank_scrapers_for_e_a_servers_1.CompanyTypes.behatsdaa]:
            credentials = {
                id: details.id,
                password: details.password
            };
            break;
        case helpers_1.SupportedCompanies[israeli_bank_scrapers_for_e_a_servers_1.CompanyTypes.leumi]:
            credentials = {
                username: requireString(details.username, 'Username'),
                password: details.password
            };
            break;
    }
    if (!credentials) {
        throw new models_1.ClientError(500, `${helpers_1.ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
    }
    return credentials;
};
exports.createCredentials = createCredentials;
const getBankData = (details) => __awaiter(void 0, void 0, void 0, function* () {
    const startDate = (0, moment_1.default)().subtract(1, 'year').toDate();
    if (!(0, helpers_1.isSupportedCompany)(details.companyId)) {
        throw new models_1.ClientError(500, `${helpers_1.ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
    }
    const browser = yield puppeteer_1.default.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const options = {
        companyId: israeli_bank_scrapers_for_e_a_servers_1.CompanyTypes[details.companyId],
        startDate,
        combineInstallments: false,
        showBrowser: false,
        defaultTimeout: 60000,
        includeRawTransaction: true,
        additionalTransactionInformation: true,
        browser,
    };
    const credentials = (0, exports.createCredentials)(details);
    const scraper = (0, israeli_bank_scrapers_for_e_a_servers_1.createScraper)(options);
    const scrapeResult = yield scraper.scrape(credentials);
    return scrapeResult;
});
exports.getBankData = getBankData;
const insertBankAccount = (user_id, details, account) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const banksAccount = yield bll_1.bankLogic.fetchMainAccount(user_id);
    const currBankAccount = (_a = banksAccount === null || banksAccount === void 0 ? void 0 : banksAccount.banks) === null || _a === void 0 ? void 0 : _a.find((b) => {
        return b.bankName.toLowerCase() === details.companyId.toLowerCase();
    });
    if (currBankAccount) {
        return yield updateBank(currBankAccount, user_id, account, details);
    }
    try {
        const newBank = yield (0, exports.createBank)(details.companyId, details, account);
        yield collections_1.Accounts.findOneAndUpdate({ user_id: user_id }, { $push: { banks: newBank } }, { new: true, upsert: true }).exec();
        return newBank;
    }
    catch (err) {
        console.log({ err });
        throw new models_1.ClientError(500, 'Failed to insert bank account');
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
        const bankAccounts = yield collections_1.Accounts.findOneAndUpdate(options, query, projection).exec();
        if (!bankAccounts) {
            throw new models_1.ClientError(500, helpers_1.ErrorMessages.BANK_ACCOUNT_NOT_FOUND);
        }
        const updatedBank = bankAccounts.banks.find((b) => { var _a, _b; return ((_a = b._id) === null || _a === void 0 ? void 0 : _a.toString()) === ((_b = currBankAccount._id) === null || _b === void 0 ? void 0 : _b.toString()); });
        if (!updatedBank) {
            throw new models_1.ClientError(500, helpers_1.ErrorMessages.BANK_ACCOUNT_NOT_FOUND);
        }
        return updatedBank;
    }
    catch (error) {
        console.log(error);
        throw new models_1.ClientError(500, 'Failed to update bank account');
    }
});
const createBank = (bankName, credentialsDetails, account) => __awaiter(void 0, void 0, void 0, function* () {
    const isCardProvider = (0, helpers_1.isCardProviderCompany)(credentialsDetails.companyId);
    const bankAccount = new models_1.BankModel(Object.assign({ bankName,
        isCardProvider, lastConnection: new Date().valueOf(), details: {
            accountNumber: account.accountNumber,
            balance: account.balance,
        }, cardsPastOrFutureDebit: account.cardsPastOrFutureDebit, extraInfo: account.info, pastOrFutureDebits: account === null || account === void 0 ? void 0 : account.pastOrFutureDebits, savings: account === null || account === void 0 ? void 0 : account.saving, loans: account === null || account === void 0 ? void 0 : account.loans, securities: account === null || account === void 0 ? void 0 : account.securities }, ((credentialsDetails === null || credentialsDetails === void 0 ? void 0 : credentialsDetails.save) && {
        credentials: jwt_1.default.createNewToken(credentialsDetails),
    })));
    return bankAccount;
});
exports.createBank = createBank;
const createUpdateQuery = (account, details) => ({
    $set: Object.assign({ 'banks.$.lastConnection': new Date().valueOf(), 'banks.$.details': {
            balance: account === null || account === void 0 ? void 0 : account.balance,
        }, 'banks.$.extraInfo': account === null || account === void 0 ? void 0 : account.info, 'banks.$.pastOrFutureDebits': account === null || account === void 0 ? void 0 : account.pastOrFutureDebits, 'banks.$.cardsPastOrFutureDebit': account === null || account === void 0 ? void 0 : account.cardsPastOrFutureDebit, 'banks.$.savings': account === null || account === void 0 ? void 0 : account.saving, 'banks.$.loans': account === null || account === void 0 ? void 0 : account.loans, 'banks.$.securities': account === null || account === void 0 ? void 0 : account.securities }, (details.save && {
        'banks.$.credentials': jwt_1.default.createNewToken(details)
    }))
});
exports.createUpdateQuery = createUpdateQuery;
