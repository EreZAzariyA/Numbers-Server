import { Document, Schema, model } from 'mongoose';

export type AiProvider = 'ollama' | 'gemini' | 'claude';

export interface IUserAiSettingsCollection extends Document {
  user_id: string;
  provider: AiProvider;
  geminiApiKey?: string;
  claudeApiKey?: string;
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
  geminiApiKey: {
    type: String,
    trim: true,
  },
  claudeApiKey: {
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
