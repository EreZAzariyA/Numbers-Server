"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.yearOf = exports.monthOf = exports.dayOfWeek = exports.dayOfMonth = exports.ymd = exports.clampDayOfMonth = exports.daysInMonth = exports.diffDays = exports.addDays = exports.toDateStr = void 0;
const LEDGER_TIME_ZONE = 'Asia/Jerusalem';
const formatDateInTimeZone = (date) => {
    var _a, _b, _c;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: LEDGER_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const year = (_a = parts.find((part) => part.type === 'year')) === null || _a === void 0 ? void 0 : _a.value;
    const month = (_b = parts.find((part) => part.type === 'month')) === null || _b === void 0 ? void 0 : _b.value;
    const day = (_c = parts.find((part) => part.type === 'day')) === null || _c === void 0 ? void 0 : _c.value;
    if (!year || !month || !day) {
        return date.toISOString().slice(0, 10);
    }
    return `${year}-${month}-${day}`;
};
const toDateStr = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime()))
        return '';
    return formatDateInTimeZone(dt);
};
exports.toDateStr = toDateStr;
const addDays = (dateStr, days) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
};
exports.addDays = addDays;
const diffDays = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
exports.diffDays = diffDays;
const daysInMonth = (year, monthZeroIndexed) => new Date(year, monthZeroIndexed + 1, 0).getDate();
exports.daysInMonth = daysInMonth;
const clampDayOfMonth = (year, monthZeroIndexed, day) => {
    const dim = (0, exports.daysInMonth)(year, monthZeroIndexed);
    return Math.min(Math.max(1, day), dim);
};
exports.clampDayOfMonth = clampDayOfMonth;
const ymd = (year, monthZeroIndexed, day) => {
    const d = new Date(Date.UTC(year, monthZeroIndexed, (0, exports.clampDayOfMonth)(year, monthZeroIndexed, day)));
    return d.toISOString().slice(0, 10);
};
exports.ymd = ymd;
const dayOfMonth = (dateStr) => new Date(dateStr).getUTCDate();
exports.dayOfMonth = dayOfMonth;
const dayOfWeek = (dateStr) => new Date(dateStr).getUTCDay();
exports.dayOfWeek = dayOfWeek;
const monthOf = (dateStr) => new Date(dateStr).getUTCMonth();
exports.monthOf = monthOf;
const yearOf = (dateStr) => new Date(dateStr).getUTCFullYear();
exports.yearOf = yearOf;
