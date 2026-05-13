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
const user_model_1 = require("../models/user-model");
const helpers_1 = require("../utils/helpers");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
class UsersLogic {
    constructor() {
        this.fetchUserProfile = (user_id) => __awaiter(this, void 0, void 0, function* () {
            return user_model_1.UserModel.findById(user_id).select('-services').exec();
        });
        this.changeTheme = (user_id, theme) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const res = yield user_model_1.UserModel.findByIdAndUpdate(user_id, {
                $set: {
                    'config.theme-color': theme
                }
            }, { new: true }).exec();
            const selectedTheme = ((_a = res.config) === null || _a === void 0 ? void 0 : _a['theme-color']) || helpers_1.ThemeColors.LIGHT;
            yield cache_service_1.default.del(`user-profile:${user_id}`);
            return selectedTheme;
        });
        this.changeLang = (user_id, lang) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const res = yield user_model_1.UserModel.findByIdAndUpdate(user_id, {
                $set: {
                    'config.lang': lang
                }
            }, { new: true }).select('config.lang').exec();
            const selectedLang = ((_a = res.config) === null || _a === void 0 ? void 0 : _a.lang) || helpers_1.Languages.EN;
            yield cache_service_1.default.del(`user-profile:${user_id}`);
            return selectedLang;
        });
    }
}
;
const usersLogic = new UsersLogic;
exports.default = usersLogic;
