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
const models_1 = require("../models");
const bll_1 = require("../bll");
const jwt_1 = __importDefault(require("../utils/jwt"));
const router = express_1.default.Router();
router.post("/signup", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = new models_1.UserModel(req.body);
        const tokens = yield bll_1.authLogic.signup(user);
        res.status(201).json(tokens);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/signin", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const credentials = new models_1.CredentialsModel(req.body);
        const tokens = yield bll_1.authLogic.signin(credentials);
        res.status(201).json(tokens);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/logout", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { refreshToken } = req.body;
        if (refreshToken) {
            const payload = jwt_1.default.verifyRefreshToken(refreshToken);
            if (payload === null || payload === void 0 ? void 0 : payload._id) {
                yield bll_1.authLogic.logout(payload._id);
            }
        }
        res.sendStatus(201);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/google", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { credential, clientId } = req.body;
        const tokens = yield bll_1.authLogic.google(credential, clientId);
        res.status(201).json(tokens);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/refresh", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { refreshToken } = req.body;
        const tokens = yield bll_1.authLogic.refresh(refreshToken);
        res.json(tokens);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
