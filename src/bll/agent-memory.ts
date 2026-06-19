import { VectorMemory } from '../collections/VectorMemory';
import aiSettingsLogic from './ai-settings';
import { embed } from '../utils/embeddings';

const IS_ATLAS = process.env.NODE_ENV === 'production';
const ATLAS_VECTOR_INDEX = 'vector_index';
const TOP_K = 5;
const NUM_CANDIDATES = TOP_K * 10;

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
    const config = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!config) return;

    const content = `User: ${userMessage}\nAssistant: ${assistantReply}`;
    const result = await embed(config, content);
    if (!result) return;

    await VectorMemory.create({
      user_id,
      content,
      embedding: result.embedding,
      embeddingProvider: result.provider,
      embeddingModel: result.model,
    });
  }

  async recall(user_id: string, query: string): Promise<string[]> {
    const config = await aiSettingsLogic.resolveEmbeddingProvider(user_id);
    if (!config) return [];

    const result = await embed(config, query);
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
      .filter((m) => m.score > 0.5)
      .map((m) => m.content);
  }
}

const agentMemory = new AgentMemory();
export default agentMemory;
