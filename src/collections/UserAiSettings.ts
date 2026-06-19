import { Document, Schema, model } from 'mongoose';

export type AiProvider = 'ollama' | 'gemini' | 'claude';

export interface IUserAiSettingsCollection extends Document {
  user_id: string;
  provider: AiProvider;
  ollamaModel?: string;
  ollamaThinking?: boolean;
  geminiApiKey?: string;
  geminiModel?: string;
  claudeApiKey?: string;
  claudeModel?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserAiSettingsSchema = new Schema<IUserAiSettingsCollection>({
  user_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  provider: {
    type: String,
    enum: ['ollama', 'gemini', 'claude'],
    default: 'ollama',
  },
  ollamaModel: {
    type: String,
    trim: true,
  },
  ollamaThinking: {
    type: Boolean,
    default: true,
  },
  geminiApiKey: {
    type: String,
    trim: true,
  },
  geminiModel: {
    type: String,
    trim: true,
  },
  claudeApiKey: {
    type: String,
    trim: true,
  },
  claudeModel: {
    type: String,
    trim: true,
  },
}, {
  versionKey: false,
  timestamps: true,
});

export const UserAiSettings = model<IUserAiSettingsCollection>(
  'UserAiSettings',
  UserAiSettingsSchema,
  'userAiSettings',
);
