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
exports.getAmountToUpdate = void 0;
const category_model_1 = require("../models/category-model");
const client_error_1 = __importDefault(require("../models/client-error"));
const helpers_1 = require("../utils/helpers");
const Categories_1 = require("../collections/Categories");
const user_model_1 = require("../models/user-model");
const transactions_1 = require("israeli-bank-scrapers-by-e.a/lib/transactions");
const Transactions_1 = require("../collections/Transactions");
const Card_Transactions_1 = require("../collections/Card-Transactions");
const transactions_2 = require("./transactions");
const getAmountToUpdate = (amount) => {
    let newAmount = 0;
    if (amount > 0) {
        newAmount = amount * -1;
    }
    else {
        newAmount = Math.abs(amount);
    }
    return newAmount;
};
exports.getAmountToUpdate = getAmountToUpdate;
class CategoriesLogic {
    createAccountCategories(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            console.info(`createAccountCategories: Creating categories object for user: ${user_id}`);
            const accountCategories = new Categories_1.Categories({
                user_id,
                categories: []
            });
            const errors = accountCategories.validateSync();
            if (errors) {
                throw new client_error_1.default(500, errors.message);
            }
            console.info(`createAccountCategories: Categories object for user: ${user_id} - Created successfully`);
            return accountCategories.save();
        });
    }
    ;
    fetchCategoriesByUserId(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const userCategories = yield Categories_1.Categories.findOne({ user_id }).exec();
            return yield Promise.all((_a = userCategories.categories) === null || _a === void 0 ? void 0 : _a.map((category) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const transactions = yield Transactions_1.Transactions.find({
                    user_id,
                    category_id: category._id,
                    status: transactions_1.TransactionStatuses.Completed
                }).exec();
                const cardTransactions = yield Card_Transactions_1.CardTransactions.find({
                    user_id,
                    category_id: category._id,
                    status: transactions_1.TransactionStatuses.Completed
                }).exec();
                return Object.assign(Object.assign({}, category.toObject()), { spent: (0, transactions_2.getTotalTransactionsAmounts)([...transactions, ...cardTransactions]), transactions: (_a = [...transactions, ...cardTransactions]) === null || _a === void 0 ? void 0 : _a.length });
            })));
        });
    }
    ;
    fetchUserCategory(user_id, categoryName) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const userCategories = yield this.fetchCategoriesByUserId(user_id);
                const categoryIndex = userCategories.findIndex((c) => c.name === categoryName);
                const category = userCategories[categoryIndex];
                return category;
            }
            catch (err) {
                console.log(err);
                return err;
            }
        });
    }
    ;
    addNewCategory(categoryName, user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield user_model_1.UserModel.findById(user_id).catch(() => {
                console.info(`addNewCategory: Fail to add category: ${categoryName} - ${helpers_1.ErrorMessages.USER_NOT_FOUND}`);
                throw new client_error_1.default(400, helpers_1.ErrorMessages.USER_NOT_FOUND);
            });
            const allCategories = yield Categories_1.Categories.findOne({ user_id: user._id }).exec();
            if (allCategories) {
                const isExist = allCategories.categories.some((c) => c.name === categoryName);
                if (isExist) {
                    console.info(`addNewCategory: Fail to add category: ${categoryName} - ${helpers_1.ErrorMessages.NAME_IN_USE}`);
                    throw new client_error_1.default(500, helpers_1.ErrorMessages.NAME_IN_USE);
                }
            }
            const category = new category_model_1.CategoryModel({ name: categoryName });
            const updatedCategories = yield Categories_1.Categories.findOneAndUpdate({ user_id: user._id }, { $push: { categories: category } }, { new: true, upsert: true }).exec();
            if (!updatedCategories) {
                console.error('Failed to add category, document not found or created.');
                throw new client_error_1.default(500, 'Failed to add category');
            }
            return category;
        });
    }
    ;
    updateCategorySpentAmount(user_id, category_id, amount, newAmount) {
        return __awaiter(this, void 0, void 0, function* () {
            yield Categories_1.Categories.findOneAndUpdate({ user_id, 'categories._id': category_id }, { $inc: { 'categories.$.spent': amount } }, { new: true }).exec();
            if (newAmount) {
                yield Categories_1.Categories.findOneAndUpdate({ user_id, 'categories._id': category_id }, { $inc: { 'categories.$.spent': newAmount } }, { new: true }).exec();
            }
        });
    }
    ;
    updateCategory(category, user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedDoc = yield Categories_1.Categories.findOneAndUpdate({ user_id, 'categories._id': category._id }, { $set: {
                    'categories.$': Object.assign({}, category),
                } }, { new: true }).select('categories').exec();
            if (!updatedDoc) {
                throw new client_error_1.default(404, 'Category not found');
            }
            const errors = updatedDoc.validateSync();
            if (errors) {
                throw new client_error_1.default(500, errors.message);
            }
            const updatedCategory = updatedDoc.categories.find((c) => c._id.toString() === category._id.toString());
            if (!updatedCategory) {
                throw new client_error_1.default(404, 'Updated category not found');
            }
            return updatedCategory;
        });
    }
    ;
    removeCategory(category_id, user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield Categories_1.Categories.findOneAndUpdate({ user_id }, { $pull: { categories: { _id: category_id } } }, { new: true }).exec();
        });
    }
    ;
}
;
const categoriesLogic = new CategoriesLogic();
exports.default = categoriesLogic;
