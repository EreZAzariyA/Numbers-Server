"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SavingsGoals = void 0;
const mongoose_1 = require("mongoose");
const savings_goal_model_1 = require("../models/savings-goal-model");
const SavingsGoalsSchema = new mongoose_1.Schema({
    user_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: [true, 'User id is missing'],
        unique: true,
    },
    goals: {
        type: [savings_goal_model_1.SavingsGoalSchema],
        default: [],
    },
}, {
    versionKey: false,
    autoIndex: true,
    timestamps: true,
});
exports.SavingsGoals = (0, mongoose_1.model)('SavingsGoals', SavingsGoalsSchema, 'savingsGoals');
