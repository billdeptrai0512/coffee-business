// Orders + per-day stats. Other domains live in sibling service files:
//   - productService          (products, extras, extra_ingredients)
//   - expenseService          (expenses, fixed_costs)
//   - recipeService           (recipes)
//   - ingredientCostService   (ingredient_costs CRUD)
//   - ingredientStockService  (warehouse/counter stock reads)
//   - restockService          (restock/adjustment mutations, key sync)
//   - reportService           (shift_closings, daily/range reports, history)
//
// Existing call sites still import everything from `services/orderService` —
// the barrel re-exports at the bottom keep that working. Prefer the focused
// imports in new code.
//
// Incremental TS: public signatures are typed against src/types/domain. Raw
// Supabase rows are still unmodeled (typed `any`) until the DB schema is generated.

import { supabase } from '../lib/supabaseClient'
// Use the namespace import directly (live binding). Do NOT alias it to a top-level
// `const` — that snapshots the binding at module-init time and, under the barrel's
// circular imports, captures `undefined` (prod crash: "reading 'isGuest' of undefined").
import * as localRepo from './localRepository'
import { startOfDayVN, dateStringVN } from '../utils/dateVN'
import { cartLineSubtotal, computeDiscount, NO_DISCOUNT } from '../utils'
import { reportCache, invalidateReportCache } from './cache'
import type { UUID, CartItem, CostPerItem, OrderPayload, TodayStats } from '../types/domain'

// ---- Orders ----

// Fetch today's revenue + cups (cups excludes products with count_as_cup=false).
// Uses the get_today_stats RPC which aggregates in Postgres — payload is a
// single row, no N+1 product join over the wire. Legacy fallback below.
export async function fetchTodayStats(addressId: UUID | null): Promise<TodayStats> {
    if (localRepo.isGuest()) {
        const orders = localRepo.fetchLocalOrders(addressId)
        let revenue = 0, cups = 0
        orders.forEach((o: any) => {
            if (!o.deleted_at) revenue += Number(o.total || 0)
            const items = o.order_items || o.items || []
            items.forEach((i: any) => {
                // In local mode, we don't have the products table join easily,
                // so we assume everything is a cup unless specified in seeding.
                // For demo, this is fine.
                cups += Number(i.quantity || 0)
            })
        })
        return { revenue, cups }
    }
    if (!supabase || !addressId) return { revenue: 0, cups: 0 }

    const { data, error } = await supabase.rpc('get_today_stats', { p_address_id: addressId })
    if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        return {
            revenue: Number(row?.revenue || 0),
            cups: Number(row?.cups || 0)
        }
    }

    // Fallback: function not deployed (PGRST202 / 42883). Use legacy query.
    if (error && error.code !== 'PGRST202' && error.code !== '42883') {
        console.error('fetchTodayStats RPC error:', error)
    }

    const from = startOfDayVN()
    const { data: legacyData, error: legacyError } = await supabase
        .from('orders')
        .select('total, order_items(quantity, products(count_as_cup))')
        .eq('address_id', addressId)
        .gte('created_at', from.toISOString())

    if (legacyError) { console.error('fetchTodayStats legacy error:', legacyError); return { revenue: 0, cups: 0 } }

    let revenue = 0, cups = 0
    ;(legacyData || []).forEach((o: any) => {
        revenue += Number(o.total || 0)
        ;(o.order_items || []).forEach((i: any) => {
            if (i.products?.count_as_cup !== false) cups += Number(i.quantity || 0)
        })
    })
    return { revenue, cups }
}

// Fetch all orders for today, newest first (optionally scoped by address)
// Hình dạng một đơn cho /history + thẻ Nhật ký. Tách ra hằng vì fetchTodayOrders và
// fetchOrdersByIds phải trả về Y HỆT nhau: chúng cùng đổ vào todayOrders, lệch một cột
// là dòng đơn đồng bộ về từ máy khác thiếu thông tin so với dòng nạp lúc mở trang.
const ORDER_SELECT = `
    id,
    order_no,
    total,
    total_cost,
    discount_amount,
    payment_method,
    created_at,
    deleted_at,
    deleted_by,
    served_at,
    table_closed_at,
    order_items (
        id,
        quantity,
        options,
        product_id,
        unit_cost,
        extra_ids,
        discount_amount,
        products (
            name
        )
    ),
    staff_name,
    table_name
`

export async function fetchTodayOrders(addressId: UUID | null): Promise<any> {
    if (localRepo.isGuest()) return localRepo.fetchLocalOrders(addressId)
    if (!supabase) return []
    const today = startOfDayVN()

    let query = supabase
        .from('orders')
        .select(ORDER_SELECT)
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
        console.error('fetchTodayOrders error:', error)
        return []
    }
    return data
}

// ---- Đồng bộ đa thiết bị (poll, xem hooks/useOrdersPoll.js) ----
// Câu chạy 1.5 giây một lần trên mỗi máy đang mở /pos hoặc /history, nên nó phải rẻ ở
// TRẠNG THÁI KHÔNG ĐỔI — tức gần như mọi nhịp.
//
// `rev` là watermark do trigger trên orders nuôi (20260813_orders_sync_marks). Gửi kèm số
// đang giữ: khớp thì RPC trả đúng con số đó và KHÔNG đọc orders dòng nào (~80 byte); lệch
// mới trả mảng đầu đơn. Trước đây mỗi nhịp kéo về đầu đơn cả ngày chỉ để so — chi phí
// bằng (số nhịp × số đơn), nên không thể mua độ trễ bằng cách hạ khoảng nhịp.
//
// rev = null (mới mở màn / đổi chi nhánh / sang ngày mới) ⇒ luôn nhận đầu đơn.
//
// Đầu đơn quét CẢ NGÀY chứ không dùng con trỏ `created_at > lần trước`: bulk_create_orders
// nhận created_at từ client khi replay đơn offline, nên đơn backdate rơi TRƯỚC con trỏ và
// mất hút vĩnh viễn. Quét cả ngày còn bắt được sửa chiết khấu / xoá mềm ở đơn cũ.
//
// heads = null nghĩa là "không đổi", KHÁC HẲN [] nghĩa là "hôm nay chưa có đơn nào" —
// người gọi phải phân biệt, nhầm là xoá trắng danh sách (cùng bẫy đã làm mất lưới bàn).
export async function fetchOrdersSync(addressId: UUID | null, rev: number | null): Promise<{ rev: number; heads: any[] | null }> {
    // Guest là local-only (một demo address dùng chung) — không có máy thứ hai để đồng bộ.
    if (localRepo.isGuest() || !supabase || !addressId) return { rev: 0, heads: [] }

    const { data, error } = await supabase.rpc('orders_sync', { p_address_id: addressId, p_rev: rev })
    if (error) throw error   // ném chứ không nuốt: lỗi mạng không phải là "không có đơn nào"
    return { rev: data?.rev ?? 0, heads: data?.heads ?? null }
}

export async function fetchOrdersByIds(ids: UUID[]): Promise<any[]> {
    if (localRepo.isGuest() || !supabase || !ids.length) return []

    const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .in('id', ids)

    if (error) throw error
    return data || []
}

// Số đ đã giảm cho một dòng giỏ hàng — item.discount là {type, value} chọn ở
// CartListModal, resolve về đ để gửi đi (order_items.discount_amount cùng dạng
// resolved-amount như orders.discount_amount, không lưu %/đ đã chọn).
const lineDiscountAmount = (item: CartItem) => computeDiscount(cartLineSubtotal(item), item.discount || NO_DISCOUNT).discountAmount

// Submit a complete order to Supabase using RPC for atomic transaction
// totalCost: tổng giá vốn của bill (snapshot)
// costPerItem: Map<cartItemId, unitCost> giá vốn mỗi dòng (snapshot)
export async function submitOrder(
    cart: CartItem[],
    total: number,
    paymentMethod: string | null = null,
    addressId: UUID | null = null,
    totalCost = 0,
    costPerItem: CostPerItem = {},
    staffName: string | null = null,
    discountAmount = 0,
    id: UUID | null = null,
    tableName: string | null = null
): Promise<{ id: string | null }> {
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) {
        return localRepo.submitLocalOrder({
            id,
            total,
            total_cost: Math.round(totalCost),
            discount_amount: Math.round(discountAmount),
            payment_method: paymentMethod,
            address_id: addressId,
            staff_name: staffName,
            order_items: cart.map(item => ({
                // Local (guest) rows never touch the DB, nên tự sinh id ở client —
                // updateLocalOrderDiscount cần nó để sửa giảm giá đúng dòng sau này,
                // giống order_items.id thật ở nhánh Supabase bên dưới.
                id: crypto.randomUUID(),
                product_id: item.productId,
                quantity: item.quantity,
                options: item.extras?.length > 0 ? item.extras.map(e => e.name).join(', ') : null,
                unit_cost: Math.round(costPerItem[item.cartItemId] || 0),
                discount_amount: lineDiscountAmount(item)
            }))
        })
    }
    if (!supabase) throw new Error('No Supabase connection')

    // total/totalCost/costPerItem are NOT sent — bulk_create_orders recomputes
    // price and COGS server-side from products/recipes, so a tampered client
    // can't write an arbitrary total. The client only declares WHAT was bought.
    // discount_amount per item is trusted as-is (same trust boundary as the
    // order-level discount_amount above — see 20260816_order_items_line_discount.sql).
    const orderPayload: OrderPayload = {
        id,
        discount_amount: Math.round(discountAmount),
        payment_method: paymentMethod,
        address_id: addressId,
        staff_name: staffName,
        table_name: tableName,
        items: cart.map(item => ({
            product_id: item.productId,
            quantity: item.quantity,
            extra_ids: item.extras?.length > 0 ? item.extras.map(e => e.id).filter(Boolean) : [],
            discount_amount: lineDiscountAmount(item)
        }))
    }

    // Call RPC function for single transaction order creation. id is
    // client-generated (see caller) and echoed back — no server round-trip
    // needed to learn it, so the optimistic row never has to be re-keyed.
    const { error } = await supabase.rpc('bulk_create_orders', {
        orders_payload: [orderPayload]
    })

    if (error) throw error
    return { id }
}

// Bulk submit offline orders in ONE HTTP Request
export async function bulkSubmitOrders(ordersArray: any[]): Promise<boolean> {
    // Mixed addresses possible — flush all to be safe.
    invalidateReportCache(null)
    if (localRepo.isGuest()) {
        // Map the offline-queue shape (camelCase: orderItems / addressId / totalCost) to the
        // localRepo row shape (order_items / address_id / total_cost), same as submitOrder does.
        // Without this, fetchLocalOrders filters on `address_id` and never sees these orders →
        // a guest's offline orders silently vanish after sync.
        ordersArray.forEach((o: any) => localRepo.submitLocalOrder({
            id: o.id,
            total: o.total,
            total_cost: o.totalCost || 0,
            discount_amount: o.discountAmount || 0,
            payment_method: o.paymentMethod,
            address_id: o.addressId,
            staff_name: o.staffName,
            created_at: o.createdAt,
            order_items: (o.orderItems || []).map((item: any) => ({
                product_id: item.productId,
                quantity: item.quantity,
                options: item.extras?.length > 0 ? item.extras.map((e: any) => e.name).join(', ') : null,
                unit_cost: Math.round(item.unitCost || 0),
                discount_amount: lineDiscountAmount(item),
            })),
        }))
        return true
    }
    if (!supabase) throw new Error('No Supabase connection')

    // Same server-priced contract as submitOrder — total/unit_cost aren't sent,
    // bulk_create_orders recomputes them from products/recipes. id is the fixed
    // client-generated id from addPendingOrder — required for ON CONFLICT idempotency
    // on retry (see 20260713_bulk_create_orders_idempotent_retry.sql).
    const payload = ordersArray.map((o: any) => ({
        id: o.id,
        discount_amount: o.discountAmount || 0,
        payment_method: o.paymentMethod,
        address_id: o.addressId,
        created_at: o.createdAt,
        staff_name: o.staffName,
        table_name: o.tableName ?? null,
        items: o.orderItems.map((item: any) => ({
            product_id: item.productId,
            quantity: item.quantity,
            extra_ids: item.extras?.length > 0 ? item.extras.map((e: any) => e.id).filter(Boolean) : (item.extraIds || []).filter(Boolean),
            discount_amount: lineDiscountAmount(item)
        }))
    }))

    const { error } = await supabase.rpc('bulk_create_orders', {
        orders_payload: payload
    })

    if (error) throw error
    return true
}

// Soft Delete an order. addressId unknown — flush all.
export async function deleteOrder(orderId: UUID, staffName: string | null = null): Promise<boolean> {
    invalidateReportCache(null)
    // localRepository is untyped JS; its `= null` defaults make tsc infer params as `null`.
    // Cast the fn (lazy, at call time — safe under circular imports) until it's converted.
    if (localRepo.isGuest()) return (localRepo.deleteLocalOrder as any)(orderId, staffName)
    if (!supabase) throw new Error('No Supabase connection')

    const { error: orderError } = await supabase
        .from('orders')
        .update({ deleted_at: new Date().toISOString(), deleted_by: staffName })
        .eq('id', orderId)

    if (orderError) throw orderError

    return true
}

// Re-apply / edit a per-order discount after the fact. `total` is the new charged
// amount (subtotal − discount); discount_amount stores the đ reduced. itemDiscounts
// (optional) additionally sets order_items.discount_amount per line, in the SAME
// transaction as the order update (see update_order_discount RPC) — không phải hai
// ghi riêng có thể lệch nhau giữa chừng. COGS (total_cost) is unchanged — a discount
// affects revenue, not cost. addressId unknown → flush all.
export async function updateOrderDiscount(orderId: UUID, total: number, discountAmount: number, itemDiscounts: { id: UUID, discount_amount: number }[] = []): Promise<boolean> {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return (localRepo.updateLocalOrderDiscount as any)(orderId, total, discountAmount, itemDiscounts)
    if (!supabase) throw new Error('No Supabase connection')

    const { error } = await supabase.rpc('update_order_discount', {
        p_order_id: orderId,
        p_total: total,
        p_discount_amount: discountAmount,
        p_item_discounts: itemDiscounts,
    })

    if (error) throw error

    return true
}

// Fetch orders within a date range for an address (same structure as fetchTodayOrders)
export async function fetchOrdersByRange(addressId: UUID | null, start: Date, end: Date): Promise<any> {
    return reportCache.through([addressId, 'ordersByRange', start.toISOString(), end.toISOString()], async () => {
        if (localRepo.isGuest()) {
            const sMs = start.getTime(), eMs = end.getTime()
            return localRepo.fetchAllLocalOrders(addressId)
                .filter((o: any) => {
                    const t = new Date(o.created_at).getTime()
                    return t >= sMs && t <= eMs
                })
                .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        }
        if (!supabase) return []
        let query = supabase
            .from('orders')
            .select(`id, order_no, total, total_cost, discount_amount, payment_method, staff_name, table_name, created_at, deleted_at, deleted_by,
                order_items(id, quantity, options, product_id, unit_cost, extra_ids, discount_amount, products(name))`)
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString())
        if (addressId) query = query.eq('address_id', addressId)
        const { data, error } = await query.order('created_at', { ascending: false })
        if (error) { console.error('fetchOrdersByRange error:', error); return [] }
        return data || []
    })
}

// Fetch the most recent order today for an address (with items + product names)
export async function fetchRecentOrders(addressId: UUID | null, limit = 3): Promise<any[]> {
    if (localRepo.isGuest()) {
        const todayStr = dateStringVN()
        return localRepo.fetchAllLocalOrders(addressId)
            .filter((o: any) => !o.deleted_at && dateStringVN(new Date(o.created_at)) === todayStr)
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit)
    }
    if (!supabase) return []
    const today = startOfDayVN()

    let query = supabase
        .from('orders')
        .select(`id, total, created_at, deleted_at, deleted_by, order_items(quantity, options, product_id, products(name))`)
        .gte('created_at', today.toISOString())
        .is('deleted_at', null)

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
    if (error || !data) return []
    return data
}

// ---- Bàn đang mở (địa chỉ dine_in) ----
// Một bàn = nhóm đơn cùng table_name, chưa xoá, chưa tính tiền (table_closed_at
// IS NULL — xem migration 20260808_dine_in_open_tables). Gộp ở client: tập này
// luôn nhỏ (số bàn đang có khách), không đáng một RPC riêng.
//
// KHÔNG lọc theo ngày, cố ý: quán mở qua nửa đêm thì bàn ngồi từ 23g50 sang 0g10
// vẫn phải là MỘT bàn. Cắt theo ngày sẽ giấu mất các đợt gọi trước nửa đêm và
// nhân viên tính thiếu tiền của khách. Đổi lại, bàn quên chưa tính tiền sẽ nằm
// lại lưới sang hôm sau — hiện kèm ngày để không bị đọc nhầm là bàn hôm nay.
// lines = tờ hoá đơn đang chạy của bàn: gộp mọi đợt lại theo TÊN MÓN ("2 Trà đá"),
// không phải theo từng đợt. Đó là cái nhân viên đọc to cho khách lúc tính tiền.
// Topping nằm TRONG tên dòng: "Cacao Cà Phê (Trân châu)" và "Cacao Cà Phê" là hai
// dòng khác nhau, vì gộp lại thì đọc thiếu topping lúc tính tiền và pha sai món.
// rounds = từng đợt gọi, giữ nguyên id + giờ để modal chi tiết bàn xoá/đọc được
// đúng đợt. lines (gộp) vẫn để nguyên cho thẻ bàn và câu đọc lúc tính tiền.
// items = nguyên liệu để DỰNG LẠI giỏ khi sửa đợt (product_id + extra_ids), khác lines
// vốn chỉ là chữ để đọc. Không suy ngược được từ lines: hai topping có thể trùng tên.
//
// Bucket đặc biệt name=null: đơn MANG ĐI chưa ra món (table_name thật là null). Đơn mang
// đi không có "tính tiền" (đã trả ngay lúc tạo) nên không cần lọc table_closed_at, chỉ cần
// served_at IS NULL — ra món xong thì coi như xong, rơi khỏi bucket này (đọc/in/xoá đơn cũ
// vẫn làm ở Nhật ký). Nhờ vậy TableModal/moveTableRounds/toggleServed dùng lại nguyên logic
// "một bàn" cho cả mang đi, không cần state/fetch riêng.
export type TableLine = { name: string; qty: number }
export type TableRoundItem = { productId: UUID; qty: number; extraIds: UUID[]; discountAmount: number }
export type TableRound = { id: UUID; orderNo: number | null; createdAt: string; total: number; discountAmount: number; servedAt: string | null; staffName: string | null; lines: TableLine[]; items: TableRoundItem[] }
export type OpenTable = { name: string | null; total: number; rounds: TableRound[]; openedAt: string; lines: TableLine[] }

// 'Tiền mặt'/'MoMo' đi chung mảng extras nhưng là cách trả tiền, không phải topping —
// cùng quy ước với buildLastOrderFrom* ở POSContext.
const PAYMENT_EXTRAS = new Set(['Tiền mặt', 'MoMo'])

// Nhãn một dòng hoá đơn. Dùng ở fetchOpenTables (extras đã là chuỗi 'a, b' trong
// order_items.options) và ở POSContext (extras còn là mảng object của giỏ).
export function tableLineName(name: string, extraNames: (string | undefined)[]): string {
    const opts = extraNames.filter((n): n is string => !!n && !PAYMENT_EXTRAS.has(n))
    return opts.length ? `${name} (${opts.join(', ')})` : name
}

// Gộp dòng trùng nhãn. Dùng cả ở đây và ở POSContext (cộng lạc quan đợt vừa gửi).
export function mergeTableLines(base: TableLine[], add: TableLine[]): TableLine[] {
    const out = base.map(l => ({ ...l }))
    for (const l of add) {
        const hit = out.find(x => x.name === l.name)
        if (hit) hit.qty += l.qty
        else out.push({ ...l })
    }
    return out
}

// Bớt các round có id trong dropIds ra khỏi bàn t, tính lại total/lines từ số round còn
// lại. table=null nếu bàn hết round (lọc bỏ luôn). removed rỗng (table===t, cùng reference)
// nếu không round nào của bàn này bị bớt. Dùng ở POSContext cho cả xoá đơn (handleDeleteOrder)
// lẫn chuyển/gộp bàn (moveTableRounds) — hai chỗ khác nhau mỗi việc dropIds là gì và có cần
// đọc lại removed hay không.
export function extractRounds(t: OpenTable, dropIds: Set<UUID>): { table: OpenTable | null, removed: TableRound[] } {
    const removed = t.rounds.filter(r => dropIds.has(r.id))
    if (!removed.length) return { table: t, removed }
    const stay = t.rounds.filter(r => !dropIds.has(r.id))
    const table = stay.length
        ? { ...t, rounds: stay, total: stay.reduce((s, r) => s + r.total, 0), lines: stay.reduce((ls, r) => mergeTableLines(ls, r.lines), [] as TableLine[]) }
        : null
    return { table, removed }
}

// Đóng bàn (tính tiền) = bỏ khỏi lưới. Dùng ở POSContext (handleCloseTable) cho cả optimistic
// drop lẫn undo (drop lại sau khi hoàn tác thất bại).
export function dropTableByName(tables: OpenTable[], name: string): OpenTable[] {
    return tables.filter(t => t.name !== name)
}

// Hoàn tác đóng bàn: thêm lại bàn đã lưu TRƯỚC lúc đóng. Idempotent — bàn có thể đã có mặt
// trong lưới lúc bấm Hoàn tác (vd refreshTables chạy xen giữa), thêm lần hai là 2 thẻ cùng
// tên nhảy ra trên lưới bàn.
export function restoreTable(tables: OpenTable[], table: OpenTable): OpenTable[] {
    return tables.some(t => t.name === table.name) ? tables : [...tables, table]
}

// Gộp (chuyển hết đợt của 1 bàn) / tách (chuyển 1 đợt) đều dùng hàm này — chỉ khác orderIds
// truyền vào idSet. Trả nextTables (openTables sau khi chuyển) + moved (các round vừa chuyển).
// moved rỗng nghĩa là orderIds không khớp round nào đang có trong prevTables (state vừa đổi
// ở máy khác) — người gọi phải tự fallback gọi mạng + refreshTables thay vì áp state lạc quan
// (nextTables trả về nguyên prevTables trong trường hợp đó, không phải mảng rỗng).
export function moveRoundsIntoTable(prevTables: OpenTable[], idSet: Set<UUID>, targetName: string | null): { nextTables: OpenTable[], moved: TableRound[] } {
    const moved: TableRound[] = []
    const withoutMoved = prevTables
        .map(t => {
            const { table, removed } = extractRounds(t, idSet)
            moved.push(...removed)
            return table
        })
        .filter((t): t is OpenTable => t !== null)

    if (!moved.length) return { nextTables: prevTables, moved }

    const movedLines = moved.reduce((ls, r) => mergeTableLines(ls, r.lines), [] as TableLine[])
    const movedTotal = moved.reduce((s, r) => s + r.total, 0)
    const destIdx = withoutMoved.findIndex(t => t.name === targetName)
    const nextTables = destIdx === -1
        ? [...withoutMoved, { name: targetName, total: movedTotal, rounds: moved, openedAt: moved.reduce((min, r) => r.createdAt < min ? r.createdAt : min, moved[0].createdAt), lines: movedLines }]
        : withoutMoved.map((t, i) => i === destIdx
            ? { ...t, rounds: [...t.rounds, ...moved], total: t.total + movedTotal, lines: mergeTableLines(t.lines, movedLines) }
            : t)

    return { nextTables, moved }
}

// Đánh dấu một đợt đã pha xong và bưng ra. Chỉ là mốc thời gian trên orders, không
// đụng tiền — bàn 2 người vừa pha vừa thu tiền nhìn vào đây để biết đợt nào còn nợ khách.
// servedAt = null để bỏ đánh dấu (bấm nhầm).
export async function markOrderServed(orderId: UUID, servedAt: string | null): Promise<void> {
    if (localRepo.isGuest()) return // chế độ khách demo không có bàn (xem fetchOpenTables)
    if (!supabase) throw new Error('No Supabase connection')

    const { error } = await supabase
        .from('orders')
        .update({ served_at: servedAt })
        .eq('id', orderId)

    if (error) throw error
}

export async function fetchOpenTables(addressId: UUID | null): Promise<OpenTable[]> {
    // ponytail: chế độ khách demo chạy localRepository và không bật dine_in → không có bàn.
    if (!supabase || !addressId || localRepo.isGuest()) return []

    const { data, error } = await supabase
        .from('orders')
        .select('id, order_no, total, discount_amount, created_at, served_at, staff_name, table_name, order_items(quantity, options, product_id, extra_ids, discount_amount, products(name))')
        .eq('address_id', addressId)
        .is('deleted_at', null)
        .is('table_closed_at', null)
        // Bàn thật (table_name khác null) luôn lấy, bất kể served_at HAY NGÀY TẠO — đợt
        // đã ra món vẫn phải hiện tới khi bàn tính tiền, và bàn mở trước nửa đêm vẫn phải
        // còn nguyên sau 0h. Đơn mang đi (table_name null) thì chỉ lấy khi CHƯA ra món VÀ
        // tạo hôm nay — không chặn ngày ở đây thì địa chỉ vừa bật dine_in sẽ thấy nguyên
        // lịch sử đơn mang đi TRƯỚC ĐÓ hiện ra là "chưa ra món" (served_at vốn luôn NULL ở
        // chế độ takeaway cũ, vì nút Đã ra món chỉ tồn tại trong UI dine_in) — bắt được
        // thật: 1 địa chỉ mới bật dine_in, hiện tới 1281 "món chưa ra" ngày đầu tiên. Cùng
        // lý do đây còn là chốt chặn PostgREST trả tối đa 1000 dòng: bàn thật ít (vài chục,
        // không lọc ngày cũng chẳng bao giờ chạm trần), mang đi thì giờ đã có sàn ngày nên
        // không còn phình vô hạn qua nhiều ngày để chạm trần đó nữa.
        .or(`table_name.not.is.null,and(served_at.is.null,created_at.gte.${startOfDayVN().toISOString()})`)
        .order('created_at', { ascending: true })

    // NÉM lỗi thay vì trả [] — mảng rỗng nghĩa là "không bàn nào còn khách", và người
    // gọi sẽ tin: một lỗi mạng/schema hoá ra xoá trắng cả lưới bàn giữa ca (xem
    // refreshTables). Không phân biệt được hai thứ này là bug từng làm mất bàn thật.
    if (error) throw error
    if (!data) return []

    const byName = new Map<string | null, OpenTable>()
    for (const o of data as any[]) {
        const t: OpenTable = byName.get(o.table_name) ?? { name: o.table_name, total: 0, rounds: [], openedAt: o.created_at, lines: [] }
        const roundLines = mergeTableLines([], (o.order_items || []).map((i: any) => ({
            // Món bị xoá khỏi menu sau khi đã bán: vẫn phải hiện một dòng, nếu không
            // thì tổng tiền không khớp với danh sách món.
            name: tableLineName(i.products?.name || 'Món đã xoá', (i.options || '').split(', ')),
            qty: i.quantity,
        })))
        t.total += o.total
        t.rounds.push({
            id: o.id, orderNo: o.order_no ?? null, createdAt: o.created_at, total: o.total, discountAmount: o.discount_amount || 0, servedAt: o.served_at ?? null,
            staffName: o.staff_name ?? null,
            lines: roundLines,
            items: (o.order_items || []).map((i: any) => ({
                productId: i.product_id, qty: i.quantity, extraIds: i.extra_ids || [], discountAmount: i.discount_amount || 0,
            })),
        })
        t.lines = mergeTableLines(t.lines, roundLines)
        byName.set(o.table_name, t)
    }
    return [...byName.values()]
}

// Tính tiền = đóng cả nhóm bằng một UPDATE. Không đụng total/doanh thu: tiền đã
// ghi ngay từng đợt, đây chỉ là mốc "bàn này xong rồi, đừng hiện nữa".
// Cùng lý do như fetchOpenTables: không lọc ngày, nếu không thì đợt gọi trước nửa
// đêm vẫn mở và bàn "đã tính tiền" lại hiện lên như còn khách.
// closedAt truyền vào được (không tự sinh) vì 2 chỗ cần biết trước mốc này: hàng chờ
// offline (đóng bàn lúc mất mạng, mốc phải là lúc thu tiền chứ không phải lúc có mạng
// lại) và nút Hoàn tác — reopenTable gỡ ĐÚNG những đơn mang mốc đó, không đụng các đợt
// đã đóng ở lần tính tiền trước.
export async function closeTable(addressId: UUID, tableName: string, closedAt = new Date().toISOString()): Promise<string> {
    if (!supabase) throw new Error('No Supabase connection')

    const { error } = await supabase
        .from('orders')
        .update({ table_closed_at: closedAt })
        .eq('address_id', addressId)
        .eq('table_name', tableName)
        .is('table_closed_at', null)

    if (error) throw error
    return closedAt
}

// Hoàn tác tính tiền: mở lại đúng nhóm đơn mà closeTable vừa đóng.
export async function reopenTable(addressId: UUID, tableName: string, closedAt: string): Promise<void> {
    if (!supabase) throw new Error('No Supabase connection')

    const { error } = await supabase
        .from('orders')
        .update({ table_closed_at: null })
        .eq('address_id', addressId)
        .eq('table_name', tableName)
        .eq('table_closed_at', closedAt)

    if (error) throw error
}

// Gộp bàn (chuyển hết đợt) / tách bàn (chuyển một đợt) đều là MỘT thao tác: đổi
// table_name của các đợt (order) đã chọn. Không đụng total/order_no — mỗi đợt giữ
// nguyên số hoá đơn đã cấp lúc tạo (xem orderNo trong TableDetailModal), gộp/tách chỉ
// đổi nhóm hiển thị. Cùng trust boundary như closeTable (chỉ đổi nhãn bàn, không đụng
// tiền) nên update thẳng, không cần RPC riêng.
// targetTableName = null nghĩa là "chuyển thành mang đi" (bỏ bàn) — xem bucket name=null
// ở fetchOpenTables.
export async function moveTableRounds(addressId: UUID, orderIds: UUID[], targetTableName: string | null): Promise<void> {
    if (!supabase) throw new Error('No Supabase connection')

    const { error } = await supabase
        .from('orders')
        .update({ table_name: targetTableName })
        .eq('address_id', addressId)
        .in('id', orderIds)
        .is('table_closed_at', null)

    if (error) throw error
}

// ---- Compat barrel: existing call sites import everything from this file.
// New code should prefer the focused service files directly.
export * from './productService'
export * from './expenseService'
export * from './recipeService'
export * from './ingredientCostService'
export * from './ingredientStockService'
export * from './restockService'
export * from './reportService'
