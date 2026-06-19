import { Notifications } from '../collections';
import { INotificationModel, NotificationSeverity, NotificationType } from '../models/notification-model';
import { socketIo } from '../dal/socket';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const SOCKET_EVENT = 'notification';

export interface CreateNotificationPayload {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
  dedupeKey: string;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
}

class NotificationsLogic {
  /**
   * Idempotent create keyed by `dedupeKey` so the same alert is not re-created on
   * every generation run. Only a genuinely new document is pushed over the socket.
   */
  create = async (user_id: string, payload: CreateNotificationPayload): Promise<INotificationModel | null> => {
    const existing = await Notifications.findOne({ user_id, dedupeKey: payload.dedupeKey }).lean().exec();
    if (existing) return null;

    const created = await Notifications.create({
      user_id,
      type: payload.type,
      severity: payload.severity,
      title: payload.title,
      body: payload.body ?? '',
      meta: payload.meta ?? {},
      dedupeKey: payload.dedupeKey,
      read: false,
    });

    socketIo.emitToUser(user_id, SOCKET_EVENT, created.toObject());
    return created;
  };

  list = async (user_id: string, options: ListNotificationsOptions = {}): Promise<INotificationModel[]> => {
    const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const filter: Record<string, unknown> = { user_id };
    if (options.unreadOnly) filter.read = false;

    return Notifications.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<INotificationModel[]>()
      .exec();
  };

  unreadCount = async (user_id: string): Promise<number> =>
    Notifications.countDocuments({ user_id, read: false }).exec();

  markRead = async (user_id: string, notificationId: string): Promise<INotificationModel | null> =>
    Notifications.findOneAndUpdate(
      { _id: notificationId, user_id },
      { $set: { read: true } },
      { new: true },
    ).lean<INotificationModel>().exec();

  markAllRead = async (user_id: string): Promise<{ modified: number }> => {
    const result = await Notifications.updateMany(
      { user_id, read: false },
      { $set: { read: true } },
    ).exec();
    return { modified: result.modifiedCount ?? 0 };
  };
}

const notificationsLogic = new NotificationsLogic();
export default notificationsLogic;
