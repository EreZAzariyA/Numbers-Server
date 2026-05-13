"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SavingsGoalSchema = void 0;
const mongoose_1 = require("mongoose");
exports.SavingsGoalSchema = new mongoose_1.Schema({
    name: { type: String, required: [true, 'Goal name is missing'], trim: true },
    targetAmount: { type: Number, required: [true, 'Target amount is missing'] },
    currentAmount: { type: Number, default: 0 },
    targetDate: { type: String, required: [true, 'Target date is missing'] },
    aiInsight: { type: String, default: '' },
}, { versionKey: false });
