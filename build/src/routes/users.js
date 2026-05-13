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
const bll_1 = require("../bll");
const ai_settings_1 = __importDefault(require("../bll/ai-settings"));
const router = express_1.default.Router();
router.get('/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const user = yield bll_1.usersLogic.fetchUserProfile(user_id);
        res.status(200).json(user);
    }
    catch (err) {
        next(err);
    }
}));
router.put('/config/theme/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const theme = req.body.theme;
        const selectedTheme = yield bll_1.usersLogic.changeTheme(user_id, theme);
        res.status(200).json(selectedTheme);
    }
    catch (err) {
        next(err);
    }
}));
router.put('/config/language/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const language = req.body.language;
        const selectedLang = yield bll_1.usersLogic.changeLang(user_id, language);
        res.status(200).json(selectedLang);
    }
    catch (err) {
        next(err);
    }
}));
router.get('/ai-settings/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const settings = yield ai_settings_1.default.getSettings(user_id);
        res.status(200).json(settings);
    }
    catch (err) {
        next(err);
    }
}));
router.put('/ai-settings/:user_id/provider', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const provider = req.body.provider;
        const settings = yield ai_settings_1.default.updateProvider(user_id, provider);
        res.status(200).json(settings);
    }
    catch (err) {
        next(err);
    }
}));
router.put('/ai-settings/:user_id/keys', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const provider = req.body.provider;
        const apiKey = req.body.apiKey;
        const settings = yield ai_settings_1.default.upsertProviderKey(user_id, provider, apiKey);
        res.status(200).json(settings);
    }
    catch (err) {
        next(err);
    }
}));
router.delete('/ai-settings/:user_id/keys/:provider', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const provider = req.params.provider;
        const settings = yield ai_settings_1.default.removeProviderKey(user_id, provider);
        res.status(200).json(settings);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
