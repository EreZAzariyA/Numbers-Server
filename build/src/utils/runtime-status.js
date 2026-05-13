"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLivenessSnapshot = exports.getRuntimeSnapshot = exports.setWorkersEnabled = exports.setRedisStatus = exports.setMongoStatus = void 0;
const package_json_1 = require("../../package.json");
const state = {
    startedAt: Date.now(),
    mongo: 'down',
    mongoName: null,
    redis: 'down',
    workersEnabled: false,
};
const getOverallStatus = () => {
    if (state.mongo !== 'up') {
        return 'down';
    }
    if (state.redis !== 'up') {
        return 'degraded';
    }
    return 'ok';
};
const setMongoStatus = (status, mongoName) => {
    state.mongo = status;
    state.mongoName = status === 'up' ? (mongoName !== null && mongoName !== void 0 ? mongoName : state.mongoName) : null;
};
exports.setMongoStatus = setMongoStatus;
const setRedisStatus = (status) => {
    state.redis = status;
};
exports.setRedisStatus = setRedisStatus;
const setWorkersEnabled = (enabled) => {
    state.workersEnabled = enabled;
};
exports.setWorkersEnabled = setWorkersEnabled;
const getRuntimeSnapshot = () => {
    const status = getOverallStatus();
    return {
        status,
        app: package_json_1.name,
        version: package_json_1.version,
        mongo: state.mongo,
        redis: state.redis,
        workersEnabled: state.workersEnabled,
        degradedMode: status === 'degraded',
        mongoName: state.mongoName,
        uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
    };
};
exports.getRuntimeSnapshot = getRuntimeSnapshot;
const getLivenessSnapshot = () => ({
    status: 'ok',
    app: package_json_1.name,
    version: package_json_1.version,
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
});
exports.getLivenessSnapshot = getLivenessSnapshot;
