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
const jwt_1 = __importDefault(require("../utils/jwt"));
const agent_chat_1 = __importDefault(require("../bll/agent-chat"));
const router = express_1.default.Router();
// Send a single message — backend owns the full history
router.post("/chat", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = jwt_1.default.getUserFromToken(req);
        const { message, language = 'en', requestId } = req.body;
        const response = yield agent_chat_1.default.chat(String(user._id), message, language, requestId);
        res.status(200).json(response);
    }
    catch (err) {
        next(err);
    }
}));
// Load persisted chat history for the current user
router.get("/history", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = jwt_1.default.getUserFromToken(req);
        const history = yield agent_chat_1.default.loadHistory(String(user._id));
        res.status(200).json(history);
    }
    catch (err) {
        next(err);
    }
}));
// Clear the user's chat history
router.delete("/history", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = jwt_1.default.getUserFromToken(req);
        yield agent_chat_1.default.clearHistory(String(user._id));
        res.status(200).json({ ok: true });
    }
    catch (err) {
        next(err);
    }
}));
router.post("/actions/:actionId/confirm", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = jwt_1.default.getUserFromToken(req);
        const { actionId } = req.params;
        const { language = 'en' } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
        const response = yield agent_chat_1.default.confirmPendingAction(String(user._id), actionId, language);
        res.status(200).json(response);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/actions/:actionId/cancel", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = jwt_1.default.getUserFromToken(req);
        const { actionId } = req.params;
        const { language = 'en' } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
        const response = yield agent_chat_1.default.cancelPendingAction(String(user._id), actionId, language);
        res.status(200).json(response);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
