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
const express_1 = __importDefault(require("express"));
const banks_1 = __importDefault(require("../bll/banks"));
const router = express_1.default.Router();
router.get('/fetch-all-banks-accounts/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const banks = yield banks_1.default.fetchMainAccount(user_id);
        return res.status(200).json(banks);
    }
    catch (err) {
        next(err);
    }
}));
router.get('/fetch-bank-account/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const bank_id = req.body.bank_id;
        const bank = yield banks_1.default.fetchOneBankAccount(user_id, bank_id);
        return res.status(200).json(bank);
    }
    catch (err) {
        next(err);
    }
}));
router.post('/connect-bank/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const details = req.body;
        const response = yield banks_1.default.fetchBankData(details, user_id);
        res.status(200).json(response);
    }
    catch (err) {
        next(err);
    }
}));
router.post('/import-transactions/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const { transactions, companyId } = req.body;
        const response = yield banks_1.default.importTransactions(transactions, user_id, companyId);
        res.status(200).json(response);
    }
    catch (err) {
        next(err);
    }
}));
router.put('/refresh-bank-data/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const bank_id = req.body.bank_id;
        const response = yield banks_1.default.refreshBankData(bank_id, user_id);
        res.status(200).json(response);
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
exports.default = router;
