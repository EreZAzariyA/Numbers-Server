import categoriesLogic from '../categories';
import bankLogic from '../banks';
import savingsGoalsLogic from '../savings-goals';
import transactionsLogic from '../transactions';
import { overridePattern } from '../recurring/pattern-service';
import { ClientError } from '../../models';
import type { MainTransactionType, PatternClass } from '../../utils/types';
import { AgentToolDefinition, ToolHost } from './tool-types';
import { localize, roundAmount, TRANSACTION_SOURCE_ENUM } from './tool-helpers';

export const createMutationTools = (host: ToolHost): AgentToolDefinition[] => {
    return [
      {
        name: 'create_savings_goal',
        description: 'Stage creation of a new savings goal.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Goal name.' },
            target_amount: { type: 'number', description: 'Target amount in shekels.' },
            current_amount: { type: 'number', description: 'Current saved amount in shekels.' },
            target_date: { type: 'string', description: 'Target date in YYYY-MM-DD format.' },
          },
          required: ['name', 'target_amount', 'target_date'],
        },
        summarize: (args) => `Create savings goal "${args.name}" for ₪${args.target_amount}.`,
        execute: async (args, context) => {
          const goal = await savingsGoalsLogic.addGoal(context.user_id, {
            name: args.name,
            targetAmount: Number(args.target_amount),
            currentAmount: Number(args.current_amount ?? 0),
            targetDate: args.target_date,
          });

          return {
            goal_id: goal._id?.toString?.() ?? '',
            name: goal.name,
            targetAmount: goal.targetAmount,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Created the savings goal **${result.name || args.name}** with a target of **₪${roundAmount(result.targetAmount || args.target_amount)}**.`,
          `יצרתי את יעד החיסכון **${result.name || args.name}** עם יעד של **₪${roundAmount(result.targetAmount || args.target_amount)}**.`,
        ),
      },
      {
        name: 'update_savings_goal',
        description: 'Stage updates to an existing savings goal.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            goal_id: { type: 'string', description: 'Savings goal id.' },
            name: { type: 'string', description: 'Updated goal name.' },
            target_amount: { type: 'number', description: 'Updated target amount.' },
            current_amount: { type: 'number', description: 'Updated current amount.' },
            target_date: { type: 'string', description: 'Updated target date in YYYY-MM-DD format.' },
          },
          required: ['goal_id'],
        },
        summarize: (args) => `Update savings goal ${args.goal_id}.`,
        argsPreview: (args) => ({
          goal_id: args.goal_id,
          name: args.name,
          target_amount: args.target_amount,
          current_amount: args.current_amount,
          target_date: args.target_date,
        }),
        execute: async (args, context) => {
          const goal = await host.getSavingsGoalById(context.user_id, args.goal_id);
          goal.name = args.name ?? goal.name;
          goal.targetAmount = args.target_amount ?? goal.targetAmount;
          goal.currentAmount = args.current_amount ?? goal.currentAmount;
          goal.targetDate = args.target_date ?? goal.targetDate;
          const updated = await savingsGoalsLogic.updateGoal(context.user_id, goal);

          return {
            goal_id: updated._id?.toString?.() ?? args.goal_id,
            name: updated.name,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Updated the savings goal **${result.name || args.goal_id}**.`,
          `עדכנתי את יעד החיסכון **${result.name || args.goal_id}**.`,
        ),
      },
      {
        name: 'delete_savings_goal',
        description: 'Stage deletion of a savings goal.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            goal_id: { type: 'string', description: 'Savings goal id.' },
          },
          required: ['goal_id'],
        },
        summarize: (args) => `Delete savings goal ${args.goal_id}.`,
        execute: async (args, context) => {
          const existingGoal = await host.getSavingsGoalById(context.user_id, args.goal_id);
          const goalName = existingGoal.name;
          await savingsGoalsLogic.removeGoal(context.user_id, args.goal_id);
          return { goal_id: args.goal_id, name: goalName };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Deleted the savings goal **${result.name || args.goal_id}**.`,
          `מחקתי את יעד החיסכון **${result.name || args.goal_id}**.`,
        ),
      },
      {
        name: 'create_category',
        description: 'Stage creation of a new category.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Category name.' },
          },
          required: ['name'],
        },
        summarize: (args) => `Create category "${args.name}".`,
        execute: async (args, context) => {
          const category = await categoriesLogic.addNewCategory(args.name, context.user_id);
          return {
            category_id: category._id?.toString?.() ?? '',
            name: category.name,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Created the category **${result.name || args.name}**.`,
          `יצרתי את הקטגוריה **${result.name || args.name}**.`,
        ),
      },
      {
        name: 'rename_category',
        description: 'Stage renaming an existing category.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            category_id: { type: 'string', description: 'Category id.' },
            category_name: { type: 'string', description: 'Current category name if the id is unknown.' },
            new_name: { type: 'string', description: 'New category name.' },
          },
          required: ['new_name'],
        },
        summarize: (args) => `Rename category to "${args.new_name}".`,
        execute: async (args, context) => {
          const category = await host.resolveCategory(context.user_id, {
            category_id: args.category_id,
            category_name: args.category_name,
          });
          const existingWithNewName = await categoriesLogic.fetchUserCategory(context.user_id, args.new_name);
          if (existingWithNewName && existingWithNewName._id.toString() !== category._id.toString()) {
            throw new ClientError(409, 'Category name is already in use.');
          }

          category.name = args.new_name;
          const updated = await categoriesLogic.updateCategory(category, context.user_id);

          return {
            category_id: updated._id?.toString?.() ?? category._id.toString(),
            name: updated.name,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Renamed the category to **${result.name || args.new_name}**.`,
          `שיניתי את שם הקטגוריה ל-**${result.name || args.new_name}**.`,
        ),
      },
      {
        name: 'update_category_budget',
        description: 'Stage updates to a category budget limit. Supply at least one of category_id or category_name. maximum_amount is optional when only toggling active.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            category_id: { type: 'string', description: 'Category id.' },
            category_name: { type: 'string', description: 'Category name if the id is unknown.' },
            maximum_amount: { type: 'number', description: 'Budget cap in shekels. Required when setting or updating the cap.' },
            active: { type: 'boolean', description: 'Whether the budget cap should stay active.' },
          },
        },
        summarize: (args) => args.maximum_amount !== undefined
          ? `Update category budget to ₪${args.maximum_amount}.`
          : `Toggle category budget active: ${args.active}.`,
        execute: async (args, context) => {
          if (!args.category_id && !args.category_name) {
            throw new ClientError(400, 'Provide category_id or category_name.');
          }
          const hasMaximumAmount = args.maximum_amount !== undefined;
          const activeValue = typeof args.active === 'boolean' ? args.active : undefined;
          const hasActiveToggle = activeValue !== undefined;
          if (!hasMaximumAmount && !hasActiveToggle) {
            throw new ClientError(400, 'Provide maximum_amount or active.');
          }

          const category = await host.resolveCategory(context.user_id, {
            category_id: args.category_id,
            category_name: args.category_name,
          });
          const existingBudget = category.maximumSpentAllowed;
          if (hasMaximumAmount) {
            const maximumAmount = Number(args.maximum_amount);
            if (!Number.isFinite(maximumAmount) || maximumAmount < 0) {
              throw new ClientError(400, 'maximum_amount must be a non-negative number.');
            }
            category.maximumSpentAllowed = {
              active: activeValue ?? existingBudget?.active ?? true,
              maximumAmount,
            };
          } else if (hasActiveToggle) {
            if (!existingBudget || existingBudget.maximumAmount === undefined) {
              throw new ClientError(400, 'Cannot toggle a budget before a maximum_amount is set.');
            }
            category.maximumSpentAllowed.active = activeValue;
          }
          const updated = await categoriesLogic.updateCategory(category, context.user_id);

          return {
            category_id: updated._id?.toString?.() ?? category._id.toString(),
            name: updated.name,
            maximumAmount: updated.maximumSpentAllowed?.maximumAmount,
            active: updated.maximumSpentAllowed?.active,
            changed: hasMaximumAmount ? 'amount' : 'active',
          };
        },
        buildResultReply: (_args, result, language) => result.changed === 'active'
          ? localize(
            language,
            `Set the budget for **${result.name}** to **${result.active ? 'active' : 'inactive'}**.`,
            `הגדרתי את התקציב של **${result.name}** ל-**${result.active ? 'פעיל' : 'לא פעיל'}**.`,
          )
          : localize(
            language,
            `Updated the budget for **${result.name}** to **₪${roundAmount(result.maximumAmount)}**.`,
            `עדכנתי את התקציב של **${result.name}** ל-**₪${roundAmount(result.maximumAmount)}**.`,
          ),
      },
      {
        name: 'confirm_recurring_pattern',
        description: 'Stage confirmation for a recurring pattern. Pass pattern_name (from get_recurring_commitments) as a hint so the confirmation card shows a readable label.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            pattern_id: { type: 'string', description: 'Recurring pattern id.' },
            pattern_name: { type: 'string', description: 'Human-readable pattern name (merchant / description) for the confirmation card.' },
          },
          required: ['pattern_id'],
        },
        summarize: (args) => `Confirm recurring pattern: ${args.pattern_name || args.pattern_id}.`,
        execute: async (args, context) => {
          const updated = await overridePattern(context.user_id, args.pattern_id, { confirmed: true });
          if (!updated) throw new ClientError(404, 'Recurring pattern not found.');
          const patternName = (updated as any).signals?.descriptionVariants?.[0] ?? (updated as any).merchantKey ?? args.pattern_id;
          return { pattern_id: args.pattern_id, pattern_name: patternName };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Confirmed the recurring pattern **${result.pattern_name || result.pattern_id}**.`,
          `אישרתי את הדפוס החוזר **${result.pattern_name || result.pattern_id}**.`,
        ),
      },
      {
        name: 'disable_recurring_pattern',
        description: 'Stage disabling of a recurring pattern. Pass pattern_name (from get_recurring_commitments) as a hint so the confirmation card shows a readable label.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            pattern_id: { type: 'string', description: 'Recurring pattern id.' },
            pattern_name: { type: 'string', description: 'Human-readable pattern name (merchant / description) for the confirmation card.' },
          },
          required: ['pattern_id'],
        },
        summarize: (args) => `Disable recurring pattern: ${args.pattern_name || args.pattern_id}.`,
        execute: async (args, context) => {
          const updated = await overridePattern(context.user_id, args.pattern_id, { disabled: true });
          if (!updated) throw new ClientError(404, 'Recurring pattern not found.');
          const patternName = (updated as any).signals?.descriptionVariants?.[0] ?? (updated as any).merchantKey ?? args.pattern_id;
          return { pattern_id: args.pattern_id, pattern_name: patternName };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Disabled the recurring pattern **${result.pattern_name || result.pattern_id}**.`,
          `נטרלתי את הדפוס החוזר **${result.pattern_name || result.pattern_id}**.`,
        ),
      },
      {
        name: 'update_recurring_pattern',
        description: 'Stage overrides for a recurring pattern amount, frequency, or classification.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            pattern_id: { type: 'string', description: 'Recurring pattern id.' },
            custom_amount: { type: 'number', description: 'Updated recurring amount in shekels.' },
            custom_frequency: { type: 'string', description: 'Updated recurring frequency.' },
            custom_classification: { type: 'string', description: 'Updated classification label.' },
            confirmed: { type: 'boolean', description: 'Optional confirmed override.' },
            disabled: { type: 'boolean', description: 'Optional disabled override.' },
          },
          required: ['pattern_id'],
        },
        summarize: (args) => `Update recurring pattern ${args.pattern_id}.`,
        argsPreview: (args) => ({
          pattern_id: args.pattern_id,
          custom_amount: args.custom_amount,
          custom_frequency: args.custom_frequency,
          custom_classification: args.custom_classification,
          confirmed: args.confirmed,
          disabled: args.disabled,
        }),
        execute: async (args, context) => {
          const patch: Partial<{
            confirmed: boolean;
            disabled: boolean;
            customAmount: number;
            customFrequency: string;
            customClassification: PatternClass;
          }> = {};
          if (args.custom_amount !== undefined) patch.customAmount = Number(args.custom_amount);
          if (args.custom_frequency !== undefined) patch.customFrequency = String(args.custom_frequency);
          if (args.custom_classification !== undefined) patch.customClassification = String(args.custom_classification) as PatternClass;
          if (args.confirmed !== undefined) patch.confirmed = Boolean(args.confirmed);
          if (args.disabled !== undefined) patch.disabled = Boolean(args.disabled);
          if (Object.keys(patch).length === 0) {
            throw new ClientError(400, 'No recurring override fields were provided.');
          }

          const updated = await overridePattern(context.user_id, args.pattern_id, patch);
          if (!updated) throw new ClientError(404, 'Recurring pattern not found.');
          return { pattern_id: args.pattern_id };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Updated the recurring pattern **${result.pattern_id}**.`,
          `עדכנתי את הדפוס החוזר **${result.pattern_id}**.`,
        ),
      },
      {
        name: 'reassign_transaction_category',
        description: 'Stage reassignment of a transaction to a different category.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            transaction_id: { type: 'string', description: 'Transaction id.' },
            transaction_type: {
              type: 'string',
              enum: TRANSACTION_SOURCE_ENUM,
              description: 'Transaction collection type when known. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
            },
            category_id: { type: 'string', description: 'Target category id.' },
            category_name: { type: 'string', description: 'Target category name when the id is unknown.' },
          },
          required: ['transaction_id'],
        },
        summarize: (args) => `Reassign transaction ${args.transaction_id} to another category.`,
        execute: async (args, context) => {
          const category = await host.resolveCategory(context.user_id, {
            category_id: args.category_id,
            category_name: args.category_name,
          });
          const { transaction, type } = await host.resolveTransaction(context.user_id, args.transaction_id, args.transaction_type);
          transaction.category_id = category._id as MainTransactionType['category_id'];
          const updated = await transactionsLogic.updateTransaction(context.user_id, transaction, type);

          return {
            transaction_id: updated._id?.toString?.() ?? args.transaction_id,
            category_name: category.name,
            description: updated.description,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Reassigned **${result.description || 'the transaction'}** to **${result.category_name}**.`,
          `שיייכתי מחדש את **${result.description || 'העסקה'}** ל-**${result.category_name}**.`,
        ),
      },
      {
        name: 'edit_transaction',
        description: 'Stage edits to an existing transaction (description, amount, or dates). To change the category, use reassign_transaction_category instead.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            transaction_id: { type: 'string', description: 'Transaction id.' },
            transaction_type: {
              type: 'string',
              enum: TRANSACTION_SOURCE_ENUM,
              description: 'Transaction collection type when known. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
            },
            description: { type: 'string', description: 'Updated description.' },
            amount: { type: 'number', description: 'Updated signed amount.' },
            event_date: { type: 'string', description: 'Updated event date in YYYY-MM-DD format.' },
            posting_date: { type: 'string', description: 'Updated posting date in YYYY-MM-DD format.' },
          },
          required: ['transaction_id'],
        },
        summarize: (args) => `Edit transaction ${args.transaction_id}.`,
        argsPreview: (args) => ({
          transaction_id: args.transaction_id,
          description: args.description,
          amount: args.amount,
          event_date: args.event_date,
          posting_date: args.posting_date,
        }),
        execute: async (args, context) => {
          const { transaction, type } = await host.resolveTransaction(context.user_id, args.transaction_id, args.transaction_type);
          const hasAnyUpdate = [
            args.description,
            args.amount,
            args.event_date,
            args.posting_date,
          ].some((value) => value !== undefined);
          if (!hasAnyUpdate) {
            throw new ClientError(400, 'No transaction update fields were provided.');
          }

          transaction.description = args.description ?? transaction.description;
          transaction.amount = args.amount ?? transaction.amount;
          transaction.eventDate = args.event_date ?? transaction.eventDate;
          transaction.postingDate = args.posting_date ?? transaction.postingDate;
          transaction.date = args.event_date ?? transaction.date ?? transaction.eventDate;
          transaction.processedDate = args.posting_date ?? transaction.processedDate ?? transaction.postingDate;

          const updated = await transactionsLogic.updateTransaction(context.user_id, transaction, type);

          return {
            transaction_id: updated._id?.toString?.() ?? args.transaction_id,
            description: updated.description,
            amount: updated.amount,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Updated **${result.description || 'the transaction'}** to **₪${roundAmount(result.amount)}**.`,
          `עדכנתי את **${result.description || 'העסקה'}** ל-**₪${roundAmount(result.amount)}**.`,
        ),
      },
      {
        name: 'refresh_bank_account',
        description: 'Stage a refresh for a connected bank account.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            bank_id: { type: 'string', description: 'Bank account id.' },
          },
          required: ['bank_id'],
        },
        summarize: (args) => `Refresh bank account ${args.bank_id}.`,
        execute: async (args, context) => {
          const bank = await bankLogic.fetchOneBankAccount(context.user_id, args.bank_id);
          if (!bank) throw new ClientError(404, 'Bank account not found.');
          const refreshed = await bankLogic.refreshBankData(args.bank_id, context.user_id);
          return {
            bank_id: args.bank_id,
            bank_name: bank.bankName || bank.details?.accountNumber || args.bank_id,
            importedTransactions: refreshed.importedTransactions?.length ?? 0,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Refreshed **${result.bank_name}** and imported **${result.importedTransactions}** transactions.`,
          `רעננתי את **${result.bank_name}** וייבאתי **${result.importedTransactions}** עסקאות.`,
        ),
      },
      {
        name: 'set_main_bank_account',
        description: 'Stage a change to the main bank account.',
        mode: 'mutate',
        schema: {
          type: 'object',
          properties: {
            bank_id: { type: 'string', description: 'Bank account id.' },
          },
          required: ['bank_id'],
        },
        summarize: (args) => `Set bank account ${args.bank_id} as the main account.`,
        execute: async (args, context) => {
          const bank = await bankLogic.fetchOneBankAccount(context.user_id, args.bank_id);
          if (!bank) throw new ClientError(404, 'Bank account not found.');
          await bankLogic.setMainBankAccount(context.user_id, args.bank_id);
          return {
            bank_id: args.bank_id,
            bank_name: bank.bankName || bank.details?.accountNumber || args.bank_id,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Set **${result.bank_name}** as the main bank account.`,
          `הגדרתי את **${result.bank_name}** כחשבון הבנק הראשי.`,
        ),
      },
    ];
};
