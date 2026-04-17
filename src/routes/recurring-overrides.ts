import express, { NextFunction, Request, Response } from 'express';
import { overridePattern, getPatterns } from '../bll/recurring/pattern-service';
import cacheService from '../utils/cache-service';

const router = express.Router();

/** GET /api/recurring/:user_id — list all persisted patterns. */
router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const patterns = await getPatterns(user_id);
    res.status(200).json(patterns);
  } catch (err) {
    next(err);
  }
});

/** POST /api/recurring/:user_id/confirm/:patternId — confirm a pattern. */
router.post('/:user_id/confirm/:patternId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, patternId } = req.params;
    const updated = await overridePattern(user_id, patternId, { confirmed: true });
    if (!updated) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    await invalidatePatternCaches(user_id);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

/** POST /api/recurring/:user_id/disable/:patternId — disable a pattern. */
router.post('/:user_id/disable/:patternId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, patternId } = req.params;
    const updated = await overridePattern(user_id, patternId, { disabled: true });
    if (!updated) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    await invalidatePatternCaches(user_id);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/recurring/:user_id/:patternId — custom amount/frequency/classification override. */
router.put('/:user_id/:patternId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, patternId } = req.params;
    const { customAmount, customFrequency, customClassification, confirmed, disabled } = req.body;
    const patch: Record<string, any> = {};
    if (customAmount !== undefined) patch.customAmount = customAmount;
    if (customFrequency !== undefined) patch.customFrequency = customFrequency;
    if (customClassification !== undefined) patch.customClassification = customClassification;
    if (confirmed !== undefined) patch.confirmed = confirmed;
    if (disabled !== undefined) patch.disabled = disabled;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No override fields provided' });
    }

    const updated = await overridePattern(user_id, patternId, patch);
    if (!updated) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    await invalidatePatternCaches(user_id);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

const invalidatePatternCaches = async (user_id: string): Promise<void> => {
  await Promise.all([
    cacheService.del(`cashFlow:${user_id}`),
    cacheService.del(`patterns:${user_id}`),
  ]);
};

export default router;
