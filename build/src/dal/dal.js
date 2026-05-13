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
const mongoose_1 = require("mongoose");
const config_1 = __importDefault(require("../utils/config"));
const runtime_status_1 = require("../utils/runtime-status");
let mongoListenersBound = false;
const bindMongoListeners = () => {
    if (mongoListenersBound) {
        return;
    }
    mongoListenersBound = true;
    mongoose_1.connection.on('connected', () => {
        (0, runtime_status_1.setMongoStatus)('up', mongoose_1.connection.name || null);
    });
    mongoose_1.connection.on('disconnected', () => {
        (0, runtime_status_1.setMongoStatus)('down');
    });
};
function connectToMongoDB() {
    return __awaiter(this, void 0, void 0, function* () {
        bindMongoListeners();
        try {
            const db = yield (0, mongoose_1.connect)(config_1.default.mongoConnectionString);
            (0, runtime_status_1.setMongoStatus)('up', db.connections[0].name);
            return db.connections[0].name;
        }
        catch (err) {
            (0, runtime_status_1.setMongoStatus)('down');
            config_1.default.log.error({ err: err.message }, 'MongoDB connection failed');
            throw err;
        }
    });
}
;
exports.default = connectToMongoDB;
