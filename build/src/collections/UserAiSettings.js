"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserAiSettings = void 0;
const mongoose_1 = require("mongoose");
const UserAiSettingsSchema = new mongoose_1.Schema({
    user_id: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
    },
    provider: {
        type: String,
        enum: ['ollama', 'gemini', 'claude'],
        default: 'ollama',
    },
    geminiApiKey: {
        type: String,
        trim: true,
    },
    claudeApiKey: {
        type: String,
        trim: true,
    },
}, {
    versionKey: false,
    timestamps: true,
});
exports.UserAiSettings = (0, mongoose_1.model)('UserAiSettings', UserAiSettingsSchema, 'userAiSettings');
