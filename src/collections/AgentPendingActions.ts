import { Document, model, Schema } from "mongoose";

export type PendingAgentActionStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "expired";

export interface IAgentPendingActionCollection extends Document {
  user_id: string;
  tool: string;
  summary: string;
  args: Record<string, any>;
  argsPreview: Record<string, any>;
  status: PendingAgentActionStatus;
  expiresAt: Date;
  confirmedAt?: Date | null;
  cancelledAt?: Date | null;
  expiredAt?: Date | null;
  result?: Record<string, any> | null;
}

const AgentPendingActionSchema = new Schema<IAgentPendingActionCollection>({
  user_id: {
    type: String,
    required: [true, "User id is missing"],
    index: true,
  },
  tool: {
    type: String,
    required: [true, "Tool name is missing"],
    trim: true,
  },
  summary: {
    type: String,
    required: [true, "Summary is missing"],
    trim: true,
  },
  args: {
    type: Schema.Types.Mixed,
    default: {},
  },
  argsPreview: {
    type: Schema.Types.Mixed,
    default: {},
  },
  status: {
    type: String,
    enum: ["pending", "confirmed", "cancelled", "expired"],
    default: "pending",
    index: true,
  },
  expiresAt: {
    type: Date,
    required: [true, "Expiration date is missing"],
    index: true,
  },
  confirmedAt: {
    type: Date,
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
  expiredAt: {
    type: Date,
    default: null,
  },
  result: {
    type: Schema.Types.Mixed,
    default: null,
  },
}, {
  versionKey: false,
  timestamps: true,
});

export const AgentPendingActions = model<IAgentPendingActionCollection>(
  "AgentPendingActions",
  AgentPendingActionSchema,
  "agentPendingActions"
);
