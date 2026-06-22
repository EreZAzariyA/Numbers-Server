import { AgentInsights } from '../collections';
import { IAgentInsightModel, InsightType, InsightFinding, InsightLang } from '../models';
import { Types } from 'mongoose';

class AgentInsightsLogic {
  upsert = async (
    user_id: string,
    type: InsightType,
    date: string,
    findings: InsightFinding[],
    aiSummary?: string,
    language: InsightLang = 'en',
  ): Promise<void> => {
    await AgentInsights.replaceOne(
      {
        user_id: new Types.ObjectId(user_id),
        type,
        date,
        language,
      },
      {
        user_id: new Types.ObjectId(user_id),
        type,
        date,
        language,
        findings,
        ...(aiSummary && { aiSummary }),
        generatedAt: new Date(),
      },
      { upsert: true },
    ).exec();
  };

  getLatestDigest = async (
    user_id: string,
    language: InsightLang = 'en',
  ): Promise<{ aiSummary?: string; findings: InsightFinding[]; generatedAt: Date } | null> => {
    const result = await AgentInsights.findOne({
      user_id: new Types.ObjectId(user_id),
      type: 'dashboard-digest',
      language,
    })
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

  getRecentFindings = async (
    user_id: string,
    sinceDate: string,
    language: InsightLang = 'en',
  ): Promise<IAgentInsightModel[]> =>
    AgentInsights.find({
      user_id: new Types.ObjectId(user_id),
      type: { $ne: 'dashboard-digest' },
      date: { $gte: sinceDate },
      language,
    })
      .sort({ generatedAt: -1 })
      .lean<IAgentInsightModel[]>()
      .exec();
}

const agentInsightsLogic = new AgentInsightsLogic();
export default agentInsightsLogic;
