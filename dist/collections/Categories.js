"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Categories = void 0;
const mongoose_1 = require("mongoose");
const category_model_1 = require("../models/category-model");
;
const CategoriesSchema = new mongoose_1.Schema({
    user_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: [true, 'User id is missing'],
        unique: true,
    },
    categories: {
        type: [category_model_1.CategorySchema],
        default: [],
    }
}, {
    versionKey: false,
    autoIndex: true,
    timestamps: true
});
exports.Categories = (0, mongoose_1.model)('Categories', CategoriesSchema, 'categories');
