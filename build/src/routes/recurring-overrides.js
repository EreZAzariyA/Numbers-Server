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
const express_1 = __importDefault(require("express"));
const pattern_service_1 = require("../bll/recurring/pattern-service");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const router = express_1.default.Router();
/** GET /api/recurring/:user_id — list all persisted patterns. */
router.get('/:user_id', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id } = req.params;
        const patterns = yield (0, pattern_service_1.getPatterns)(user_id);
        res.status(200).json(patterns);
    }
    catch (err) {
        next(err);
    }
}));
/** POST /api/recurring/:user_id/confirm/:patternId — confirm a pattern. */
router.post('/:user_id/confirm/:patternId', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id, patternId } = req.params;
        const updated = yield (0, pattern_service_1.overridePattern)(user_id, patternId, { confirmed: true });
        if (!updated) {
            return res.status(404).json({ error: 'Pattern not found' });
        }
        yield invalidatePatternCaches(user_id);
        res.status(200).json(updated);
    }
    catch (err) {
        next(err);
    }
}));
/** POST /api/recurring/:user_id/disable/:patternId — disable a pattern. */
router.post('/:user_id/disable/:patternId', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id, patternId } = req.params;
        const updated = yield (0, pattern_service_1.overridePattern)(user_id, patternId, { disabled: true });
        if (!updated) {
            return res.status(404).json({ error: 'Pattern not found' });
        }
        yield invalidatePatternCaches(user_id);
        res.status(200).json(updated);
    }
    catch (err) {
        next(err);
    }
}));
/** PUT /api/recurring/:user_id/:patternId — custom amount/frequency/classification override. */
router.put('/:user_id/:patternId', (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id, patternId } = req.params;
        const { customAmount, customFrequency, customClassification, confirmed, disabled } = req.body;
        const patch = {};
        if (customAmount !== undefined)
            patch.customAmount = customAmount;
        if (customFrequency !== undefined)
            patch.customFrequency = customFrequency;
        if (customClassification !== undefined)
            patch.customClassification = customClassification;
        if (confirmed !== undefined)
            patch.confirmed = confirmed;
        if (disabled !== undefined)
            patch.disabled = disabled;
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ error: 'No override fields provided' });
        }
        const updated = yield (0, pattern_service_1.overridePattern)(user_id, patternId, patch);
        if (!updated) {
            return res.status(404).json({ error: 'Pattern not found' });
        }
        yield invalidatePatternCaches(user_id);
        res.status(200).json(updated);
    }
    catch (err) {
        next(err);
    }
}));
const invalidatePatternCaches = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    yield Promise.all([
        cache_service_1.default.del(`cashFlow:${user_id}`),
        cache_service_1.default.del(`patterns:${user_id}`),
    ]);
});
exports.default = router;
