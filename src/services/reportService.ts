import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN, endOfDayVN, dateStringVN } from '../utils/dateVN'
import { reportCache, historicalCache, invalidateReportCache } from './cache'
import type { UUID, Row } from '../types/domain'

type SupabaseError = { code?: string; message?: string } | null

// ---- Shift Closing CRUD ----

// Self-heal khi cột cash_closed_at chưa được migrate: lưu phần còn lại thay vì làm vỡ
// "Lưu thực thu". PostgREST trả PGRST204 ("could not find column ... in schema cache")
// cho WRITE cột lạ; Postgres trả 42703 ("undefined_column"). Bắt cả hai + dò message.
function isMissingCashClosedAt(error: SupabaseError) {
    if (!error) return false
    if (error.code === 'PGRST204' || error.code === '42703') return true
    return /cash_closed_at/i.test(error.message || '')
}
function omitCashClosedAt(data: Row) {
    const rest = { ...data }
    delete rest.cash_closed_at
    return rest
}

// Unique index uniq_shift_closings_address_vn_day (1 phiếu / address / ngày VN) chặn
// insert trùng ở DB. PostgREST trả 23505 cho vi phạm unique.
function isUniqueViolation(error: SupabaseError) {
    if (!error) return false
    return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '')
}

// Khi insert đụng unique → self-heal bằng UPDATE phiếu đã có. PHẢI bỏ các field chỉ là
// "mặc định lúc insert" (inventory_report=[], note='') khỏi payload update, nếu không chúng
// sẽ ĐÈ SẠCH dữ liệu phiếu đã tồn tại. Bug thực tế: máy A treo (shiftClosing.id=null vì
// không refetch/realtime), nhân viên máy B kiểm kê xong, A bấm "Lưu thực thu" → insert đụng
// unique → update mang inventory_report=[] → xoá toàn bộ kiểm kê của B. Cash field thì vẫn
// update bình thường (last-write-wins là chấp nhận được với số đếm tiền).
export function stripInsertOnlyDefaults(data: Row) {
    const safe = { ...data }
    if (Array.isArray(safe.inventory_report) && safe.inventory_report.length === 0) delete safe.inventory_report
    if (safe.note === '') delete safe.note
    return safe
}

// Phần payload "Lưu thực thu" phụ thuộc vào Ô NÀO đã đổi — CHỈ gửi ô người dùng thật sự sửa.
// Trước đây UPDATE luôn mang cả actual_cash lẫn actual_transfer lấy từ state local, nên hai
// máy kết ca cùng lúc (A đếm két, B đối chiếu bank) thì người bấm Lưu sau đè số của người
// trước bằng bản cũ của mình — mất tiền thật, không phải chỉ lệch hiển thị. Gửi delta thì hai
// ô khác nhau cùng sống; cùng một ô thì vẫn ai lưu sau thắng (hai người đếm cùng một con số).
//
// Trả null = không có gì đổi ⇒ đừng gửi request nào. Caller cũng dùng chính hàm này (với
// hasExistingRow = true) để suy ra "còn thay đổi chưa lưu" — một chỗ tính, không ba bản.
export function buildCashPayload(
    persisted: { actual_cash?: number | null; actual_transfer?: number | null; cash_closed_at?: string | null } | null,
    inputs: { actual_cash: number; actual_transfer: number },
    hasExistingRow: boolean,
): Row | null {
    const payload: Row = {}
    if (hasExistingRow) {
        if (inputs.actual_cash !== (Number(persisted?.actual_cash) || 0)) payload.actual_cash = inputs.actual_cash
        if (inputs.actual_transfer !== (Number(persisted?.actual_transfer) || 0)) payload.actual_transfer = inputs.actual_transfer
        if (!Object.keys(payload).length) return null
    } else {
        // INSERT: phải đủ cột, phiếu mới không có gì để merge vào.
        payload.actual_cash = inputs.actual_cash
        payload.actual_transfer = inputs.actual_transfer
        payload.inventory_report = []
        payload.note = ''
    }
    // "Lưu thực thu" = chốt ca tiền. Đặt mốc lần đầu, giữ nguyên các lần sửa số sau (không
    // dời mốc, để các khoản chi giữa 2 lần lưu không bị đổi phân loại trước/sau chốt).
    payload.cash_closed_at = persisted?.cash_closed_at || new Date().toISOString()
    return payload
}

// Tìm id phiếu chốt cùng NGÀY VN với `refIso` (mặc định now) cho 1 address. Dùng để
// tự lành khi insert đụng unique index → UPDATE phiếu đã có thay vì vỡ "Lưu".
async function findSameDayClosingId(addressId: UUID, refIso?: string | Date | null) {
    if (!addressId || !supabase) return null
    const ref = refIso ? new Date(refIso) : new Date()
    const { data } = await supabase
        .from('shift_closings')
        .select('id')
        .eq('address_id', addressId)
        .gte('closed_at', startOfDayVN(ref).toISOString())
        .lte('closed_at', endOfDayVN(ref).toISOString())
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data?.id || null
}

// Insert a shift closing record
export async function insertShiftClosing(data: Row) {
    invalidateReportCache(data?.address_id)
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing(data)
    if (!supabase) throw new Error('No Supabase connection')
    let { data: row, error } = await supabase
        .from('shift_closings')
        .insert(data)
        .select()
        .single()
    if (isMissingCashClosedAt(error) && 'cash_closed_at' in data) {
        ;({ data: row, error } = await supabase.from('shift_closings').insert(omitCashClosedAt(data)).select().single())
    }
    // Race/insert trùng cùng ngày → unique index chặn. Tự lành: cập nhật phiếu cùng ngày
    // (đúng phiếu report Ngày dùng) thay vì ném lỗi làm hỏng luồng lưu báo cáo/thực thu.
    if (isUniqueViolation(error)) {
        const existingId = await findSameDayClosingId(data.address_id, data.closed_at)
        if (existingId) return updateShiftClosing(existingId, stripInsertOnlyDefaults(data))
    }
    if (error) throw error
    return row
}

// Update an existing shift closing record
export async function updateShiftClosing(id: UUID, data: Row) {
    invalidateReportCache(data?.address_id || null)
    // Guest: thread `id` through so upsertLocalShiftClosing targets THIS row (e.g.
    // editing a past day's closing) instead of falling back to its "today" heuristic.
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing({ ...data, id })
    if (!supabase) throw new Error('No Supabase connection')
    let { data: row, error } = await supabase
        .from('shift_closings')
        .update(data)
        .eq('id', id)
        .select()
        .single()
    if (isMissingCashClosedAt(error) && 'cash_closed_at' in data) {
        ;({ data: row, error } = await supabase.from('shift_closings').update(omitCashClosedAt(data)).eq('id', id).select().single())
    }
    if (error) throw error
    return row
}

// Đường autosave NHẸ cho kiểm kê đa thiết bị: merge các field đã đổi vào inventory_report
// của phiếu hôm nay (tạo phiếu nếu chưa có) qua RPC merge_shift_closing_inventory — race-free
// dưới row lock. KHÔNG refetch ở đây (gọi xong tự nhẹ); convergence do postgres_changes lo.
// `patches`: [{ingredient, unit, opening, opening_locked, remaining, restock, skipped}], số = null
// (và skipped = false) ⇒ xoá NVL khỏi report.
export async function mergeShiftClosingInventory(addressId: UUID, patches: Row[], closedBy: string | null, systemTotalRevenue = 0) {
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) {
        // Guest local-only: không có đua, merge tay rồi upsert cả mảng.
        const existing = localRepo.fetchLocalShiftClosing(addressId, new Date().toISOString())
        const report = Array.isArray(existing?.inventory_report) ? [...existing.inventory_report] : []
        const restockDeltas: Record<string, number> = {}
        for (const p of patches) {
            const i = report.findIndex(e => e.ingredient === p.ingredient)
            const tombstone = p.opening == null && p.remaining == null && p.restock == null && !p.skipped
            const oldRestock = i >= 0 ? Number(report[i]?.restock) || 0 : 0
            const newRestock = tombstone ? 0 : Number(p.restock) || 0
            if (newRestock !== oldRestock)
                restockDeltas[p.ingredient] = (restockDeltas[p.ingredient] || 0) + newRestock - oldRestock
            if (i >= 0) report.splice(i, 1)
            if (!tombstone) report.push(p)
        }
        // Mirror cascade của RPC merge_shift_closing_inventory: số rút đổi ⇒ trừ delta
        // khỏi snapshot before/after_stock của phiếu refill tạo SAU phiếu chốt ca,
        // nếu không neo after_stock giữ số kho chưa trừ rút → tồn thổi phồng vĩnh viễn.
        const rowCreatedAt = existing?.created_at ? new Date(existing.created_at).getTime() : null
        if (rowCreatedAt != null && Object.keys(restockDeltas).length) {
            const round1 = (x: number) => Math.round(x * 10) / 10
            for (const e of localRepo.fetchAllLocalExpenses(addressId)) {
                const d = e.is_refill ? restockDeltas[e.metadata?.ingredient] : undefined
                if (!d || e.metadata?.cancelled || e.metadata?.after_stock == null) continue
                if (new Date(e.created_at).getTime() <= rowCreatedAt) continue
                localRepo.updateLocalExpense(e.id, {
                    metadata: {
                        ...e.metadata,
                        before_stock: round1((Number(e.metadata.before_stock) || 0) - d),
                        after_stock: round1((Number(e.metadata.after_stock) || 0) - d),
                    },
                })
            }
        }
        const payload: Row = { address_id: addressId, closed_by: closedBy, inventory_report: report }
        if (!existing?.id) payload.system_total_revenue = systemTotalRevenue
        return localRepo.upsertLocalShiftClosing(payload)
    }
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase.rpc('merge_shift_closing_inventory', {
        p_address_id: addressId,
        p_patches: patches,
        p_closed_by: closedBy || null,
        p_system_total_revenue: systemTotalRevenue || 0,
    })
    if (error) throw error
    // RETURNS shift_closings (composite) → PostgREST may give the object or a 1-element array.
    return Array.isArray(data) ? data[0] : data
}

// get_daily_report_context/get_report_by_date đã trả cash_closed_at thẳng trong shift_closing
// (migration 20260818_report_rpc_cash_closed_at.sql) — không cần bù thêm PK lookup riêng nữa.

// Fetch today's shift closing for an address (latest one)
export async function fetchTodayShiftClosing(addressId: UUID) {
    if (localRepo.isGuest()) return localRepo.fetchLocalShiftClosing(addressId, new Date().toISOString())
    if (!supabase) return null
    const startOfDay = startOfDayVN()

    // address_id IS NULL (Mẫu mặc định) — `.eq()` never matches NULL rows in Postgres.
    let q = supabase.from('shift_closings')
        .select('id, closed_at, address_id, inventory_report, actual_cash, actual_transfer, system_total_revenue, cash_closed_at')
    q = addressId ? q.eq('address_id', addressId) : q.is('address_id', null)
    const { data, error } = await q
        .gte('closed_at', startOfDay.toISOString())
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) {
        console.error('fetchTodayShiftClosing error:', error)
        return null
    }
    return data
}

// Đã "chốt ca tiền thực thu" hôm nay chưa? Dùng để default phân loại tiền mặt khi nhập
// kho (chưa chốt → 'in_shift', đã chốt → 'post_close'). Cùng hàng shift_closings và bộ
// filter với fetchTodayShiftClosing ở trên — tái dùng nó thay vì lặp lại query.
// Phòng thủ: cột chưa migrate hoặc lỗi → coi như CHƯA chốt (false) → mặc định 'in_shift'.
export async function fetchCashClosedToday(addressId: UUID) {
    if (!addressId) return false
    const sc = await fetchTodayShiftClosing(addressId)
    return !!sc?.cash_closed_at
}

// Fetch the most recent shift closing BEFORE today (for opening stock)
export async function fetchYesterdayShiftClosing(addressId: UUID) {
    if (localRepo.isGuest()) return localRepo.fetchLocalYesterdayShiftClosing(addressId)
    if (!supabase) return null
    const startOfDay = startOfDayVN()

    let q = supabase.from('shift_closings').select('id, closed_at, address_id, inventory_report')
    q = addressId ? q.eq('address_id', addressId) : q.is('address_id', null)
    const { data, error } = await q
        .lt('closed_at', startOfDay.toISOString())
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) {
        console.error('fetchYesterdayShiftClosing error:', error)
        return null
    }
    return data
}

// ---- Historical reads (immutable past data) ----

// Fetch order items for the same weekday one week ago, `daysAgo` days back.
//   daysAgo = 7 → same weekday as TODAY   → dự báo "Soạn cho hôm nay".
//   daysAgo = 6 → same weekday as TOMORROW → dự báo "Chuẩn bị ngày mai".
export async function fetchLastWeekSameDayOrderItems(addressId: UUID, daysAgo = 6) {
    return historicalCache.through([addressId, 'lastWeekSameDay', daysAgo, dateStringVN()], async () => {
        const today = startOfDayVN()

        const targetDate = new Date(today)
        targetDate.setDate(targetDate.getDate() - daysAgo)

        const nextDate = new Date(targetDate)
        nextDate.setDate(nextDate.getDate() + 1)

        if (localRepo.isGuest()) {
            const targetMs = targetDate.getTime()
            const nextMs = nextDate.getTime()
            const allItems: Row[] = []
            for (const o of localRepo.fetchAllLocalOrders(addressId)) {
                if (o.deleted_at) continue
                const t = new Date(o.created_at).getTime()
                if (t < targetMs || t >= nextMs) continue
                for (const i of o.order_items || []) allItems.push(i)
            }
            return allItems
        }

        if (!supabase) return []

        let query = supabase
            .from('orders')
            .select(`
                order_items (
                    quantity,
                    product_id,
                    extra_ids
                )
            `)
            .is('deleted_at', null)
            .gte('created_at', targetDate.toISOString())
            .lt('created_at', nextDate.toISOString())

        if (addressId) query = query.eq('address_id', addressId)

        const { data, error } = await query
        if (error) {
            console.error('fetchLastWeekSameDayOrderItems error:', error)
            return []
        }

        const allItems: Row[] = []
        data.forEach((o: Row) => {
            if (o.order_items) {
                o.order_items.forEach((i: Row) => allItems.push(i))
            }
        })
        return allItems
    })
}

// ---- Reports (Daily / Range) ----
// Backed by the shared reportCache so toggling between Báo cáo / Nhật ký tabs
// feels instant. Cache invalidates on any write to the underlying tables via
// invalidateReportCache(). Existing call sites use invalidateDailyContext() as
// the public API; it forwards to invalidateReportCache.
export function invalidateDailyContext(addressId: UUID) {
    invalidateReportCache(addressId)
}

// Helper: attach invoice info to a payment row (mirror RPC's LEFT JOIN).
function attachInvoiceMeta(payments: Row[], expenseMap: Map<string, Row>) {
    return (payments || []).map(p => {
        const inv = expenseMap.get(p.expense_id)
        return inv ? { ...p, invoice_name: inv.name, invoice_metadata: inv.metadata } : p
    })
}

// Helper: filter local payments by paid_at range and address.
function filterLocalPayments(addressId: UUID, start: Date, end: Date) {
    const sMs = start.getTime(), eMs = end.getTime()
    return localRepo.fetchAllLocalExpensePayments(addressId).filter((p: Row) => {
        const t = new Date(p.paid_at).getTime()
        return t >= sMs && t < eMs
    })
}

export async function fetchDailyReportContext(addressId: UUID) {
    if (!addressId) return {}
    return reportCache.through([addressId, 'dailyReportContext'], async () => {
        if (localRepo.isGuest()) {
            const todayStr = dateStringVN()
            const yesterday = new Date(startOfDayVN().getTime() - 86_400_000)
            const yesterdayStr = dateStringVN(yesterday)
            const startToday = startOfDayVN()
            const startYday = new Date(yesterday.getTime())
            const allExp = localRepo.fetchAllLocalExpenses(addressId)
            const expMap = new Map<string, Row>(allExp.map((e: Row) => [e.id, e]))
            return {
                shift_closing: localRepo.fetchLocalShiftClosing(addressId, todayStr) || null,
                yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || localRepo.fetchLocalYesterdayShiftClosing(addressId) || null,
                yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
                yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr),
                target_payments: attachInvoiceMeta(filterLocalPayments(addressId, startToday, new Date(startToday.getTime() + 86_400_000)), expMap),
                yesterday_payments: attachInvoiceMeta(filterLocalPayments(addressId, startYday, startToday), expMap),
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_daily_report_context', { p_address_id: addressId })
        if (error) throw error
        return data || {}
    })
}

export async function fetchReportByDate(addressId: UUID, dateStr: string) {
    return reportCache.through([addressId, 'reportByDate', dateStr], async () => {
        if (localRepo.isGuest()) {
            const targetDateStr = dateStringVN(new Date(dateStr))
            const targetDate = startOfDayVN(new Date(dateStr))
            const targetEnd = new Date(targetDate.getTime() + 86_400_000)

            const yesterday = new Date(targetDate.getTime() - 86_400_000)
            const yesterdayStr = dateStringVN(yesterday)

            const allExp = localRepo.fetchAllLocalExpenses(addressId)
            const expMap = new Map<string, Row>(allExp.map((e: Row) => [e.id, e]))

            return {
                shift_closing: localRepo.fetchLocalShiftClosing(addressId, targetDateStr) || null,
                yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || null,
                yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
                yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr),
                target_orders: localRepo.fetchLocalOrders(addressId, targetDateStr),
                target_expenses: localRepo.fetchLocalExpenses(addressId, targetDateStr),
                target_payments: attachInvoiceMeta(filterLocalPayments(addressId, targetDate, targetEnd), expMap),
                yesterday_payments: attachInvoiceMeta(filterLocalPayments(addressId, yesterday, targetDate), expMap),
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_report_by_date', { p_address_id: addressId, p_date: dateStr })
        if (error) throw error
        return data || {}
    })
}

export async function fetchReportByRange(addressId: UUID, targetStart: string | Date, targetEnd: string | Date, prevStart: string | Date, prevEnd: string | Date) {
    return reportCache.through([addressId, 'reportByRange', targetStart, targetEnd, prevStart, prevEnd], async () => {
        if (localRepo.isGuest()) {
            const allOrders = localRepo.fetchAllLocalOrders(addressId)
            const allExpenses = localRepo.fetchAllLocalExpenses(addressId)
            const allClosings = localRepo.fetchAllLocalShiftClosings(addressId)

            const tS = new Date(targetStart).getTime()
            const tE = new Date(targetEnd).getTime()
            const pS = new Date(prevStart).getTime()
            const pE = new Date(prevEnd).getTime()

            const filterRange = (list: Row[], start: number, end: number) => list.filter(x => {
                const t = new Date(x.created_at).getTime()
                return t >= start && t <= end && x.address_id === addressId
            })

            const expMap = new Map<string, Row>(allExpenses.map((e: Row) => [e.id, e]))
            return {
                target_orders: filterRange(allOrders, tS, tE),
                target_expenses: filterRange(allExpenses, tS, tE),
                target_payments: attachInvoiceMeta(filterLocalPayments(addressId, new Date(tS), new Date(tE)), expMap),
                target_shift_closings: filterRange(allClosings, tS, tE),
                prev_orders: filterRange(allOrders, pS, pE),
                prev_expenses: filterRange(allExpenses, pS, pE),
                prev_payments: attachInvoiceMeta(filterLocalPayments(addressId, new Date(pS), new Date(pE)), expMap),
                prev_shift_closings: filterRange(allClosings, pS, pE)
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_report_by_range', {
            p_address_id: addressId,
            p_target_start: targetStart,
            p_target_end: targetEnd,
            p_prev_start: prevStart,
            p_prev_end: prevEnd
        })
        if (error) throw error
        return data || {}
    })
}

