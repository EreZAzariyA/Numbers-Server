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
const transactions_1 = __importStar(require("../bll/transactions"));
const router = express_1.default.Router();
router.get("/recurring/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const groups = yield (0, transactions_1.detectRecurringTransactions)(user_id, { dateBasis: 'event' });
        res.status(200).json(groups);
    }
    catch (err) {
        next(err);
    }
}));
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
