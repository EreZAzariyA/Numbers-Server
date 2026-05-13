"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const express_1 = __importDefault(require("express"));
const banks_1 = __importDefault(require("../bll/banks"));
const middlewares_1 = require("../middlewares");
const queues_1 = require("../queues");
const connectRedis_1 = require("../utils/connectRedis");
const redis_runtime_1 = require("../utils/redis-runtime");
const router = express_1.default.Router();
const ensureQueueingAvailable = (feature) => {
    if (!(0, connectRedis_1.isRedisAvailable)()) {
        throw (0, redis_runtime_1.createRedisQueueUnavailableError)(feature);
    }
};
router.get('/fetch-user-banks-accounts/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const banks = yield banks_1.default.fetchMainAccountResponse(user_id);
        return res.status(200).json(banks);
    }
    catch (err) {
        next(err);
    }
}));
router.get('/fetch-bank-account/:user_id/:bank_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id, bank_id } = req.params;
        const bank = yield banks_1.default.fetchOneBankAccount(user_id, bank_id);
        return res.status(200).json(bank);
    }
    catch (err) {
        next(err);
    }
}));
router.post('/connect-bank/:user_id', middlewares_1.bankScrapingLimiter, (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        ensureQueueingAvailable('bank-sync');
        const user_id = req.params.user_id;
        const details = req.body;
        const jobData = {
            user_id,
            companyId: details.companyId,
            credentials: details,
            isRefresh: false,
        };
        const job = yield (0, queues_1.getScrapingQueue)().add('connect-bank', jobData);
        res.status(202).json({ jobId: job.id });
    }
    catch (err) {
        next(err);
    }
}));
router.post('/import-transactions/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        ensureQueueingAvailable('transaction-import');
        const user_id = req.params.user_id;
        const { transactions, companyId } = req.body;
        const job = yield (0, queues_1.getTransactionImportQueue)().add('import-transactions', {
            user_id,
            transactions,
            companyId,
        });
        res.status(202).json({ jobId: job.id });
    }
    catch (err) {
        next(err);
    }
}));
router.put('/refresh-bank-data/:user_id', middlewares_1.bankScrapingLimiter, (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        ensureQueueingAvailable('bank-refresh');
        const user_id = req.params.user_id;
        const bank_id = req.body.bank_id;
        const bankAccount = yield banks_1.default.fetchOneBankAccount(user_id, bank_id);
        if (!(bankAccount === null || bankAccount === void 0 ? void 0 : bankAccount.credentials)) {
            return res.status(400).json({ message: 'Bank credentials not found' });
        }
        const decodedCredentials = yield (yield Promise.resolve().then(() => __importStar(require('../utils/jwt')))).default.fetchBankCredentialsFromToken(bankAccount.credentials);
        const credentials = {
            companyId: decodedCredentials.companyId,
            id: decodedCredentials.id,
            password: decodedCredentials.password,
            num: decodedCredentials.num,
            save: decodedCredentials.save,
            username: decodedCredentials.username,
        };
        const jobData = {
            user_id,
            bank_id,
            companyId: credentials.companyId,
            credentials,
            isRefresh: true,
        };
        const job = yield (0, queues_1.getScrapingQueue)().add('refresh-bank', jobData);
        res.status(202).json({ jobId: job.id });
    }
    catch (err) {
        next(err);
    }
}));
router.put('/update-bank-details/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const { bank_id, newCredentials } = req.body;
        const response = yield banks_1.default.updateBankAccountDetails(bank_id, user_id, newCredentials);
        res.status(200).json(response);
    }
    catch (err) {
        next(err);
    }
}));
router.post('/set-main-account/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const bank_id = req.body.bank_id;
        yield banks_1.default.setMainBankAccount(user_id, bank_id);
        res.sendStatus(200);
    }
    catch (err) {
        next(err);
    }
}));
router.delete('/remove-bank/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const bank_id = req.body.bank_id;
        yield banks_1.default.removeBankAccount(user_id, bank_id);
        res.sendStatus(200);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
