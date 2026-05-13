"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentPendingActions = void 0;
const mongoose_1 = require("mongoose");
const AgentPendingActionSchema = new mongoose_1.Schema({
    user_id: {
        type: String,
        required: [true, "User id is missing"],
        index: true,
    },
    tool: {
        type: String,
        required: [true, "Tool name is missing"],
        trim: true,
    },
    summary: {
        type: String,
        required: [true, "Summary is missing"],
        trim: true,
    },
    args: {
        type: mongoose_1.Schema.Types.Mixed,
        default: {},
    },
    argsPreview: {
        type: mongoose_1.Schema.Types.Mixed,
        default: {},
    },
    status: {
        type: String,
        enum: ["pending", "confirmed", "cancelled", "expired"],
        default: "pending",
        index: true,
    },
    expiresAt: {
        type: Date,
        required: [true, "Expiration date is missing"],
        index: true,
    },
    confirmedAt: {
        type: Date,
        default: null,
    },
    cancelledAt: {
        type: Date,
        default: null,
    },
    expiredAt: {
        type: Date,
        default: null,
    },
    result: {
        type: mongoose_1.Schema.Types.Mixed,
        default: null,
    },
}, {
    versionKey: false,
    timestamps: true,
});
exports.AgentPendingActions = (0, mongoose_1.model)("AgentPendingActions", AgentPendingActionSchema, "agentPendingActions");
