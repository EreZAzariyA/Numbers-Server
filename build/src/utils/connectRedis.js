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
exports.getRedisTarget = exports.isRedisAvailable = exports.connectRedis = exports.redisClient = void 0;
const redis_1 = require("redis");
const config_1 = __importDefault(require("./config"));
const redis_runtime_1 = require("./redis-runtime");
Object.defineProperty(exports, "getRedisTarget", { enumerable: true, get: function () { return redis_runtime_1.getRedisTarget; } });
const redisClient = (0, redis_1.createClient)({
    url: config_1.default.redisUrl,
});
exports.redisClient = redisClient;
const connectRedis = () => __awaiter(void 0, void 0, void 0, function* () {
    if (redisClient.isReady) {
        return true;
    }
    if (redisClient.isOpen && !redisClient.isReady) {
        return false;
    }
    try {
        yield redisClient.connect();
        return redisClient.isReady;
    }
    catch (err) {
        (0, redis_runtime_1.markRedisConnectionUnavailable)('primary', err, {
            affectsRuntime: true,
            redisUrl: config_1.default.redisUrl,
        });
        return false;
    }
});
exports.connectRedis = connectRedis;
const isRedisAvailable = () => redisClient.isReady;
exports.isRedisAvailable = isRedisAvailable;
redisClient.on('ready', () => {
    (0, redis_runtime_1.markRedisConnectionAvailable)('primary', {
        affectsRuntime: true,
        redisUrl: config_1.default.redisUrl,
    });
});
redisClient.on('error', (err) => {
    (0, redis_runtime_1.markRedisConnectionUnavailable)('primary', err, {
        affectsRuntime: true,
        redisUrl: config_1.default.redisUrl,
    });
});
redisClient.on('end', () => {
    (0, redis_runtime_1.markRedisConnectionUnavailable)('primary', undefined, {
        affectsRuntime: true,
        redisUrl: config_1.default.redisUrl,
    });
});
