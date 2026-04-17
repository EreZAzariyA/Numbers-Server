import { IRecurringPatternModel } from '../../models/recurring-pattern-model';
import { ProjectedEvent, Frequency, PatternAnchor, PatternClass } from '../../utils/types';
import { nextOccurrence } from './frequency-detection';
import { addDays, diffDays } from '../../utils/date-helpers';

/**
 * Generate projected events for a given date window from stored patterns.
 *
 * Classification-specific rules:
 *  - `one_time` or confidence < 0.4 → never project.
 *  - `installment_plan` → project only remaining installments.
 *  - All others → project based on frequency within the window.
 */
export const projectMonth = (
  patterns: IRecurringPatternModel[],
  monthStart: string,
  monthEnd: string,
): ProjectedEvent[] => {
  const events: ProjectedEvent[] = [];

  for (const p of patterns) {
    if (p.userOverride?.disabled) continue;
    if (p.classification === 'one_time') continue;
    if (p.confidence < 0.4) continue;

    const freq: Frequency = (p.userOverride?.customFrequency ?? p.frequency) as Frequency;
    if (freq === 'unknown') continue;

    const effectiveAmount = p.userOverride?.customAmount ?? p.amount.mean;
    const effectiveClass = (p.userOverride?.customClassification ?? p.classification) as PatternClass;
    const anchor: PatternAnchor = p.anchor;

    // Installment plan: cap at remaining payments.
    let maxOccurrences = Infinity;
    if (p.installmentPlan && p.installmentPlan.paymentsRemaining > 0) {
      maxOccurrences = p.installmentPlan.paymentsRemaining;
    }

    // Walk forward from lastSeen, emitting events that fall in [monthStart, monthEnd].
    let cursor = p.observed.lastSeen;
    let emitted = 0;
    const safeLimit = 60; // guard against infinite loop
    let iterations = 0;

    while (iterations++ < safeLimit && emitted < maxOccurrences) {
      const next = nextOccurrence(cursor, freq, anchor);
      if (next > monthEnd) break;
      cursor = next;
      if (next < monthStart) continue;

      events.push({
        description: p.signals.descriptionVariants[0] ?? p.merchantKey,
        amount: Math.round(effectiveAmount * 100) / 100,
        expectedDate: next,
        type: p.kind,
        alreadyReceived: false,
        status: 'pending',
        confidence: p.confidence,
        merchantKey: p.merchantKey,
        classification: effectiveClass,
        patternId: (p as any)._id?.toString(),
        source: p.source,
      });
      emitted++;
    }
  }

  events.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  return events;
};
