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
Object.defineProperty(exports, "__esModule", { value: true });
const connectRedis_1 = require("./connectRedis");
const redis_runtime_1 = require("./redis-runtime");
class CacheService {
    get isConnected() {
        return (0, connectRedis_1.isRedisAvailable)();
    }
    get(key) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                (0, redis_runtime_1.logRedisFeatureMode)('cache', this.isConnected, {
                    availableMessage: 'Redis cache is available again; cache operations resumed.',
                    unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
                });
                if (!this.isConnected)
                    return null;
                const data = yield connectRedis_1.redisClient.get(key);
                if (!data)
                    return null;
                return JSON.parse(data);
            }
            catch (err) {
                (0, redis_runtime_1.logRedisOperationFailure)('cache', 'get', err, { key });
                return null;
            }
        });
    }
    set(key, value, ttlSeconds) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                (0, redis_runtime_1.logRedisFeatureMode)('cache', this.isConnected, {
                    availableMessage: 'Redis cache is available again; cache operations resumed.',
                    unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
                });
                if (!this.isConnected)
                    return;
                yield connectRedis_1.redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
            }
            catch (err) {
                (0, redis_runtime_1.logRedisOperationFailure)('cache', 'set', err, { key });
            }
        });
    }
    del(key) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                (0, redis_runtime_1.logRedisFeatureMode)('cache', this.isConnected, {
                    availableMessage: 'Redis cache is available again; cache operations resumed.',
                    unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
                });
                if (!this.isConnected)
                    return;
                yield connectRedis_1.redisClient.del(key);
            }
            catch (err) {
                (0, redis_runtime_1.logRedisOperationFailure)('cache', 'del', err, { key });
            }
        });
    }
    delByPattern(pattern) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                (0, redis_runtime_1.logRedisFeatureMode)('cache', this.isConnected, {
                    availableMessage: 'Redis cache is available again; cache operations resumed.',
                    unavailableMessage: 'Redis cache is unavailable; bypassing cache operations.',
                });
                if (!this.isConnected)
                    return;
                let cursor = 0;
                do {
                    const result = yield connectRedis_1.redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
                    cursor = result.cursor;
                    if (result.keys.length > 0) {
                        yield connectRedis_1.redisClient.del(result.keys);
                    }
                } while (cursor !== 0);
            }
            catch (err) {
                (0, redis_runtime_1.logRedisOperationFailure)('cache', 'delByPattern', err, { pattern });
            }
        });
    }
}
const cacheService = new CacheService();
exports.default = cacheService;
