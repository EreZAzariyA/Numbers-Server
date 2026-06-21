import express, { NextFunction, Request, Response } from 'express';
import agentInsightsLogic from '../bll/agent-insights';
import {
  runDailyExpenseReview,
  runWeeklySummary,
  runMonthEndRisk,
  runSubscriptionWatch,
  runIncomeDetection,
  runAnomalyDetection,
} from '../bll/analysis/proactive-analysis';
import { generateDashboardDigest } from '../bll/analysis/digest-generator';
import { requireMatchingUserParam } from '../middlewares/require-user';
import config from '../utils/config';
import { addDays, toDateStr } from '../utils/date-helpers';

const router = express.Router();
router.param('user_id', requireMatchingUserParam);

/** GET /api/agent-insights/:user_id/digest */
router.get('/:user_id/digest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const digest = await agentInsightsLogic.getLatestDigest(user_id);
    if (!digest) {
      return res.status(200).json({ aiSummary: null, findings: [], generatedAt: null });
    }
    res.status(200).json(digest);
  } catch (err) {
    next(err);
  }
});

/** GET /api/agent-insights/:user_id/findings?type=X&since=YYYY-MM-DD */
router.get('/:user_id/findings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const { type, since } = req.query;

    const yesterday = addDays(toDateStr(new Date()), -1);
    const sinceDate = typeof since === 'string' ? since : yesterday;

    let findings = await agentInsightsLogic.getRecentFindings(user_id, sinceDate);

    if (type && typeof type === 'string') {
      findings = findings.filter((f) => f.type === type);
    }

    res.status(200).json(findings);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agent-insights/:user_id/trigger — run all analyses immediately (dev-only). */
router.post('/:user_id/trigger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;

    if (config.isProduction) {
      return res.status(404).json({ error: 'Not found' });
    }

    await Promise.all([
      runDailyExpenseReview(user_id),
      runWeeklySummary(user_id),
      runMonthEndRisk(user_id),
      runSubscriptionWatch(user_id),
      runIncomeDetection(user_id),
      runAnomalyDetection(user_id),
    ]);

    await generateDashboardDigest(user_id, 'en');

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
