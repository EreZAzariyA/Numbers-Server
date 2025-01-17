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
const users_1 = __importDefault(require("../bll/users"));
const router = express_1.default.Router();
router.get('/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const user = yield users_1.default.fetchUserProfile(user_id);
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
        const selectedTheme = yield users_1.default.changeTheme(user_id, theme);
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
        const selectedLang = yield users_1.default.changeLang(user_id, language);
        res.status(200).json(selectedLang);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
