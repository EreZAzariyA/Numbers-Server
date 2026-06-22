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
import { generateAlertsForUser } from '../bll/alert-generation';
import { triggerRefreshForUser } from '../workers/nightly-refresh';
import { requireMatchingUserParam } from '../middlewares/require-user';
import { isRedisAvailable } from '../utils/connectRedis';
import { createRedisQueueUnavailableError } from '../utils/redis-runtime';
import { addDays, toDateStr } from '../utils/date-helpers';
import type { InsightLang } from '../models/agent-insight-model';

const router = express.Router();
router.param('user_id', requireMatchingUserParam);

const resolveLang = (raw: unknown): InsightLang =>
  raw === 'he' ? 'he' : 'en';

/** GET /api/agent-insights/:user_id/digest?lang=en|he */
router.get('/:user_id/digest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const digest = await agentInsightsLogic.getLatestDigest(user_id, resolveLang(req.query.lang));
    if (!digest) {
      return res.status(200).json({ aiSummary: null, findings: [], generatedAt: null });
    }
    res.status(200).json(digest);
  } catch (err) {
    next(err);
  }
});

/** GET /api/agent-insights/:user_id/findings?type=X&since=YYYY-MM-DD&lang=en|he */
router.get('/:user_id/findings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const { type, since, lang } = req.query;

    const yesterday = addDays(toDateStr(new Date()), -1);
    const sinceDate = typeof since === 'string' ? since : yesterday;

    let findings = await agentInsightsLogic.getRecentFindings(
      user_id,
      sinceDate,
      resolveLang(lang),
    );

    if (type && typeof type === 'string') {
      findings = findings.filter((f) => f.type === type);
    }

    res.status(200).json(findings);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agent-insights/:user_id/trigger — run all proactive analyses and regenerate digest. */
router.post('/:user_id/trigger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;

    await Promise.all([
      runDailyExpenseReview(user_id),
      runWeeklySummary(user_id),
      runMonthEndRisk(user_id),
      runSubscriptionWatch(user_id),
      runIncomeDetection(user_id),
      runAnomalyDetection(user_id),
    ]);

    await generateDashboardDigest(user_id);

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/agent-insights/:user_id/trigger-alerts — regenerate alerts immediately. */
router.post('/:user_id/trigger-alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    await generateAlertsForUser(user_id);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/agent-insights/:user_id/trigger-refresh — queue bank refresh for this user. */
router.post('/:user_id/trigger-refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    if (!isRedisAvailable()) {
      throw createRedisQueueUnavailableError('manual-bank-refresh');
    }
    const queued = await triggerRefreshForUser(user_id);
    res.status(202).json({ ok: true, queued });
  } catch (err) {
    next(err);
  }
});

export default router;
