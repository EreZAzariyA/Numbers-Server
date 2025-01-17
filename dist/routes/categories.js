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
const categories_1 = __importDefault(require("../bll/categories"));
const category_model_1 = require("../models/category-model");
const router = express_1.default.Router();
router.get("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const categories = yield categories_1.default.fetchCategoriesByUserId(user_id);
        res.status(201).json(categories);
    }
    catch (err) {
        next(err);
    }
}));
router.post("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const categoryName = req.body.categoryName;
        const addedCategory = yield categories_1.default.addNewCategory(categoryName, user_id);
        res.status(201).json(addedCategory);
    }
    catch (err) {
        next(err);
    }
}));
router.put("/:user_id", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user_id = req.params.user_id;
        const categoryToUpdate = new category_model_1.CategoryModel(req.body);
        const updatedCategory = yield categories_1.default.updateCategory(categoryToUpdate, user_id);
        res.status(201).json(updatedCategory);
    }
    catch (err) {
        next(err);
    }
}));
router.delete("/", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { category_id, user_id } = req.body;
        yield categories_1.default.removeCategory(category_id, user_id);
        res.sendStatus(200);
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
