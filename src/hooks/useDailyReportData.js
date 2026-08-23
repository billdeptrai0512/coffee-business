import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { fetchDailyReportContext, fetchReportByDate, fetchReportByRange } from '../services/orderService'
import { dateStringVN } from '../utils/dateVN'
import { calcRangeWithPrev } from '../utils/rangeCalc'
import { dedupeShiftClosingsByDay } from '../utils/reportStats'

/**
 * useDailyReportData
 * ------------------
 * Owns all server-data state for /daily-report and dispatches the right
 * fetcher per scope:
 *   - today              → fetchDailyReportContext
 *   - past single day    → fetchReportByDate
 *   - week/month/custom  → fetchReportByRange (with prev period for compare)
 *
 * Also owns `todayISO` (VN-local) so a tab left open across midnight detects
 * the rollover on focus and refetches with the new day.
 *
 * `setShiftClosing` is returned so save handlers (cashflow, inventory) can
 * patch the closing in place after a successful write, avoiding a round-trip
 * refetch just to update one field.
 */
// Đo thời gian tải báo cáo (DEV). Mốc kết thúc = fetch xong + state đã set, CHƯA phải
// đã vẽ xong — chênh 1 frame, không đáng đo riêng.
//   fetch  — round-trip Supabase cho scope này. Đây là con số để so với ngân sách.
//   mở trang — chỉ in ở lần đầu: tính từ navigation start nên gồm cả tải bundle + mount React.
// Cũng ghi 1 entry User Timing → xem được trong tab Performance của DevTools, không chỉ console.
function logReady(label, t0, firstLoadRef) {
    if (!import.meta.env.DEV) return
    const now = performance.now()
    performance.measure(`daily-report:${label}`, { start: t0, end: now })
    const fetchMs = Math.round(now - t0)
    if (firstLoadRef.current) {
        firstLoadRef.current = false
        console.info(`[perf] daily-report(${label}) ready — fetch ${fetchMs}ms · từ lúc mở trang ${Math.round(now)}ms`)
    } else {
        console.info(`[perf] daily-report(${label}) ready — fetch ${fetchMs}ms`)
    }
}

export function useDailyReportData({ addressId, scope, offset, customRange, onError }) {
    const firstLoadRef = useRef(true)
    const [shiftClosing, setShiftClosing] = useState(null)
    const [yesterdayClosing, setYesterdayClosing] = useState(null)
    const [isAsyncReady, setIsAsyncReady] = useState(false)
    const [apiOrders, setApiOrders] = useState([])
    const [apiExpenses, setApiExpenses] = useState([])
    // apiPayments mirrors target_payments / today_payments — driver của refill cashflow
    // (theo paid_at). todayPayments tách riêng vì today scope không set apiExpenses.
    const [apiPayments, setApiPayments] = useState([])
    const [todayPayments, setTodayPayments] = useState([])
    const [apiShiftClosings, setApiShiftClosings] = useState([])
    const [prevShiftClosings, setPrevShiftClosings] = useState([])

    // `todayISO` is state (not per-render) so an overnight tab can detect the date
    // change on focus/visibility and trigger a refetch of shift_closing + clear stale
    // cash + inventory inputs.
    const [todayISO, setTodayISO] = useState(() => dateStringVN(new Date()))
    useEffect(() => {
        const check = () => {
            const now = dateStringVN(new Date())
            if (now !== todayISO) setTodayISO(now)
        }
        const onVis = () => { if (document.visibilityState === 'visible') check() }
        window.addEventListener('focus', check)
        document.addEventListener('visibilitychange', onVis)
        return () => {
            window.removeEventListener('focus', check)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [todayISO])

    const { rangeStart, rangeEnd, prevStart, prevEnd } = useMemo(() => {
        const { start, end, prevStart: pStart, prevEnd: pEnd } = calcRangeWithPrev(scope, offset, customRange)
        return { rangeStart: start, rangeEnd: end, prevStart: pStart, prevEnd: pEnd }
    }, [scope, offset, customRange])

    const isTodayScope = scope === 'day' && offset === 0

    // `refetch` là hàm fetch THẬT (không phải bump 1 tick cho effect tự chạy lại) — trả về
    // promise chỉ resolve SAU KHI state đã cập nhật, để caller (vd handleSaveRestockEdit) await
    // xong mới báo toast/đóng modal, tránh báo "đã lưu" trước khi báo cáo thật sự làm mới.
    const refetch = useCallback(() => {
        // addressId === null (not undefined) means "Mẫu mặc định" (admin default
        // template) — a valid target, not "no address selected yet".
        if (addressId === undefined) return Promise.resolve()

        setIsAsyncReady(false)
        const t0 = performance.now()
        let promise
        if (isTodayScope) {
            promise = fetchDailyReportContext(addressId)
                .then((data) => {
                    setShiftClosing(data?.shift_closing || null)
                    setYesterdayClosing(data?.yesterday_closing || null)
                    setTodayPayments(data?.target_payments || [])
                })
                .catch((error) => onError?.(error, 'Tải báo cáo hôm nay'))
        } else if (scope === 'day') {
            const targetDateStr = dateStringVN(rangeStart)
            promise = fetchReportByDate(addressId, targetDateStr)
                .then((data) => {
                    setShiftClosing(data?.shift_closing || null)
                    setYesterdayClosing(data?.yesterday_closing || null)
                    setApiOrders(data?.target_orders || [])
                    setApiExpenses(data?.target_expenses || [])
                    setApiPayments(data?.target_payments || [])
                })
                .catch((error) => onError?.(error, `Tải báo cáo ngày ${targetDateStr}`))
        } else {
            // Range scopes (week/month/custom)
            promise = fetchReportByRange(addressId, rangeStart.toISOString(), rangeEnd.toISOString(), prevStart.toISOString(), prevEnd.toISOString())
                .then((data) => {
                    // Khử trùng phiếu chốt về 1 phiếu mới nhất/ngày VN — khớp report Ngày,
                    // tránh double-count Thực thu/hao hụt ở Tuần/Tháng (xem dedupeShiftClosingsByDay).
                    const targetClosings = dedupeShiftClosingsByDay(data?.target_shift_closings || [])
                    setApiOrders(data?.target_orders || [])
                    setApiExpenses(data?.target_expenses || [])
                    setApiPayments(data?.target_payments || [])
                    setApiShiftClosings(targetClosings)
                    setPrevShiftClosings(dedupeShiftClosingsByDay(data?.prev_shift_closings || []))

                    if (targetClosings.length) {
                        setShiftClosing(targetClosings[targetClosings.length - 1])
                    } else {
                        setShiftClosing(null)
                    }
                })
                .catch((error) => onError?.(error, 'Tải báo cáo theo khoảng'))
        }
        return promise.finally(() => {
            setIsAsyncReady(true)
            logReady(isTodayScope ? 'today' : scope, t0, firstLoadRef)
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressId, scope, offset, rangeStart, rangeEnd, isTodayScope, prevStart, prevEnd])

    // todayISO in deps: a midnight rollover invalidates cached shift_closing.
    useEffect(() => {
        refetch()
    }, [refetch, todayISO])

    return {
        todayISO,
        isTodayScope,
        refetch,
        rangeStart, rangeEnd, prevStart, prevEnd,
        shiftClosing, setShiftClosing,
        yesterdayClosing,
        apiOrders,
        // setApiExpenses: patch tại chỗ sau khi sửa/xoá 1 chi phí ở scope quá khứ
        // (list này đọc từ RPC báo cáo nên không tự cập nhật theo POSContext).
        apiExpenses, setApiExpenses,
        apiPayments,
        todayPayments, setTodayPayments,
        apiShiftClosings,
        prevShiftClosings,
        isAsyncReady,
    }
}
