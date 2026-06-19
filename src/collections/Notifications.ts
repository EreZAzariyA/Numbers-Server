import { model } from 'mongoose';
import { INotificationModel, NotificationSchema } from '../models/notification-model';

export const Notifications = model<INotificationModel>(
  'Notifications',
  NotificationSchema,
  'notifications',
);
