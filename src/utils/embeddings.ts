import { GoogleGenerativeAI } from '@google/generative-ai';
import type { EmbedContentRequest } from '@google/generative-ai';
import { createOllamaClient } from './ollama-client';
import type { EmbeddingProviderConfig } from '../bll/ai-settings';

const REQUIRED_DIMENSIONS = 768;

export type VectorEmbeddingProvider = 'gemini' | 'ollama';

export type EmbeddingResult = {
  embedding: number[];
  provider: VectorEmbeddingProvider;
  model: string;
};

// gemini-embedding-001 defaults to 3072 dimensions. The SDK's EmbedContentRequest
// type predates outputDimensionality, but the v1beta REST endpoint honors it and the
// SDK forwards unknown fields verbatim. This extension keeps the call strictly typed.
type GeminiEmbedRequest = EmbedContentRequest & { outputDimensionality?: number };

const embedWithGemini = async (apiKey: string, model: string, text: string): Promise<number[]> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const embeddingModel = genAI.getGenerativeModel({ model });
  const request: GeminiEmbedRequest = {
    content: { role: '', parts: [{ text }] },
    outputDimensionality: REQUIRED_DIMENSIONS,
  };
  const result = await embeddingModel.embedContent(request);
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
    console.warn(
      `Embedding discarded: ${config.provider}/${config.model} returned ${embedding.length} dimensions, expected ${REQUIRED_DIMENSIONS}.`,
    );
    return null;
  }

  return { embedding, provider: config.provider, model: config.model };
};
