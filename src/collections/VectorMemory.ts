import { Document, Schema, model } from 'mongoose';

export type VectorEmbeddingProvider = 'gemini' | 'ollama';

export interface IVectorMemoryCollection extends Document {
  user_id: string;
  content: string;
  embedding: number[];
  embeddingProvider: VectorEmbeddingProvider;
  embeddingModel: string;
  createdAt: Date;
}

const VectorMemorySchema = new Schema<IVectorMemoryCollection>({
  user_id: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
  },
  embedding: {
    type: [Number],
    required: true,
  },
  embeddingProvider: {
    type: String,
    enum: ['gemini', 'ollama'],
    required: true,
  },
  embeddingModel: {
    type: String,
    required: true,
    trim: true,
  },
}, {
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
});

VectorMemorySchema.index({ user_id: 1, embeddingProvider: 1, embeddingModel: 1 });

export const VectorMemory = model<IVectorMemoryCollection>(
  'VectorMemory',
  VectorMemorySchema,
  'vectorMemories',
);
