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
const transactions_1 = __importDefault(require("../bll/transactions"));
const router = express_1.default.Router();
router.get("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const { type = null, query } = req.query;
        const { transactions, total } = yield transactions_1.default.fetchUserTransactions(user_id, query, type);
        res.status(201).json({ transactions, total });
    }
    catch (err) {
        next(err);
    }
}));
router.post("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const { transaction, type } = req.body;
        const addedTransaction = yield transactions_1.default.newTransaction(user_id, transaction, type);
        res.status(201).json(addedTransaction);
    }
    catch (err) {
        next(err);
    }
}));
router.put("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const { transaction, type } = req.body;
        const updatedTransaction = yield transactions_1.default.updateTransaction(user_id, transaction, type);
        res.status(201).json(updatedTransaction);
    }
    catch (err) {
        next(err);
    }
}));
router.delete("/", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id, transaction_id, type } = req.body;
        yield transactions_1.default.removeTransaction(user_id, transaction_id, type);
        res.sendStatus(200);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
