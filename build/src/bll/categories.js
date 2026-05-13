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
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const collections_1 = require("../collections");
const models_1 = require("../models");
const helpers_1 = require("../utils/helpers");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
class CategoriesLogic {
    normalizeCategoryName(categoryName) {
        return categoryName === null || categoryName === void 0 ? void 0 : categoryName.trim();
    }
    createAccountCategories(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            console.info(`createAccountCategories: Creating categories object for user: ${user_id}`);
            const accountCategories = new collections_1.Categories({
                user_id,
                categories: []
            });
            const errors = accountCategories.validateSync();
            if (errors) {
                throw new models_1.ClientError(500, errors.message);
            }
            console.info(`createAccountCategories: Categories object for user: ${user_id} - Created successfully`);
            return accountCategories.save();
        });
    }
    ;
    fetchCategoriesByUserId(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const cacheKey = `categories:${user_id}`;
            const cached = yield cache_service_1.default.get(cacheKey);
            if (cached)
                return cached;
            const userCategories = yield collections_1.Categories.findOne({ user_id }).exec();
            if (!userCategories) {
                const newAccountCategories = yield this.createAccountCategories(user_id);
                return newAccountCategories.categories;
            }
            const result = yield Promise.all((_a = userCategories.categories) === null || _a === void 0 ? void 0 : _a.map((category) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const transactions = yield collections_1.Transactions.find({
                    user_id,
                    category_id: category._id,
                    status: transactions_1.TransactionStatuses.Completed
                }).exec();
                const cardTransactions = yield collections_1.CardTransactions.find({
                    user_id,
                    category_id: category._id,
                    status: transactions_1.TransactionStatuses.Completed
                }).exec();
                return Object.assign(Object.assign({}, category.toObject()), { spent: (0, helpers_1.getTotalTransactionsAmounts)([...transactions, ...cardTransactions]), transactions: (_a = [...transactions, ...cardTransactions]) === null || _a === void 0 ? void 0 : _a.length });
            })));
            yield cache_service_1.default.set(cacheKey, result, 120);
            return result;
        });
    }
    ;
    fetchUserCategory(user_id, categoryName) {
        return __awaiter(this, void 0, void 0, function* () {
            const normalizedCategoryName = this.normalizeCategoryName(categoryName);
            if (!normalizedCategoryName) {
                return null;
            }
            const userCategories = yield collections_1.Categories.findOne({ user_id }).exec();
            const category = userCategories === null || userCategories === void 0 ? void 0 : userCategories.categories.find((c) => this.normalizeCategoryName(c.name) === normalizedCategoryName);
            return category !== null && category !== void 0 ? category : null;
        });
    }
    ;
    addNewCategory(categoryName_1, user_id_1) {
        return __awaiter(this, arguments, void 0, function* (categoryName, user_id, options = {}) {
            const normalizedCategoryName = this.normalizeCategoryName(categoryName);
            if (!normalizedCategoryName) {
                throw new models_1.ClientError(400, "Category name is missing");
            }
            const user = yield models_1.UserModel.findById(user_id);
            if (!user) {
                console.info(`addNewCategory: Fail to add category: ${normalizedCategoryName} - ${helpers_1.ErrorMessages.USER_NOT_FOUND}`);
                throw new models_1.ClientError(400, helpers_1.ErrorMessages.USER_NOT_FOUND);
            }
            yield collections_1.Categories.updateOne({ user_id: user._id }, { $setOnInsert: { user_id: user._id, categories: [] } }, { upsert: true }).exec();
            const existingCategory = yield this.fetchUserCategory(user_id, normalizedCategoryName);
            if (existingCategory) {
                if (options.reuseExisting) {
                    return existingCategory;
                }
                console.info(`addNewCategory: Fail to add category: ${normalizedCategoryName} - ${helpers_1.ErrorMessages.NAME_IN_USE}`);
                throw new models_1.ClientError(409, helpers_1.ErrorMessages.NAME_IN_USE);
            }
            const category = new models_1.CategoryModel({ name: normalizedCategoryName });
            const updatedCategories = yield collections_1.Categories.findOneAndUpdate({
                user_id: user._id,
                'categories.name': { $ne: normalizedCategoryName }
            }, { $push: { categories: category } }, { new: true }).exec();
            if (!updatedCategories) {
                const categoryAfterRace = yield this.fetchUserCategory(user_id, normalizedCategoryName);
                if (categoryAfterRace) {
                    if (options.reuseExisting) {
                        return categoryAfterRace;
                    }
                    console.info(`addNewCategory: Fail to add category: ${normalizedCategoryName} - ${helpers_1.ErrorMessages.NAME_IN_USE}`);
                    throw new models_1.ClientError(409, helpers_1.ErrorMessages.NAME_IN_USE);
                }
                console.error('Failed to add category, document not found or created.');
                throw new models_1.ClientError(500, 'Failed to add category');
            }
            yield cache_service_1.default.del(`categories:${user_id}`);
            return category;
        });
    }
    ;
    updateCategorySpentAmount(user_id, category_id, amount, newAmount) {
        return __awaiter(this, void 0, void 0, function* () {
            yield collections_1.Categories.findOneAndUpdate({ user_id, 'categories._id': category_id }, { $inc: { 'categories.$.spent': amount } }, { new: true }).exec();
            if (newAmount) {
                yield collections_1.Categories.findOneAndUpdate({ user_id, 'categories._id': category_id }, { $inc: { 'categories.$.spent': newAmount } }, { new: true }).exec();
            }
        });
    }
    ;
    updateCategory(category, user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedDoc = yield collections_1.Categories.findOneAndUpdate({ user_id, 'categories._id': category._id }, { $set: {
                    'categories.$': Object.assign({}, category),
                } }, { new: true }).select('categories').exec();
            if (!updatedDoc) {
                throw new models_1.ClientError(404, 'Category not found');
            }
            const errors = updatedDoc.validateSync();
            if (errors) {
                throw new models_1.ClientError(500, errors.message);
            }
            const updatedCategory = updatedDoc.categories.find((c) => c._id.toString() === category._id.toString());
            if (!updatedCategory) {
                throw new models_1.ClientError(404, 'Updated category not found');
            }
            yield cache_service_1.default.del(`categories:${user_id}`);
            return updatedCategory;
        });
    }
    ;
    removeCategory(category_id, user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield collections_1.Categories.findOneAndUpdate({ user_id }, { $pull: { categories: { _id: category_id } } }, { new: true }).exec();
            yield cache_service_1.default.del(`categories:${user_id}`);
        });
    }
    ;
}
;
const categoriesLogic = new CategoriesLogic();
exports.default = categoriesLogic;
