import { AgentInsights } from '../collections';
import { IAgentInsightModel, InsightType, InsightFinding } from '../models';
import { Types } from 'mongoose';

class AgentInsightsLogic {
  /**
   * Upserts an agent insight document using replaceOne with upsert: true.
   * Replaces the entire document for the given user, type, and date combination.
   */
  upsert = async (
    user_id: string,
    type: InsightType,
    date: string,
    findings: InsightFinding[],
    aiSummary?: string,
  ): Promise<void> => {
    await AgentInsights.replaceOne(
      {
        user_id: new Types.ObjectId(user_id),
        type,
        date,
      },
      {
        user_id: new Types.ObjectId(user_id),
        type,
        date,
        findings,
        ...(aiSummary && { aiSummary }),
        generatedAt: new Date(),
      },
      { upsert: true },
    ).exec();
  };

  /**
   * Retrieves the most recent dashboard digest for the user.
   * Returns the latest document by generatedAt, or null if none exists.
   */
  getLatestDigest = async (
    user_id: string,
  ): Promise<{ aiSummary?: string; findings: InsightFinding[]; generatedAt: Date } | null> => {
    const result = await AgentInsights.findOne(
      {
        user_id: new Types.ObjectId(user_id),
        type: 'dashboard-digest',
      },
    )
      .sort({ generatedAt: -1 })
      .lean<IAgentInsightModel>()
      .exec();

    if (!result) return null;

    return {
      aiSummary: result.aiSummary,
      findings: result.findings,
      generatedAt: result.generatedAt,
    };
  };

  /**
   * Retrieves recent findings for the user, excluding dashboard digests.
   * Returns all documents where date >= sinceDate, sorted by generatedAt descending.
   */
  getRecentFindings = async (
    user_id: string,
    sinceDate: string,
  ): Promise<IAgentInsightModel[]> =>
    AgentInsights.find({
      user_id: new Types.ObjectId(user_id),
      type: { $ne: 'dashboard-digest' },
      date: { $gte: sinceDate },
    })
      .sort({ generatedAt: -1 })
      .lean<IAgentInsightModel[]>()
      .exec();
}

const agentInsightsLogic = new AgentInsightsLogic();
export default agentInsightsLogic;
