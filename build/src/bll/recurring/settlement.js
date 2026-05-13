"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitSettlements = void 0;
/**
 * Split pending (unmatched) projected events into bank-ledger vs card-ledger
 * for end-of-month balance projection.
 *
 * Card transactions settle at end-of-month (cycle close). If the settlement
 * date falls within the projection window it contributes to projected balance;
 * otherwise it carries to the next month.
 *
 * `source` is either explicitly set on the event or inferred; if absent we
 * default to 'bank'.
 */
const splitSettlements = (events, today, monthEnd) => {
    var _a;
    let bankPending = 0;
    let cardPending = 0;
    const cardSettlementByDate = {};
    for (const e of events) {
        if (e.status === 'realized')
            continue; // already happened
        if (e.status === 'missed')
            continue; // assumed won't hit this month
        const isCard = e.source === 'card';
        const absAmount = Math.abs(e.amount);
        if (isCard) {
            // Card settlement: modeled as last day of month.
            const settleDate = monthEnd;
            if (settleDate >= today) {
                cardPending += absAmount;
                cardSettlementByDate[settleDate] =
                    ((_a = cardSettlementByDate[settleDate]) !== null && _a !== void 0 ? _a : 0) + absAmount;
            }
            // If settleDate < today it already settled; skip.
        }
        else {
            bankPending += absAmount;
        }
    }
    return {
        bankPending: Math.round(bankPending * 100) / 100,
        cardPending: Math.round(cardPending * 100) / 100,
        cardSettlementByDate: Object.fromEntries(Object.entries(cardSettlementByDate).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    };
};
exports.splitSettlements = splitSettlements;
