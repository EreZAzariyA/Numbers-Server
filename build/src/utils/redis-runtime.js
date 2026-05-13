"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRedisSessionUnavailableError = exports.createRedisQueueUnavailableError = exports.createRedisUnavailableError = exports.logRedisOperationFailure = exports.markRedisConnectionAvailable = exports.markRedisConnectionUnavailable = exports.logRedisFeatureMode = exports.serializeRedisError = exports.getRedisTarget = void 0;
const config_1 = __importDefault(require("./config"));
const client_error_1 = __importDefault(require("../models/client-error"));
const runtime_status_1 = require("./runtime-status");
const REDIS_UNAVAILABLE_CODE = 'REDIS_UNAVAILABLE';
const REDIS_QUEUE_MESSAGE = 'Background jobs are temporarily unavailable. Please try again later.';
const REDIS_SESSION_MESSAGE = 'Session services are temporarily unavailable. Please try again later.';
const featureModeState = new Map();
const connectionState = new Map();
const getRedisTarget = (redisUrl = config_1.default.redisUrl || 'redis://localhost:6379') => {
    try {
        const parsed = new URL(redisUrl);
        const port = parsed.port ? parseInt(parsed.port, 10) : 6379;
        return {
            url: redisUrl,
            host: parsed.hostname || 'localhost',
            port: Number.isNaN(port) ? null : port,
        };
    }
    catch (_a) {
        return {
            url: redisUrl,
            host: 'unknown',
            port: null,
        };
    }
};
exports.getRedisTarget = getRedisTarget;
const serializeRedisError = (err, redisUrl) => {
    const target = (0, exports.getRedisTarget)(redisUrl);
    return {
        message: (err === null || err === void 0 ? void 0 : err.message) || 'Unknown Redis error',
        code: err === null || err === void 0 ? void 0 : err.code,
        errno: err === null || err === void 0 ? void 0 : err.errno,
        syscall: err === null || err === void 0 ? void 0 : err.syscall,
        address: err === null || err === void 0 ? void 0 : err.address,
        port: err === null || err === void 0 ? void 0 : err.port,
        stack: err === null || err === void 0 ? void 0 : err.stack,
        target,
    };
};
exports.serializeRedisError = serializeRedisError;
const logRedisFeatureMode = (feature, enabled, options) => {
    const previous = featureModeState.get(feature);
    if (previous === enabled) {
        return;
    }
    featureModeState.set(feature, enabled);
    const level = enabled
        ? (options.availableLevel || 'info')
        : (options.unavailableLevel || 'info');
    const message = enabled ? options.availableMessage : options.unavailableMessage;
    config_1.default.log[level](Object.assign({ dependency: 'redis', feature, degradedMode: !enabled }, options.extra), message);
};
exports.logRedisFeatureMode = logRedisFeatureMode;
const markRedisConnectionUnavailable = (channel, err, options = {}) => {
    var _a, _b;
    if (options.affectsRuntime) {
        (0, runtime_status_1.setRedisStatus)('down');
    }
    const previous = (_b = (_a = connectionState.get(channel)) === null || _a === void 0 ? void 0 : _a.available) !== null && _b !== void 0 ? _b : null;
    connectionState.set(channel, { available: false });
    if (previous === false) {
        return;
    }
    const error = err ? (0, exports.serializeRedisError)(err, options.redisUrl) : undefined;
    const target = (0, exports.getRedisTarget)(options.redisUrl);
    config_1.default.log.warn(Object.assign({ dependency: 'redis', channel,
        target }, (error ? { error } : {})), `${channel} Redis connection unavailable`);
};
exports.markRedisConnectionUnavailable = markRedisConnectionUnavailable;
const markRedisConnectionAvailable = (channel, options = {}) => {
    var _a, _b;
    if (options.affectsRuntime) {
        (0, runtime_status_1.setRedisStatus)('up');
    }
    const previous = (_b = (_a = connectionState.get(channel)) === null || _a === void 0 ? void 0 : _a.available) !== null && _b !== void 0 ? _b : null;
    connectionState.set(channel, { available: true });
    if (previous !== false) {
        return;
    }
    config_1.default.log.info({
        dependency: 'redis',
        channel,
        target: (0, exports.getRedisTarget)(options.redisUrl),
    }, `${channel} Redis connection recovered`);
};
exports.markRedisConnectionAvailable = markRedisConnectionAvailable;
const logRedisOperationFailure = (feature, action, err, extra = {}) => {
    config_1.default.log.warn(Object.assign({ dependency: 'redis', feature,
        action, error: (0, exports.serializeRedisError)(err) }, extra), `Redis ${feature} ${action} failed`);
};
exports.logRedisOperationFailure = logRedisOperationFailure;
const createRedisUnavailableError = (feature, message) => {
    return new client_error_1.default(503, message, {
        code: REDIS_UNAVAILABLE_CODE,
        dependency: 'redis',
        feature,
        degradedMode: true,
        message,
    });
};
exports.createRedisUnavailableError = createRedisUnavailableError;
const createRedisQueueUnavailableError = (feature) => (0, exports.createRedisUnavailableError)(feature, REDIS_QUEUE_MESSAGE);
exports.createRedisQueueUnavailableError = createRedisQueueUnavailableError;
const createRedisSessionUnavailableError = (feature) => (0, exports.createRedisUnavailableError)(feature, REDIS_SESSION_MESSAGE);
exports.createRedisSessionUnavailableError = createRedisSessionUnavailableError;
