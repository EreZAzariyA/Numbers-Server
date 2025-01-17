"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserModel = exports.UserSchema = void 0;
const mongoose_1 = require("mongoose");
const theme_model_1 = require("./theme-model");
const EmailSchema = new mongoose_1.Schema({
    email: {
        type: String,
        required: [true, "Email is missing"],
        unique: true,
        trim: true,
    },
    isValidate: {
        type: Boolean,
        default: false,
    },
    isActive: {
        type: Boolean,
        default: true,
    }
}, { _id: false });
const GoogleUserSchema = new mongoose_1.Schema({
    sub: String,
    name: String,
    given_name: String,
    family_name: String,
    picture: String,
    email: {
        type: String,
        unique: true,
        sparse: true
    },
    email_verified: {
        type: Boolean,
    },
    locale: String
}, { _id: false, autoIndex: true });
;
exports.UserSchema = new mongoose_1.Schema({
    profile: {
        first_name: {
            type: String,
            trim: true,
            required: [true, "First name is missing"],
            minLength: [3, "First name is to short"],
            maxLength: [20, "First name is to long"],
        },
        last_name: {
            type: String,
            trim: true,
        },
        image_url: {
            type: String,
            trim: true,
        },
    },
    services: {
        password: {
            type: String,
            trim: true,
        },
        google: GoogleUserSchema
    },
    emails: [EmailSchema],
    config: {
        'theme-color': {
            type: String,
            default: theme_model_1.ThemeColors.LIGHT
        },
        lang: {
            type: String,
            default: theme_model_1.Languages.EN
        },
    },
    loginAttempts: {
        lastAttemptDate: Number,
        attempts: {
            type: Number,
            default: 0
        }
    }
}, {
    versionKey: false,
    autoIndex: true,
    timestamps: true,
});
exports.UserModel = (0, mongoose_1.model)('userModel', exports.UserSchema, 'users');
