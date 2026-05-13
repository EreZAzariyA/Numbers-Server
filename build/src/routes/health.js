"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const runtime_status_1 = require("../utils/runtime-status");
const router = express_1.default.Router();
router.get('/healthz', (_req, res) => {
    res.status(200).json((0, runtime_status_1.getLivenessSnapshot)());
});
router.get('/readyz', (_req, res) => {
    const snapshot = (0, runtime_status_1.getRuntimeSnapshot)();
    res.status(snapshot.status === 'down' ? 503 : 200).json(snapshot);
});
exports.default = router;
