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
const auth_logic_1 = __importDefault(require("../bll/auth-logic"));
const credentials_model_1 = __importDefault(require("../models/credentials-model"));
const user_model_1 = require("../models/user-model");
const router = express_1.default.Router();
router.post("/signup", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = new user_model_1.UserModel(req.body);
        const token = yield auth_logic_1.default.signup(user);
        res.status(201).json(token);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/signin", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const credentials = new credentials_model_1.default(req.body);
        const token = yield auth_logic_1.default.signin(credentials);
        res.status(201).json(token);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/logout", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        res.sendStatus(201);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/google", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { credential, clientId } = req.body;
        const token = yield auth_logic_1.default.google(credential, clientId);
        res.status(201).json(token);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
