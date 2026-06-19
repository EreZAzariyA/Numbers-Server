import express, { NextFunction, Request, Response } from 'express';
import notificationsLogic from '../bll/notifications';
import { generateAlertsForUser } from '../bll/alert-generation';
import { requireMatchingUserParam } from '../middlewares/require-user';

const router = express.Router();
router.param('user_id', requireMatchingUserParam);

/** GET /api/notifications/:user_id?unreadOnly=true&limit=50 */
router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const notifications = await notificationsLogic.list(user_id, { unreadOnly, limit });
    res.status(200).json(notifications);
  } catch (err) {
    next(err);
  }
});

/** GET /api/notifications/:user_id/unread-count */
router.get('/:user_id/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const count = await notificationsLogic.unreadCount(user_id);
    res.status(200).json({ count });
  } catch (err) {
    next(err);
  }
});

/** POST /api/notifications/:user_id/read/:id */
router.post('/:user_id/read/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, id } = req.params;
    const updated = await notificationsLogic.markRead(user_id, id);
    if (!updated) return res.status(404).json({ error: 'Notification not found' });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

/** POST /api/notifications/:user_id/read-all */
router.post('/:user_id/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const result = await notificationsLogic.markAllRead(user_id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/notifications/:user_id/refresh — run alert checks on demand. */
router.post('/:user_id/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    await generateAlertsForUser(user_id);
    const notifications = await notificationsLogic.list(user_id, {});
    res.status(200).json(notifications);
  } catch (err) {
    next(err);
  }
});

export default router;
