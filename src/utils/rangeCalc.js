// Shared "scope + offset + customRange → date range" math.
// Used by HistoryPage and DailyReportPage (previously duplicated).
//
// scope ∈ 'day' | 'week' | 'month' | 'custom'
// offset: negative for past, 0 = current period, only meaningful for day/week/month
// customRange?: { startISO, endISO } (YYYY-MM-DD in VN local)

import { startOfDayVN, endOfDayVN, startOfWeekVN, startOfMonthVN, endOfMonthVN, addDaysVN, dateStringVN, dateShortVN, dateFullVN } from './dateVN'

// Moved from ReportHeader.jsx: pure date math had no business living in a
// component file, and it was already being imported back into this util
// (component importing utils is fine; utils importing a component is backwards).
export function getDateRange(range, offset = 0) {
    if (range === 'week') {
        const thisMonday = startOfWeekVN()
        const start = addDaysVN(thisMonday, offset * 7)
        const end = new Date(addDaysVN(start, 7).getTime() - 1)
        // Current week: count up to today; past/future weeks always 7 days.
        const todayDiff = Math.round((startOfDayVN().getTime() - thisMonday.getTime()) / 86_400_000)
        const days = offset === 0 ? todayDiff + 1 : 7
        return { start, end, days }
    }
    if (range === 'month') {
        const start = startOfMonthVN(new Date(), offset)
        if (offset === 0) {
            const today = startOfDayVN()
            return { start, end: endOfDayVN(), days: Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1 }
        }
        const end = endOfMonthVN(new Date(), offset)
        // end is the last ms of the month, so (end - start) already rounds to # days
        const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
        return { start, end, days }
    }
    return { start: startOfDayVN(), end: endOfDayVN(), days: 1 }
}

// Returns { start, end } for the given scope/offset/customRange.
// Nội bộ file: chỉ calcRangeWithLabel/calcRangeWithPrev dưới đây gọi.
function calcRange(scope, offset, customRange) {
    if (scope === 'day') {
        const target = new Date()
        target.setDate(target.getDate() + offset)
        return { start: startOfDayVN(target), end: endOfDayVN(target) }
    }
    if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
        return {
            start: new Date(`${customRange.startISO}T00:00:00+07:00`),
            end: new Date(`${customRange.endISO}T23:59:59.999+07:00`),
        }
    }
    const { start, end } = getDateRange(scope, offset)
    return { start, end }
}

// Same as calcRange, plus a label "dd/mm" or "dd/mm – dd/mm" (year suffix on single-day).
export function calcRangeWithLabel(scope, offset, customRange) {
    const { start, end } = calcRange(scope, offset, customRange)
    const label = scope === 'day'
        ? dateFullVN(start)
        : `${dateShortVN(start)} – ${dateShortVN(end)}`
    return { start, end, label }
}

// Adds previous-period boundaries for comparison reports.
// For custom ranges, prev period = same length immediately before.
export function calcRangeWithPrev(scope, offset, customRange) {
    const { start, end } = calcRange(scope, offset, customRange)
    if (scope === 'day') {
        const pStart = new Date(start); pStart.setDate(pStart.getDate() - 1)
        const pEnd = new Date(end); pEnd.setDate(pEnd.getDate() - 1)
        return { start, end, prevStart: pStart, prevEnd: pEnd }
    }
    if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
        const diff = end.getTime() - start.getTime()
        return {
            start, end,
            prevStart: new Date(start.getTime() - diff - 86400000),
            prevEnd: new Date(end.getTime() - diff - 86400000),
        }
    }
    const { start: pStart, end: pEnd } = getDateRange(scope, offset - 1)
    return { start, end, prevStart: pStart, prevEnd: pEnd }
}

// Convert an ISO date (YYYY-MM-DD VN local) into an offset relative to "today VN".
// Returns 0 if iso is today or in the future (caller uses this to snap back to current).
export function offsetFromISO(iso, todayISO) {
    if (!iso || iso >= todayISO) return 0
    const target = new Date(`${iso}T00:00:00+07:00`)
    const today = startOfDayVN()
    return Math.round((target - today) / 86400000)
}

// "Day mode": ISO of the offset day, or null if scope/offset means "today".
export function dayCustomDateOf(scope, offset) {
    if (scope !== 'day' || offset === 0) return null
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return dateStringVN(d)
}
