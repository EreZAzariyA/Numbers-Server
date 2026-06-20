import { VectorMemory } from '../collections/VectorMemory';
import aiSettingsLogic from './ai-settings';
import { embed } from '../utils/embeddings';
import appConfig from '../utils/config';

const IS_ATLAS = appConfig.mongoConnectionString?.startsWith('mongodb+srv://') ?? false;
const ATLAS_VECTOR_INDEX = 'vector_index';
const TOP_K = 5;
const NUM_CANDIDATES = TOP_K * 10;
const MAX_MEMORIES_PER_USER = 200;
const MIN_RECALL_SCORE = 0.5;

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
};

class AgentMemory {
  async save(user_id: string, userMessage: string, assistantReply: string): Promise<void> {
    const embeddingConfig = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!embeddingConfig) return;

    const content = `User: ${userMessage}\nAssistant: ${assistantReply}`;
    const result = await embed(embeddingConfig, content);
    if (!result) return;

    await VectorMemory.create({
      user_id,
      content,
      embedding: result.embedding,
      embeddingProvider: result.provider,
      embeddingModel: result.model,
    });

    // Prune oldest entries beyond cap to prevent unbounded growth and slow in-memory scans.
    const count = await VectorMemory.countDocuments({ user_id });
    if (count > MAX_MEMORIES_PER_USER) {
      const toDelete = await VectorMemory
        .find({ user_id }, { _id: 1 })
        .sort({ createdAt: 1 })
        .limit(count - MAX_MEMORIES_PER_USER)
        .lean()
        .exec();
      if (toDelete.length > 0) {
        await VectorMemory.deleteMany({ _id: { $in: toDelete.map((d) => d._id) } });
      }
    }
  }

  async reembed(user_id: string): Promise<void> {
    const embeddingConfig = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!embeddingConfig) return;

    const stale = await VectorMemory
      .find(
        {
          user_id,
          $or: [
            { embeddingProvider: { $ne: embeddingConfig.provider } },
            { embeddingModel: { $ne: embeddingConfig.model } },
          ],
        },
        { _id: 1, content: 1 },
      )
      .lean()
      .exec();

    for (const memory of stale) {
      const result = await embed(embeddingConfig, memory.content);
      if (!result) continue;

      await VectorMemory.updateOne(
        { _id: memory._id },
        {
          $set: {
            embedding: result.embedding,
            embeddingProvider: result.provider,
            embeddingModel: result.model,
          },
        },
      );
    }
  }

  async recall(user_id: string, query: string): Promise<string[]> {
    const embeddingConfig = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!embeddingConfig) return [];

    const result = await embed(embeddingConfig, query);
    if (!result) return [];

    const { embedding, provider, model } = result;

    if (IS_ATLAS) {
      const docs = await VectorMemory.aggregate([
        {
          $vectorSearch: {
            index: ATLAS_VECTOR_INDEX,
            path: 'embedding',
            queryVector: embedding,
            numCandidates: NUM_CANDIDATES,
            limit: TOP_K,
            filter: { user_id, embeddingProvider: provider, embeddingModel: model },
          },
        },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
        { $match: { score: { $gte: MIN_RECALL_SCORE } } },
        { $project: { content: 1, _id: 0 } },
      ]);
      return docs.map((d: { content: string }) => d.content);
    }

    const memories = await VectorMemory
      .find({ user_id, embeddingProvider: provider, embeddingModel: model }, { content: 1, embedding: 1 })
      .lean()
      .exec();

    return memories
      .map((m) => ({ content: m.content, score: cosineSimilarity(embedding, m.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K)
      .filter((m) => m.score > MIN_RECALL_SCORE)
      .map((m) => m.content);
  }
}

const agentMemory = new AgentMemory();
export default agentMemory;
