import { randomUUID } from 'crypto';
import aiSettingsLogic from './ai-settings';
import { embed } from '../utils/embeddings';
import appConfig from '../utils/config';
import {
  upsertPoint,
  searchPoints,
  countPoints,
  scrollPoints,
  deletePointsByIds,
} from '../utils/qdrant-client';

const TOP_K = 5;
const MAX_MEMORIES_PER_USER = 200;
const MIN_RECALL_SCORE = 0.5;

class AgentMemory {
  async save(user_id: string, userMessage: string, assistantReply: string): Promise<void> {
    const embeddingConfig = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!embeddingConfig) return;

    const content = `User: ${userMessage}\nAssistant: ${assistantReply}`;
    const result = await embed(embeddingConfig, content);
    if (!result) return;

    const pointId = randomUUID();
    const point = {
      id: pointId,
      vector: result.embedding,
      payload: {
        user_id,
        content,
        embeddingProvider: result.provider,
        embeddingModel: result.model,
        createdAt: Date.now(),
      },
    };

    await upsertPoint(appConfig.qdrantUrl, point);

    const userIdFilter = {
      must: [{ key: 'user_id', match: { value: user_id } }],
    };

    const count = await countPoints(appConfig.qdrantUrl, userIdFilter);
    if (count > MAX_MEMORIES_PER_USER) {
      const excess = await scrollPoints(
        appConfig.qdrantUrl,
        userIdFilter,
        count - MAX_MEMORIES_PER_USER,
        true,
      );

      if (excess.length > 0) {
        const excessIds = excess.map((e) => e.id);
        await deletePointsByIds(appConfig.qdrantUrl, excessIds);
      }
    }
  }

  async reembed(user_id: string): Promise<void> {
    const embeddingConfig = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!embeddingConfig) return;

    const userIdFilter = {
      must: [{ key: 'user_id', match: { value: user_id } }],
    };

    const allPoints = await scrollPoints(
      appConfig.qdrantUrl,
      userIdFilter,
      MAX_MEMORIES_PER_USER,
      false,
    );

    for (const point of allPoints) {
      const payload = point.payload as Record<string, unknown>;
      const currentProvider = payload.embeddingProvider as string;
      const currentModel = payload.embeddingModel as string;

      if (
        currentProvider !== embeddingConfig.provider ||
        currentModel !== embeddingConfig.model
      ) {
        const content = payload.content as string;
        const newResult = await embed(embeddingConfig, content);
        if (!newResult) continue;

        const updatedPoint = {
          id: point.id,
          vector: newResult.embedding,
          payload: {
            ...payload,
            embeddingProvider: newResult.provider,
            embeddingModel: newResult.model,
          },
        };

        await upsertPoint(appConfig.qdrantUrl, updatedPoint);
      }
    }
  }

  async recall(user_id: string, query: string): Promise<string[]> {
    const embeddingConfig = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!embeddingConfig) return [];

    const result = await embed(embeddingConfig, query);
    if (!result) return [];

    const { embedding, provider, model } = result;

    const filter = {
      must: [
        { key: 'user_id', match: { value: user_id } },
        { key: 'embeddingProvider', match: { value: provider } },
        { key: 'embeddingModel', match: { value: model } },
      ],
    };

    const searchResults = await searchPoints(
      appConfig.qdrantUrl,
      embedding,
      filter,
      TOP_K,
      MIN_RECALL_SCORE,
    );

    return searchResults.map((r) => r.payload.content);
  }
}

const agentMemory = new AgentMemory();
export default agentMemory;
