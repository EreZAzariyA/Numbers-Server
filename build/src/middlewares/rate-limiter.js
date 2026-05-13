"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.bankScrapingLimiter = exports.authLimiter = exports.globalLimiter = exports.initializeRedisBackedRateLimiters = void 0;
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
const rate_limit_redis_1 = require("rate-limit-redis");
const connectRedis_1 = require("../utils/connectRedis");
const redis_runtime_1 = require("../utils/redis-runtime");
const adaptiveLimiters = [];
const createRedisStore = (prefix) => new rate_limit_redis_1.RedisStore({
    sendCommand: (...args) => connectRedis_1.redisClient.sendCommand(args),
    prefix,
});
const buildRedisLimiter = (state) => {
    if (state.redisLimiter || !(0, connectRedis_1.isRedisAvailable)()) {
        return;
    }
    try {
        state.redisLimiter = (0, express_rate_limit_1.default)(Object.assign(Object.assign({}, state.options), { store: createRedisStore(state.redisPrefix), passOnStoreError: true }));
    }
    catch (err) {
        (0, redis_runtime_1.logRedisOperationFailure)('rate-limit', 'create-store', err, { redisPrefix: state.redisPrefix });
    }
};
const initializeRedisBackedRateLimiters = () => {
    adaptiveLimiters.forEach((state) => buildRedisLimiter(state));
};
exports.initializeRedisBackedRateLimiters = initializeRedisBackedRateLimiters;
const createAdaptiveLimiter = (redisPrefix, modeKey, options) => {
    const state = {
        redisPrefix,
        modeKey,
        options,
        memoryLimiter: (0, express_rate_limit_1.default)(options),
        redisLimiter: null,
    };
    adaptiveLimiters.push(state);
    return (req, res, next) => {
        var _a;
        const redisAvailable = (0, connectRedis_1.isRedisAvailable)();
        (0, redis_runtime_1.logRedisFeatureMode)(modeKey, redisAvailable, {
            availableMessage: 'Redis-backed distributed rate limiting is available again.',
            unavailableMessage: 'Redis-backed rate limiting is unavailable; falling back to local in-memory limits on this server.',
            unavailableLevel: 'warn',
        });
        const limiter = redisAvailable ? ((_a = state.redisLimiter) !== null && _a !== void 0 ? _a : state.memoryLimiter) : state.memoryLimiter;
        return limiter(req, res, next);
    };
};
exports.globalLimiter = createAdaptiveLimiter('rl:global:', 'rate-limit', {
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
});
exports.authLimiter = createAdaptiveLimiter('rl:auth:', 'rate-limit', {
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 10 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts, please try again later.' },
});
exports.bankScrapingLimiter = createAdaptiveLimiter('rl:bank:', 'rate-limit', {
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => { var _a; return req.params.user_id || (0, express_rate_limit_1.ipKeyGenerator)((_a = req.ip) !== null && _a !== void 0 ? _a : ''); },
    message: { message: 'Too many bank scraping requests, please try again later.' },
});
connectRedis_1.redisClient.on('ready', exports.initializeRedisBackedRateLimiters);
