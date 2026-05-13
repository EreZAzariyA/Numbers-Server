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
const savings_goals_1 = __importDefault(require("../bll/savings-goals"));
const router = express_1.default.Router();
router.get("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id } = req.params;
        const language = req.query.language || 'en';
        const goals = yield savings_goals_1.default.fetchGoals(user_id, language);
        res.status(200).json(goals);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id } = req.params;
        const goal = req.body;
        const added = yield savings_goals_1.default.addGoal(user_id, goal);
        res.status(201).json(added);
    }
    catch (err) {
        next(err);
    }
}));
router.put("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id } = req.params;
        const goal = req.body;
        const updated = yield savings_goals_1.default.updateGoal(user_id, goal);
        res.status(200).json(updated);
    }
    catch (err) {
        next(err);
    }
}));
router.delete("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id } = req.params;
        const { goal_id } = req.body;
        yield savings_goals_1.default.removeGoal(user_id, goal_id);
        res.sendStatus(200);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
