import { GoogleGenerativeAI } from '@google/generative-ai';
import { createOllamaClient } from './ollama-client';
import type { EmbeddingProviderConfig } from '../bll/ai-settings';
import type { VectorEmbeddingProvider } from '../collections/VectorMemory';

const REQUIRED_DIMENSIONS = 768;

export type EmbeddingResult = {
  embedding: number[];
  provider: VectorEmbeddingProvider;
  model: string;
};

const embedWithGemini = async (apiKey: string, model: string, text: string): Promise<number[]> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const embeddingModel = genAI.getGenerativeModel({ model });
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
};

const embedWithOllama = async (model: string, text: string): Promise<number[]> => {
  const client = createOllamaClient();
  const response = await client.embeddings.create({ model, input: text });
  return response.data[0].embedding;
};

export const embed = async (config: EmbeddingProviderConfig, text: string): Promise<EmbeddingResult | null> => {
  let embedding: number[];

  if (config.provider === 'gemini') {
    embedding = await embedWithGemini(config.apiKey, config.model, text);
  } else {
    embedding = await embedWithOllama(config.model, text);
  }

  if (embedding.length !== REQUIRED_DIMENSIONS) {
    return null;
  }

  return { embedding, provider: config.provider, model: config.model };
};
