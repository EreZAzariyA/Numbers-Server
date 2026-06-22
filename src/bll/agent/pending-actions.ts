import { AgentPendingActions } from '../../collections';
import { ClientError } from '../../models';
import type { IAgentPendingActionCollection, PendingAgentActionStatus } from '../../collections/AgentPendingActions';
import type { AgentToolDefinition, PendingActionView, SupportedLanguage, ToolExecutionContext } from './tool-types';
import { localize } from './tool-helpers';

export const PENDING_ACTION_TTL_MS = 1000 * 60 * 10;

export async function stagePendingAction(
  definition: AgentToolDefinition,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<unknown> {
  if (context.stagedActionRef.value) {
    return {
      error: 'An action is already waiting for confirmation. Ask the user to confirm or cancel it first.',
    };
  }

  await expireStalePendingActions(context.user_id);
  await cancelAllPendingActions(context.user_id);

  const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);
  const preview = definition.argsPreview
    ? definition.argsPreview(args)
    : buildDefaultArgsPreview(args);
  const doc = await AgentPendingActions.create({
    user_id: context.user_id,
    tool: definition.name,
    summary: definition.summarize(args),
    args,
    argsPreview: preview,
    status: 'pending',
    expiresAt,
  });

  const pendingAction = toPendingActionView(doc);
  context.stagedActionRef.value = pendingAction;
  context.emitProgress?.('staging-action', definition.name);

  return {
    requires_confirmation: true,
    pending_action: pendingAction,
    message: 'The action has been staged and now requires confirmation in the chat UI.',
  };
}

export async function loadLatestPendingAction(user_id: string): Promise<PendingActionView | null> {
  await expireStalePendingActions(user_id);
  const doc = await AgentPendingActions.findOne({ user_id, status: 'pending' })
    .sort({ createdAt: -1 })
    .exec();

  return doc ? toPendingActionView(doc) : null;
}

export async function loadPendingActionOrThrow(
  user_id: string,
  actionId: string,
): Promise<IAgentPendingActionCollection> {
  await expireStalePendingActions(user_id);
  const action = await AgentPendingActions.findOne({ _id: actionId, user_id }).exec();
  if (!action) {
    throw new ClientError(404, 'Pending action not found.');
  }
  return action;
}

export async function expireStalePendingActions(user_id?: string): Promise<void> {
  const now = new Date();
  const query: Record<string, unknown> = {
    status: 'pending',
    expiresAt: { $lte: now },
  };
  if (user_id) query.user_id = user_id;

  await AgentPendingActions.updateMany(query, {
    $set: { status: 'expired', expiredAt: now },
  }).exec();
}

export async function cancelAllPendingActions(user_id: string): Promise<void> {
  await AgentPendingActions.updateMany({ user_id, status: 'pending' }, {
    $set: { status: 'cancelled', cancelledAt: new Date() },
  }).exec();
}

export function toPendingActionView(
  action: Pick<IAgentPendingActionCollection, '_id' | 'tool' | 'summary' | 'argsPreview' | 'expiresAt'>,
): PendingActionView {
  return {
    id: action._id.toString(),
    tool: action.tool,
    summary: action.summary,
    argsPreview: action.argsPreview ?? {},
    expiresAt: action.expiresAt.toISOString(),
  };
}

export function buildDefaultArgsPreview(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.slice(0, 5) : value,
    ]),
  );
}

export function buildInactiveActionMessage(
  status: PendingAgentActionStatus,
  language: SupportedLanguage,
): string {
  switch (status) {
    case 'confirmed':
      return localize(language, 'That action was already confirmed.', 'הפעולה הזו כבר אושרה.');
    case 'cancelled':
      return localize(language, 'That action was already cancelled.', 'הפעולה הזו כבר בוטלה.');
    case 'expired':
    default:
      return localize(language, 'That action has expired. Please ask again.', 'הפעולה הזו פגה. בקש שוב.');
  }
}
