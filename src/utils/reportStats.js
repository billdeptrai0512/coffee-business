import { calculateItemCost as calculateProductCost } from './inventory'
import { dateStringVN } from './dateVN'

// Khử trùng phiếu chốt ca: mỗi ngày VN chỉ giữ phiếu MỚI NHẤT (max closed_at), khớp
// đúng hành vi report Ngày (RPC ... ORDER BY closed_at DESC LIMIT 1). Report Tuần/Tháng
// nhận TẤT CẢ phiếu trong kỳ; nếu 1 ngày có >1 phiếu (lưu lại nhiều lần / insert trùng do
// 2 đường lưu tồn-kho & thực-thu) thì cộng dồn sẽ double-count actual_cash/actual_transfer
// + hao hụt → Tuần/Tháng không khớp tổng các Ngày. Dedup tại nguồn để mọi consumer
// (cashflow, lossValue, RangeLossCard) dùng chung 1 phiếu/ngày.
export function dedupeShiftClosingsByDay(closings) {
    const tsOf = (s) => new Date(s.closed_at || s.created_at).getTime()
    const byDay = new Map()
    for (const s of closings || []) {
        const day = dateStringVN(new Date(s.closed_at || s.created_at))
        const prev = byDay.get(day)
        if (!prev || tsOf(s) > tsOf(prev)) byDay.set(day, s)
    }
    // Giữ thứ tự closed_at DESC như RPC trả về (consumer dựa vào [last] = ngày cũ nhất).
    return [...byDay.values()].sort((a, b) => tsOf(b) - tsOf(a))
}

// Builds lookup maps once so per-item math stays O(1).
export function buildExtraMaps(productExtras) {
    const priceMap = {}, nameMap = {}
    Object.values(productExtras || {}).forEach(extras => {
        extras.forEach(e => {
            priceMap[e.id] = e.price || 0
            nameMap[e.id] = e.name || e.id
        })
    })
    return { priceMap, nameMap }
}

function buildVariantLabel(extraNames) {
    if (!extraNames?.length) return 'Thường'
    return [...extraNames]
        .sort((a, b) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), 'vi'))
        .join(' + ')
}

// Splits expenses into the P&L buckets.
// "Thực chi" model: is_fixed=true rows are LEGACY auto-injected fixed costs from
// before the model switch. They still represent actual money paid, so they're
// counted as operational expense. New entries never set is_fixed=true.
// Adjustments (metadata.adjustment=true) are inventory bookkeeping — manager
// edited the qty on file. Amount is 0 by construction, but we skip explicitly
// so a future bug that sets amount != 0 doesn't leak into cash flow / P&L.
export function splitExpenses(expenses) {
    let dailyExpense = 0, refillNvl = 0, refillFreeForm = 0
    for (const e of expenses || []) {
        if (e.metadata?.adjustment) continue
        if (e.is_refill) {
            if (e.metadata?.free_form) refillFreeForm += e.amount
            else refillNvl += e.amount
        } else {
            dailyExpense += e.amount
        }
    }
    return { dailyExpense, refillNvl, refillFreeForm, refillTotal: refillNvl + refillFreeForm }
}

// Dòng tiền tiền-mặt phân theo cờ "trước/sau chốt ca tiền" lưu trên TỪNG phiếu.
//
// Bối cảnh: actual_cash là tiền mặt ĐẾM ĐƯỢC tại thời điểm chốt. Khoản NVL trả tiền mặt
// RÚT TỪ KÉT TRƯỚC khi chốt (cash_phase='in_shift') đã làm hụt số đếm được → cộng lại
// để dựng lại doanh thu tiền mặt (Thực thu). Khoản SAU chốt (mặc định) là lấy tiền đã
// đếm ra tiêu → trừ Thực nhận.
//
// Phân loại lưu CỐ ĐỊNH trên invoice metadata (`cash_phase`) lúc nhập kho — KHÔNG suy ra
// từ timestamp lúc đọc, nên lịch sử (phiếu cũ thiếu cờ) không bị reclassify. Thiếu cờ ⇒
// 'post_close' = hành vi cũ (trừ Thực nhận, không cộng Thực thu) → giữ nguyên số quá khứ.
//
// Chi phí non-refill ("chi trong ca") luôn coi là trong ca (cộng Thực thu) như trước.
// Chuyển khoản không động đến két: luôn trừ Thực nhận CK, không cộng Thực thu.
//
// Inputs:
//   liveCash / liveTransfer : số tiền mặt / CK đang dùng để tính (đếm được hoặc đang gõ)
//   payments       : expense_payments của ngày (NVL/refill + trả nợ + free_form sau ca)
//   shiftExpenses  : expenses non-refill của ngày ("chi trong ca" ad-hoc, không có payment riêng)
//   afterShiftExpenses : expenses is_refill + free_form ("Sau chốt ca", vd đồ cúng) — tiền
//                        mặt tiêu SAU khi đếm tiền, KHÔNG có payment riêng → trừ Thực nhận.
export function computeCashFlowTotals({
    liveCash = 0,
    liveTransfer = 0,
    payments = [],
    shiftExpenses = [],
    afterShiftExpenses = [],
}) {
    let inShiftRefillCash = 0  // NVL/đi chợ trả tiền mặt TRƯỚC chốt (cash_phase='in_shift')
    let inShiftOpsCash = 0     // chi phí "trong ca" (non-refill) — luôn cộng Thực thu
    let postCloseCashOut = 0   // tiền mặt lấy ra SAU chốt / phiếu cũ (trừ Thực nhận)
    let transferRefill = 0     // CK trả NCC (luôn trừ Thực nhận CK)

    for (const p of payments || []) {
        if (p.invoice_metadata?.adjustment) continue
        const amt = Number(p.amount) || 0
        if (p.payment_method === 'transfer') { transferRefill += amt; continue }
        // Cờ trên TỪNG payment (toggle Trong ca/Sau chốt ca lúc trả nợ) ưu tiên hơn cờ
        // của hoá đơn gốc (gắn lúc nhập kho). Chỉ 'in_shift' rõ ràng mới cộng vào Thực thu;
        // còn lại (kể cả phiếu cũ không có cờ) → sau chốt → trừ Thực nhận. Bảo toàn lịch sử.
        const phase = p.cash_phase || p.invoice_metadata?.cash_phase
        if (phase === 'in_shift') inShiftRefillCash += amt
        else postCloseCashOut += amt
    }
    // Chi phí non-refill ("chi trong ca") không có payment riêng → dùng amount.
    for (const e of shiftExpenses || []) {
        if (e.metadata?.adjustment) continue
        inShiftOpsCash += Number(e.amount) || 0
    }
    // Chi phí "Sau chốt ca" (free_form): tiêu tiền đã đếm → trừ Thực nhận. Không có payment
    // riêng nên tính từ amount của expense. CK trừ ở Thực nhận CK, tiền mặt ở Thực nhận TM.
    // Nếu expense đã có payment trong `payments` (hành vi mới sau migration công nợ)
    // thì bỏ qua để tránh double-count.
    for (const e of afterShiftExpenses || []) {
        if (e.metadata?.adjustment) continue
        if (e.id && (payments || []).some(p => p.expense_id === e.id)) continue
        const amt = Number(e.amount) || 0
        if (e.payment_method === 'transfer') transferRefill += amt
        else postCloseCashOut += amt
    }

    const inShiftCashOut = inShiftRefillCash + inShiftOpsCash
    const actualTotal = liveCash + liveTransfer + inShiftCashOut
    const takeHomeCash = liveCash - postCloseCashOut
    const takeHomeTransfer = liveTransfer - transferRefill
    return {
        actualTotal,
        takeHomeCash,
        takeHomeTransfer,
        takeHome: takeHomeCash + takeHomeTransfer,
        inShiftCashOut,
        inShiftRefillCash,
        inShiftOpsCash,
        postCloseCashOut,
        transferRefill,
    }
}

// Walks orders once and returns aggregated stats shared by Daily/Range reports.
//
// Handles both shapes:
//  - online orders:  { total, total_cost?, created_at, order_items: [{ product_id, quantity, unit_cost?, extra_ids? }] }
//  - offline orders: { total, totalCost?, createdAt, cart: [{ productId, quantity, unitCost?, extras: [{ id, name, price }] }] }
//
// `useTotalCostShortcut`: when true, trusts o.total_cost (Range) and skips per-item COGS sum.
export function aggregateOrderStats({
    orders,
    productMap,
    extraPriceMap,
    extraNameMap,
    recipes,
    extraIngredients,
    ingredientCosts,
    useTotalCostShortcut = false,
}) {
    let totalRevenue = 0, totalDiscount = 0, totalCOGS = 0
    const productStats = {}
    const soldProducts = new Set()
    const hourlyRevenue = {}, hourlyOrders = {}
    const activeHours = new Set()

    for (const o of orders || []) {
        if (o.deleted_at) continue
        const orderTotal = o.total || 0
        totalRevenue += orderTotal
        totalDiscount += o.discount_amount || o.discountAmount || 0

        const createdAt = o.created_at || o.createdAt
        let hour = null
        if (createdAt) {
            hour = new Date(createdAt).getHours()
            activeHours.add(hour)
            hourlyRevenue[hour] = (hourlyRevenue[hour] || 0) + orderTotal
        }

        const hasOrderCost = useTotalCostShortcut && o.total_cost > 0
        if (hasOrderCost) totalCOGS += o.total_cost

        const items = o.order_items || o.cart || o.orderItems || []
        for (const i of items) {
            const qty = i.quantity || i.qty || 1
            const productId = i.product_id || i.productId
            const prodDef = productMap.get(productId)

            soldProducts.add(productId)

            let cost = 0
            if (!hasOrderCost) {
                const snapshotCost = i.unit_cost || i.unitCost || 0
                cost = snapshotCost > 0
                    ? snapshotCost
                    : calculateProductCost(productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
                totalCOGS += cost * qty
            }

            if (hour !== null) {
                const name = prodDef?.name || i.name || i.products?.name || '?'
                if (!hourlyOrders[hour]) hourlyOrders[hour] = {}
                hourlyOrders[hour][name] = (hourlyOrders[hour][name] || 0) + qty
            }

            const basePrice = prodDef?.price || 0
            const extras = i.extras || []
            const extraIds = i.extra_ids || []
            const extrasPrice = extras.length
                ? extras.reduce((s, e) => s + (e.price || 0), 0)
                : extraIds.reduce((s, id) => s + (extraPriceMap[id] || 0), 0)
            const unitRevenue = basePrice + extrasPrice

            const extraNames = extras.length
                ? extras.map(e => e.name).filter(Boolean)
                : extraIds.map(id => extraNameMap[id]).filter(Boolean)
            const variantLabel = buildVariantLabel(extraNames)

            if (!productStats[productId]) productStats[productId] = { qty: 0, revenue: 0, cost: 0, variants: {} }
            productStats[productId].qty += qty
            productStats[productId].revenue += unitRevenue * qty
            productStats[productId].cost += cost * qty
            productStats[productId].variants[variantLabel] = (productStats[productId].variants[variantLabel] || 0) + qty
        }
    }

    return { totalRevenue, totalDiscount, totalCOGS, productStats, soldProducts, hourlyRevenue, hourlyOrders, activeHours }
}

// Builds the hourly cumulative line-chart series from aggregator output. Daily-only.
export function buildHourlyLineChart({ activeHours, hourlyRevenue, hourlyOrders }) {
    if (activeHours.size === 0) return []
    const minH = Math.min(...activeHours), maxH = Math.max(...activeHours)
    let cumulative = 0
    const out = []
    for (let h = minH; h <= maxH; h++) {
        cumulative += (hourlyRevenue[h] || 0)
        const items = Object.entries(hourlyOrders[h] || {})
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
        out.push({ hour: `${h}h`, revenue: cumulative, hourRevenue: hourlyRevenue[h] || 0, items })
    }
    return out
}
