"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CategoryModel = exports.CategorySchema = void 0;
const mongoose_1 = require("mongoose");
;
exports.CategorySchema = new mongoose_1.Schema({
    name: {
        type: String,
        trim: true,
        required: [true, "Category name is missing"],
    },
    spent: {
        type: Number,
        trim: true,
        required: [true, "Expected spent amount is missing"],
        default: 0
    },
    maximumSpentAllowed: {
        type: Object,
        active: {
            type: Boolean,
            default: false,
        },
        maximumAmount: {
            type: Number,
            default: 0
        }
    }
}, {
    versionKey: false,
});
exports.CategoryModel = (0, mongoose_1.model)('Category', exports.CategorySchema);
