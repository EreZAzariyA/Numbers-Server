"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleClient = exports.connectRedis = exports.connectToMongoDB = void 0;
const dal_1 = __importDefault(require("./dal"));
exports.connectToMongoDB = dal_1.default;
const google_1 = require("./google");
Object.defineProperty(exports, "googleClient", { enumerable: true, get: function () { return google_1.googleClient; } });
const connectRedis_1 = require("../utils/connectRedis");
Object.defineProperty(exports, "connectRedis", { enumerable: true, get: function () { return connectRedis_1.connectRedis; } });
