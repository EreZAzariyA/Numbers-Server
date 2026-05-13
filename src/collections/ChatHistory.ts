import { Document, model, Schema } from "mongoose";

export interface IChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface IChatHistoryCollection extends Document {
  user_id: string;
  messages: IChatMessage[];
}

const ChatMessageSchema = new Schema<IChatMessage>({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const ChatHistorySchema = new Schema<IChatHistoryCollection>({
  user_id: {
    type: String,
    required: [true, 'User id is missing'],
    unique: true,
  },
  messages: { type: [ChatMessageSchema], default: [] },
}, { versionKey: false, timestamps: true });

export const ChatHistory = model<IChatHistoryCollection>('ChatHistory', ChatHistorySchema, 'chatHistory');
