import { Document, Schema, Types } from 'mongoose';

export type InsightType =
  | 'daily-expense-review'
  | 'weekly-summary'
  | 'month-end-risk'
  | 'subscription-watch'
  | 'income-detection'
  | 'anomaly-detection'
  | 'dashboard-digest';

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface InsightFinding {
  severity: InsightSeverity;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
}

export interface IAgentInsightModel extends Document {
  user_id: Types.ObjectId;
  type: InsightType;
  date: string;
  findings: InsightFinding[];
  aiSummary?: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const AgentInsightSchema = new Schema<IAgentInsightModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: [
      'daily-expense-review',
      'weekly-summary',
      'month-end-risk',
      'subscription-watch',
      'income-detection',
      'anomaly-detection',
      'dashboard-digest',
    ],
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  findings: {
    type: [{
      severity: {
        type: String,
        enum: ['info', 'warning', 'critical'],
        required: true,
      },
      title: {
        type: String,
        required: true,
      },
      body: {
        type: String,
        default: '',
      },
      meta: {
        type: Schema.Types.Mixed,
        default: {},
      },
    }],
    default: [],
  },
  aiSummary: {
    type: String,
  },
  generatedAt: {
    type: Date,
    required: true,
    default: () => new Date(),
  },
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
  collection: 'agent_insights',
});

AgentInsightSchema.index({ user_id: 1, type: 1, date: -1 });
AgentInsightSchema.index({ user_id: 1, type: 1, date: 1 }, { unique: true });
