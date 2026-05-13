"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatHistory = void 0;
const mongoose_1 = require("mongoose");
const ChatMessageSchema = new mongoose_1.Schema({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
}, { _id: false });
const ChatHistorySchema = new mongoose_1.Schema({
    user_id: {
        type: String,
        required: [true, 'User id is missing'],
        unique: true,
    },
    messages: { type: [ChatMessageSchema], default: [] },
}, { versionKey: false, timestamps: true });
exports.ChatHistory = (0, mongoose_1.model)('ChatHistory', ChatHistorySchema, 'chatHistory');
