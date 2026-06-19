import { Document, Schema, Types } from 'mongoose';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export type NotificationType =
  | 'overdraft-risk'
  | 'spending-anomaly'
  | 'subscription-price-increase'
  | 'upcoming-bill';

export interface INotificationModel extends Document {
  user_id: Types.ObjectId;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  dedupeKey: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSchema = new Schema<INotificationModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['overdraft-risk', 'spending-anomaly', 'subscription-price-increase', 'upcoming-bill'],
    required: true,
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info',
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  body: {
    type: String,
    default: '',
  },
  meta: {
    type: Schema.Types.Mixed,
    default: {},
  },
  dedupeKey: {
    type: String,
    required: true,
  },
  read: {
    type: Boolean,
    default: false,
  },
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
  collection: 'notifications',
});

NotificationSchema.index({ user_id: 1, createdAt: -1 });
NotificationSchema.index({ user_id: 1, dedupeKey: 1 }, { unique: true });
