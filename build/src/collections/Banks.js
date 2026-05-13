"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Accounts = void 0;
const mongoose_1 = require("mongoose");
const bank_model_1 = require("../models/bank-model");
;
const BanksSchema = new mongoose_1.Schema({
    user_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: [true, "User id is missing"],
        unique: true,
    },
    banks: {
        type: [bank_model_1.BankScheme],
        default: []
    }
}, {
    versionKey: false,
    autoIndex: true,
    timestamps: true
});
exports.Accounts = (0, mongoose_1.model)('Accounts', BanksSchema, 'banks');
