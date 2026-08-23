import { lookupByLabel } from './ingredients'
import { dateStringVN } from './dateVN'

/**
 * Tính toán giá vốn của một sản phẩm, bao gồm cả tuỳ chọn thêm (extras).
 * 
 * @param {string} productId - ID của món chính
 * @param {Array} extras - Danh sách các tuỳ chọn đi kèm (ví dụ: [{id: 'size_L', name: 'Size L', price: 5000}])
 * @param {Array} recipes - Toàn bộ recipes để tìm công thức của món chính
 * @param {Object} extraIngredients - Map extra_id -> mảng ingredients. VD: { 'size_L': [{ingredient: 'Ca_phe', amount: 7}, {ingredient: 'Ly_S', amount: -1}, {ingredient: 'Ly_L', amount: 1}] }
 * @param {Object} ingredientCosts - Map ingredient_id -> cost (giá vốn 1 đơn vị)
 * @returns {number} Tổng giá vốn
 */
export function calculateItemCost(productId, extras = [], recipes = [], extraIngredients = {}, ingredientCosts = {}) {
    let totalCost = 0;

    // 1. Tính giá vốn món chính
    const productRecipe = recipes.filter(r => r.product_id === productId);
    productRecipe.forEach(item => {
        const unitCost = ingredientCosts[item.ingredient] || 0;
        totalCost += (item.amount * unitCost);
    });

    // 2. Tính giá vốn của extras
    extras.forEach(extra => {
        const extraIngs = extraIngredients[extra.id] || [];
        extraIngs.forEach(ei => {
            const unitCost = ingredientCosts[ei.ingredient] || 0;
            totalCost += (ei.amount * unitCost);
        });
    });

    return totalCost;
}

// recipes gom sẵn theo product_id. Không có nó thì mỗi order item quét lại toàn bộ bảng
// recipes → cuối ca vài trăm đơn × vài trăm dòng công thức = quadratic ngay trên máy nhân viên.
function groupRecipesByProduct(recipes) {
    const byProduct = new Map();
    (recipes || []).forEach(r => {
        const list = byProduct.get(r.product_id);
        if (list) list.push(r);
        else byProduct.set(r.product_id, [r]);
    });
    return byProduct;
}

/**
 * Tính tổng lượng nguyên liệu tiêu hao dự kiến dựa trên danh sách món đã bán.
 * 
 * @param {Array} orderItems - Mảng các order item (có thể lấy từ todayOrders + offlineToday)
 *                             Cấu trúc yêu cầu: { product_id hoặc productId, quantity hoặc qty, extras: [] }
 * @param {Array} recipes - Toàn bộ bản ghi recipes
 * @param {Object} extraIngredients - Map extra_id -> array of {ingredient, amount}
 * @returns {Object} object mapping ingredient -> tổng số lượng tiêu hao
 */
// Chuẩn hoá item của MỘT đơn về { productId, qty, extras } — nguồn duy nhất cho mọi
// chỗ nạp đơn vào calculateEstimatedConsumption/buildIngredientToProduct. Nhận cả 3
// shape đang tồn tại: order_items (server), orderItems / cart (đơn offline chờ sync).
export function orderItemsOf(order) {
    return (order.order_items || order.orderItems || order.cart || []).map(i => ({
        productId: i.product_id || i.productId,
        qty: i.quantity || i.qty || 1,
        extras: i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || []),
    }))
}

// Đơn còn sống (chưa xoá) — server dùng deleted_at, đơn offline dùng deletedAt.
export const isLiveOrder = (o) => !o.deleted_at && !o.deletedAt

export function calculateEstimatedConsumption(orderItems, recipes, extraIngredients) {
    const estimated = {};
    const recipesByProduct = groupRecipesByProduct(recipes);

    orderItems.forEach(item => {
        // Hỗ trợ cả 2 naming convention (productId vs product_id)
        const id = item.productId || item.product_id;
        const qty = item.quantity || item.qty || 1;
        const extras = item.extras || [];

        // 1. Tiêu hao của món chính
        const productRecipes = recipesByProduct.get(id) || [];
        productRecipes.forEach(r => {
            if (!estimated[r.ingredient]) estimated[r.ingredient] = 0;
            estimated[r.ingredient] += r.amount * qty;
        });

        // 2. Tiêu hao của extras
        extras.forEach(extra => {
            const extraIngs = extraIngredients[extra.id] || [];
            extraIngs.forEach(ei => {
                if (!estimated[ei.ingredient]) estimated[ei.ingredient] = 0;
                estimated[ei.ingredient] += ei.amount * qty;
            });
        });
    });

    // Xóa những nguyên liệu có lượng tiêu hao = 0 (tránh bị hiển thị trống hoặc âm do bù trừ do thiết lập sai sót nhẹ nếu có)
    Object.keys(estimated).forEach(key => {
        // Làm tròn lấy 1 chữ số thập phân để tránh lỗi epsilon Math floating point của JS (ví dụ 0.1 + 0.2 = 0.30000000004)
        estimated[key] = Math.round(estimated[key] * 10) / 10;
        if (estimated[key] === 0) {
            delete estimated[key];
        }
    });

    return estimated;
}

/**
 * Trung bình nhiều bản đồ tiêu hao (mỗi bản = 1 tuần lịch sử cùng thứ) thành 1 dự báo mượt
 * hơn — dùng để tránh forecast "Soạn"/"Chuẩn bị" nhạy cảm với 1 ngày bất thường (nghỉ lễ,
 * vắng khách đột xuất) của đúng 1 tuần trước. Tuần không bán gì cho 1 nguyên liệu vẫn tính
 * là 0 trong trung bình (không loại trừ khỏi mẫu số) vì đó là tín hiệu thật (ế ngày đó).
 *
 * @param {Array<Object>} maps - mảng usedMap (ingredient -> lượng tiêu hao), 1 map/tuần
 * @returns {Object} ingredient -> trung bình, làm tròn 1 chữ số thập phân, bỏ nếu = 0
 */
export function averageIngredientMaps(maps) {
    const weeks = (maps || []).filter(Boolean);
    if (weeks.length === 0) return {};

    const sums = {};
    weeks.forEach(map => {
        Object.entries(map).forEach(([ingredient, amount]) => {
            sums[ingredient] = (sums[ingredient] || 0) + (Number(amount) || 0);
        });
    });

    const averaged = {};
    Object.entries(sums).forEach(([ingredient, sum]) => {
        const avg = Math.round((sum / weeks.length) * 10) / 10;
        if (avg !== 0) averaged[ingredient] = avg;
    });
    return averaged;
}

/**
 * Tính breakdown tiêu hao theo từng biến thể (sản phẩm + tổ hợp extras) cho mỗi nguyên liệu.
 * Dùng để drill-down "Tiêu CT" trong inventory audit.
 *
 * Variant key: `productId` nếu không có extras, hoặc `productId|<sorted extra ids>`.
 *
 * @returns {Object} breakdown[ingredient][variantKey] = { name, qty, totalAmount }
 */
export function calculateConsumptionBreakdown(orderItems, recipes, extraIngredients, products = [], productExtras = {}) {
    const breakdown = {};
    const recipesByProduct = groupRecipesByProduct(recipes);
    const productNames = new Map((products || []).map(p => [p.id, p.name]));

    // Build extra-id → extra-name lookup từ productExtras { productId: [{ id, name, ... }] }
    const extraNames = {};
    Object.values(productExtras || {}).forEach(list => {
        (list || []).forEach(ex => {
            if (ex && ex.id) extraNames[ex.id] = ex.name || ex.id;
        });
    });

    const ensure = (ingredient, variantKey, displayName) => {
        if (!breakdown[ingredient]) breakdown[ingredient] = {};
        if (!breakdown[ingredient][variantKey]) {
            breakdown[ingredient][variantKey] = { name: displayName, qty: 0, totalAmount: 0 };
        }
    };

    orderItems.forEach(item => {
        const id = item.productId || item.product_id;
        const qty = item.quantity || item.qty || 1;
        const extras = item.extras || [];
        const productName = productNames.get(id) || id;

        const extraIds = extras.map(e => e?.id).filter(Boolean).slice().sort();
        const variantKey = extraIds.length ? `${id}|${extraIds.join(',')}` : id;
        const extraLabels = extraIds.map(eid => extraNames[eid] || eid);
        const displayName = extraLabels.length
            ? `${productName} (${extraLabels.join(', ')})`
            : productName;

        // Track which ingredients this order item touches, so qty is counted only once
        // even if both base recipe and an extra affect the same ingredient.
        const counted = new Set();

        const touch = (ingredient, amount) => {
            ensure(ingredient, variantKey, displayName);
            if (!counted.has(ingredient)) {
                breakdown[ingredient][variantKey].qty += qty;
                counted.add(ingredient);
            }
            breakdown[ingredient][variantKey].totalAmount =
                Math.round((breakdown[ingredient][variantKey].totalAmount + amount * qty) * 10) / 10;
        };

        (recipesByProduct.get(id) || []).forEach(r => touch(r.ingredient, r.amount));
        extras.forEach(extra => {
            (extraIngredients[extra.id] || []).forEach(ei => touch(ei.ingredient, ei.amount));
        });
    });

    return breakdown;
}

/**
 * Bucket ingredient COGS across all orders into {main, packaging, tools}
 * using CURRENT recipes + ingredient category map.
 *
 * Returns absolute VND amounts per bucket — caller can rescale against a
 * historical totalCOGS to absorb recipe-drift when needed (Range mode uses
 * order.total_cost snapshots which can diverge from current-recipe cost).
 *
 * Ingredients with no category (null) are treated as 'main' to match the
 * UX rule: legacy NVL fall under "Nguyên liệu chính" until reclassified.
 */
export function splitCogsByCategory(orders, recipes, extraIngredients, ingredientCosts, categoryByIngredient) {
    const bucket = { main: 0, packaging: 0, tools: 0 }
    const bucketFor = (key) => {
        const cat = (categoryByIngredient?.get?.(key)) ?? categoryByIngredient?.[key] ?? null
        return cat === 'packaging' || cat === 'tools' ? cat : 'main'
    }
    const recipesByProduct = groupRecipesByProduct(recipes)
    for (const o of orders || []) {
        if (o?.deleted_at) continue
        const items = o.order_items || o.cart || o.orderItems || []
        for (const item of items) {
            const qty = item.quantity || item.qty || 1
            const productId = item.product_id || item.productId
            for (const r of recipesByProduct.get(productId) || []) {
                bucket[bucketFor(r.ingredient)] += (ingredientCosts[r.ingredient] || 0) * (r.amount || 0) * qty
            }
            const extras = item.extras || (item.extra_ids ? item.extra_ids.map(id => ({ id })) : [])
            for (const e of extras) {
                const eid = e?.id
                if (!eid) continue
                for (const ei of extraIngredients[eid] || []) {
                    bucket[bucketFor(ei.ingredient)] += (ingredientCosts[ei.ingredient] || 0) * (ei.amount || 0) * qty
                }
            }
        }
    }
    return bucket
}

/**
 * Per-day audit of `actual - (opening + restock - used)` summed across shift
 * closings; returns Σ|diff × unit_cost| where diff < 0 (hao hụt money lost).
 *
 * Mirrors the formula used inline in InventoryReportCard + RangeLossCard so a
 * single source of truth feeds the FinanceCards "Hao hụt / hủy" line.
 *
 * Opening rules (matches the cards):
 *   - First closing: prevShiftClosings[0]?.inventory_report.remaining map,
 *     OR if `openingOverrideMap` supplied use it as the base (Daily passes
 *     a precomputed map that already folds in yesterday + opening overrides).
 *   - Subsequent closings: previous closing's `remaining` per ingredient.
 *   - Always: `item.opening` on the closing wins when present.
 *
 * dailyConsumption: { 'YYYY-MM-DD': { ingredient: usedAmount, ... } }.
 *   Caller computes via calculateEstimatedConsumption on orders bucketed
 *   by VN local date (matches the existing cards' dayStr key).
 *
 * `recipeIngredients` (optional Set): ingredients consumed by some recipe/extra.
 *   An item NOT in this set has 0 theoretical usage, so its whole depletion is
 *   real consumption (ống hút, bịch chữ T — bao bì chỉ đếm tồn, không vào công
 *   thức), not waste. Those are split into `consumption` keyed by ingredient so
 *   the P&L can name them instead of lumping into "Hao hụt". Omit → all to loss.
 *
 * Returns { loss, consumption: { ingredient: value } }; {loss:0,consumption:{}}
 * when there are no closings.
 */
export function buildRecipeIngredientSet(recipes = [], extraIngredients = {}) {
    const set = new Set()
    for (const r of recipes) if (r?.ingredient) set.add(r.ingredient)
    for (const list of Object.values(extraIngredients || {}))
        for (const ei of (list || [])) if (ei?.ingredient) set.add(ei.ingredient)
    return set
}

/**
 * CORE — công thức audit DUY NHẤT cho "opening = tồn cuối phiên trước / restock =
 * item.restock / used = tiêu thụ ước tính / theoretical = opening+restock-used /
 * diff = actual-theoretical". Trước đây bị chép tay 3 lần (calculateLossValue,
 * RangeLossCard, buildDailyHaoHutMap) — sửa công thức mà quên sửa hết 1 chỗ thì 3 nơi
 * lệch nhau âm thầm, nguy hiểm vì đây là số tiền thật (feed FinanceCards "Hao hụt/hủy").
 *
 * @param {Array} shiftClosings - không cần sort/dedupe sẵn, hàm tự sort theo closed_at
 * @param {Object} dailyConsumption - { dayStr: {ingredient: usedAmount} }
 * @param {Array} [prevShiftClosings] - nguồn opening cho closing ĐẦU TIÊN trong window
 *   (không có openingOverrideMap thì dùng prevShiftClosings[0], mới nhất, DESC)
 * @param {Object} [openingOverrideMap] - ingredient→remaining, override opening của
 *   closing đầu tiên thay vì suy ra từ prevShiftClosings
 * @returns {Array<{dayStr, ingredient, diff, idx}>} — 1 dòng / (ngày, nguyên liệu đã
 *   nhập Cuối kỳ). idx=0 là closing đầu tiên trong window (opening có thể chỉ là suy
 *   đoán ?? 0 nếu caller không truyền prevShiftClosings/openingOverrideMap — caller tự
 *   quyết định có tin idx=0 hay lọc bỏ).
 */
export function walkDailyIngredientDiff({ shiftClosings = [], dailyConsumption = {}, prevShiftClosings = [], openingOverrideMap = null }) {
    if (!shiftClosings.length) return []
    const sorted = [...shiftClosings].sort((a, b) =>
        new Date(a.closed_at || a.created_at) - new Date(b.closed_at || b.created_at)
    )

    let firstOpeningMap = openingOverrideMap
    if (!firstOpeningMap) {
        firstOpeningMap = {}
        for (const it of prevShiftClosings?.[0]?.inventory_report || []) {
            firstOpeningMap[it.ingredient] = it.remaining ?? 0
        }
    }

    const out = []
    sorted.forEach((closing, idx) => {
        if (!closing.inventory_report) return
        const dayStr = dateStringVN(new Date(closing.closed_at || closing.created_at))
        const used = dailyConsumption[dayStr] || {}
        for (const item of closing.inventory_report) {
            if (item.remaining == null) continue
            let opening
            if (item.opening != null) {
                opening = item.opening
            } else if (idx === 0) {
                opening = firstOpeningMap[item.ingredient] ?? 0
            } else {
                const prevItem = (sorted[idx - 1]?.inventory_report || []).find(i => i.ingredient === item.ingredient)
                opening = prevItem?.remaining ?? 0
            }
            const restock = item.restock || 0
            const usedNum = Math.round((used[item.ingredient] || 0) * 10) / 10
            const theoretical = Math.round((opening + restock - usedNum) * 10) / 10
            const diff = Math.round((item.remaining - theoretical) * 10) / 10
            out.push({ dayStr, ingredient: item.ingredient, diff, idx })
        }
    })
    return out
}

export function calculateLossValue({
    shiftClosings,
    prevShiftClosings = [],
    dailyConsumption = {},
    ingredientConfigs = [],
    openingOverrideMap = null,
    recipeIngredients = null,
}) {
    if (!shiftClosings || shiftClosings.length === 0) return { loss: 0, consumption: {} }
    const costByIngredient = new Map()
    for (const c of ingredientConfigs || []) costByIngredient.set(c.ingredient, c.unit_cost || 0)

    const diffs = walkDailyIngredientDiff({ shiftClosings, dailyConsumption, prevShiftClosings, openingOverrideMap })

    let totalLoss = 0
    const consumption = {}
    for (const { ingredient, diff } of diffs) {
        const diffValue = diff * (costByIngredient.get(ingredient) || 0)
        if (diffValue < 0) {
            // Không có trong công thức nào → tiêu hao thật, không phải thất thoát.
            if (recipeIngredients && !recipeIngredients.has(ingredient)) {
                consumption[ingredient] = (consumption[ingredient] || 0) + Math.abs(diffValue)
            } else {
                totalLoss += Math.abs(diffValue)
            }
        }
    }
    return { loss: totalLoss, consumption }
}

// Format a base-unit quantity into pack-aware text. e.g. 5350 + (1000, 'bịch', 'g')
// → "5 bịch + 350 g". Falls back to "{qty} {baseUnit}" when pack info missing.
//   qty: number in baseUnit
//   packSize/packUnit: optional pack config
//   baseUnit: the small-unit label (g, ml, cái, …)
//   { compact: true } drops the base remainder when 0 (e.g. "5 bịch" not "5 bịch + 0 g")
export function formatPackedQty(qty, packSize, packUnit, baseUnit, opts = {}) {
    const n = Math.round(Number(qty || 0) * 10) / 10
    const unit = baseUnit || 'đv'
    const ps = Number(packSize || 0)
    if (!ps || !packUnit || ps <= 0 || !Number.isFinite(n)) {
        return `${n.toLocaleString('vi-VN')} ${unit}`.trim()
    }
    const sign = n < 0 ? -1 : 1
    const abs = Math.abs(n)
    const packs = Math.floor(abs / ps)
    const rem = Math.round((abs - packs * ps) * 10) / 10
    const parts = []
    if (packs > 0) parts.push(`${sign < 0 ? '-' : ''}${packs} ${packUnit}`)
    if (rem > 0 || packs === 0 || !opts.compact) parts.push(`${(sign * rem).toLocaleString('vi-VN')} ${unit}`)
    return parts.filter(Boolean).join(' + ')
}

// Với mỗi nguyên liệu, chọn "sản phẩm đại diện" = món BÁN CHẠY NHẤT có dùng nguyên
// liệu đó, để quy đổi hao hụt → số ly tương đương ("≈ 33 ly cà phê sữa") giúp user
// hình dung magnitude. Bỏ nguyên liệu tỉ lệ 1:1 (ly/nắp) — "≈ 220 ly cà phê sữa" cho
// "Dư 220 cái" không thêm thông tin nào.
//
// orderItems: [{ productId, qty }] đã phẳng hoá (mọi caller đều có sẵn dạng này).
export function buildIngredientToProduct({ orderItems = [], recipes = [], products = [] }) {
    const sales = {}
    for (const i of orderItems) sales[i.productId] = (sales[i.productId] || 0) + (i.qty || 1)

    const map = {}
    for (const r of recipes || []) {
        if (!r.amount || r.amount <= 0) continue
        const s = sales[r.product_id] || 0
        const cur = map[r.ingredient]
        // Ưu tiên best-seller; không có đơn nào thì rơi về recipe gặp đầu tiên.
        if (!cur || s > cur.sales) map[r.ingredient] = { productId: r.product_id, amountPerCup: r.amount, sales: s }
    }

    const byId = new Map((products || []).map(p => [p.id, p]))
    for (const ing of Object.keys(map)) {
        const ref = map[ing]
        const p = byId.get(ref.productId)
        if (!p?.name || ref.amountPerCup === 1) { delete map[ing]; continue }
        ref.productName = p.name.toLowerCase()
    }
    return map
}

// Làm tròn 1 chữ số thập phân — dùng chung cho mọi phép tồn/hao hụt để tránh 3 nơi
// tự định nghĩa lại rồi lệch epsilon nhau.
export const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10

// Hao hụt = Thực tế − Lý thuyết cho 1 nguyên liệu. null = chưa nhập Cuối kỳ (pending),
// caller phải tự phân biệt null với 0 (đã kiểm và khớp). Nguồn dùng chung giữa
// InventoryReportCard (audit UI) và findMissingCupCandidates bên dưới — tránh 2 nơi
// tính hao hụt lệch công thức nhau.
export function computeHaoHut({ inventoryValue, restockValue, openingValue, openingFallback, used }) {
    const hasActual = inventoryValue !== undefined && inventoryValue !== ''
    if (!hasActual) return null
    const restockNum = r1(restockValue)
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')
    const openingNum = r1(openingDisplay)
    const usedNum = r1(used)
    const thucTe = r1(inventoryValue)
    const lyThuyet = r1(openingNum + restockNum - usedNum)
    return r1(thucTe - lyThuyet)
}

/**
 * PROTOTYPE — dò nghi vấn "pha bán nhưng không bấm bill".
 *
 * Ý tưởng: hao hụt của MỘT nguyên liệu đơn lẻ hầu như luôn chỉ là nhiễu (rơi vãi,
 * cân/đong tay không chính xác) — không đủ để kết luận gì. Nhưng nếu hao hụt của
 * NHIỀU nguyên liệu trong CÙNG 1 công thức đều quy đổi ra cùng một số ly N (trong
 * dung sai), khả năng trùng hợp ngẫu nhiên giảm mạnh theo số nguyên liệu đồng thuận
 * → tín hiệu mạnh hơn nhiều so với label "Tương đương N ly" hiện có (vốn chỉ nhìn
 * 1 nguyên liệu "dominant" mỗi dòng, không cross-check).
 *
 * ⚠️ Đây là gợi ý nghi vấn (heuristic), KHÔNG phải kết luận chắc chắn — nhiều
 * nguyên liệu trùng tỉ lệ vẫn có thể do nguyên nhân khác (công thức sai định lượng
 * chung, đổ nguyên liệu lẫn giữa các món). Dùng để soi lại chỗ đáng ngờ, không dùng
 * để quy kết nhân viên.
 *
 * @param {Array} ingredientsList - inventory.ingredientsList ({ ingredient, unit_cost })
 * @param {Object} haoHutByIngredient - ingredient → hao hụt hôm nay (từ computeHaoHut; âm = hụt)
 * @param {Array} recipes - toàn bộ recipes ({ product_id, ingredient, amount })
 * @param {Array} products - toàn bộ products ({ id, name, price, is_active })
 * @param {Object} [noiseByIngredient] - ingredient → độ lệch chuẩn hao hụt lịch sử (từ
 *   computeIngredientNoise). Có thì dùng dung sai THÍCH NGHI theo độ ồn thật của từng
 *   nguyên liệu; không có (hoặc chưa đủ ngày dữ liệu) thì fallback về ±30%/±0.5 cứng.
 * @returns {Array<{ productId, productName, estimatedCups, confidence, estimatedRevenue, ingredientValue, matches }>}
 *   sorted theo (số nguyên liệu khớp desc, confidence desc). estimatedRevenue = N ×
 *   giá bán; ingredientValue = giá trị nguyên liệu hụt tương ứng (Σ|haoHut|×unit_cost
 *   trên các nguyên liệu đã đồng thuận). matches = các dòng nguyên liệu đã đồng thuận
 *   N ly ({ ingredient, haoHut, amount, ratio }).
 */
export function findMissingCupCandidates({ ingredientsList = [], haoHutByIngredient = {}, recipes = [], products = [], noiseByIngredient = {} }) {
    const unitCostByIngredient = {}
    for (const ing of ingredientsList) unitCostByIngredient[ing.ingredient] = Number(ing.unit_cost) || 0

    const recipeByProduct = {}
    for (const r of recipes) {
        if (!r.amount || r.amount <= 0) continue
        ;(recipeByProduct[r.product_id] ??= []).push({ ingredient: r.ingredient, amount: r.amount })
    }

    // Index 1 lần: vòng dưới chạy mỗi product-có-công-thức, và cả hàm này chạy lại
    // mỗi phím gõ + 14 lần trong buildDayCandidateSets — .find() mỗi dòng là quét lại
    // cả bảng products mỗi lần.
    const productById = new Map((products || []).map(p => [p.id, p]))
    const candidates = []
    for (const [productId, recipeRows] of Object.entries(recipeByProduct)) {
        const product = productById.get(productId)
        // Giá 0đ (món test/chưa cấu hình giá, vd "Trà đá"/"Kem muối" mặc định) → không
        // có chuyện "bán thiếu ghi nhận" vì không tốn tiền để bán — loại khỏi nghi vấn.
        if (!product?.is_active || !(Number(product.price) > 0)) continue

        // Quy đổi mỗi nguyên liệu trong công thức ra "số ly ngụ ý" nếu nó đang hụt.
        // Nguyên liệu Khớp/Dư → ratio 0 (phá vỡ đồng thuận, kéo confidence xuống).
        const ratios = []
        for (const { ingredient, amount } of recipeRows) {
            const haoHut = lookupByLabel(ingredient, haoHutByIngredient, null)
            if (haoHut == null) continue // chưa nhập Cuối kỳ cho nguyên liệu này hôm nay
            const ratio = haoHut < 0 ? Math.abs(haoHut) / amount : 0
            ratios.push({ ingredient, amount, haoHut, ratio })
        }
        if (ratios.length < 2) continue // 1 nguyên liệu không cross-check được — bỏ qua

        // Nhóm theo số ly làm tròn gần nhất, lấy nhóm đông nhất làm ứng viên N.
        // Dung sai THÍCH NGHI theo độ ồn thật của từng nguyên liệu (2× độ lệch chuẩn
        // hao hụt lịch sử, quy đổi ra ly — ~95% dao động bình thường nằm trong khoảng
        // này) — matcha 1.5g/ly cần chặt hơn nhiều so với sữa tươi 80ml/ly, dùng chung
        // 1 con số % là sai. Chưa đủ ngày dữ liệu (ingredient mới, ít lịch sử) → fallback
        // ±30% (tối thiểu ±0.5 ly).
        const groups = {}
        for (const r of ratios) {
            const n = Math.round(r.ratio)
            if (n < 1) continue
            const noise = lookupByLabel(r.ingredient, noiseByIngredient, null)
            const tol = noise != null ? Math.max(0.15, (noise / r.amount) * 2) : Math.max(0.5, n * 0.3)
            if (Math.abs(r.ratio - n) > tol) continue
            ;(groups[n] ??= []).push(r)
        }
        const best = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)[0]
        if (!best || best[1].length < 2) continue

        const [bestN, bestMatches] = best
        const confidence = bestMatches.length / ratios.length
        if (confidence < 0.6) continue // đa số nguyên liệu công thức phải đồng thuận

        const ingredientValue = bestMatches.reduce(
            (sum, m) => sum + Math.abs(m.haoHut) * (unitCostByIngredient[m.ingredient] || 0), 0
        )

        candidates.push({
            productId,
            productName: product.name,
            estimatedCups: Number(bestN),
            confidence,
            estimatedRevenue: Number(bestN) * (Number(product.price) || 0),
            ingredientValue,
            matches: bestMatches,
        })
    }

    return candidates.sort((a, b) => b.matches.length - a.matches.length || b.confidence - a.confidence)
}

// Dựng chuỗi hao hụt THEO TỪNG NGÀY từ lịch sử shift_closings (cùng công thức audit
// dùng trong RangeLossCard: opening = tồn cuối phiên trước đó, restock = item.restock,
// used = tiêu thụ ước tính của ngày đó, diff = thực tế − lý thuyết).
//
// Bỏ qua ngày ĐẦU TIÊN trong window vì không biết chắc "opening" của nó (không có
// phiên trước đó trong tập dữ liệu truyền vào) — đơn giản hơn là phải fetch thêm 1
// ngày đệm chỉ để lấy opening, và không đáng vì mục đích ở đây là dò lặp lại nhiều
// ngày, không phải tính tổng tiền chính xác tuyệt đối.
//
// @returns { [dayStr]: { [ingredient]: diff } } — âm = hụt, chỉ gồm nguyên liệu có
//   trong công thức nào đó (bao bì không công thức bị loại, giống RangeLossCard).
export function buildDailyHaoHutMap({ shiftClosings = [], orders = [], recipes = [], extraIngredients = {} }) {
    if (!shiftClosings.length) return {}
    const recipeSet = buildRecipeIngredientSet(recipes, extraIngredients)

    const dailyOrderItems = {}
    for (const o of orders) {
        if (o.deleted_at) continue
        const dayStr = dateStringVN(new Date(o.created_at))
        ;(dailyOrderItems[dayStr] ??= []).push(...orderItemsOf(o))
    }
    const dailyConsumption = {}
    for (const [dayStr, items] of Object.entries(dailyOrderItems)) {
        dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients)
    }

    const lastClosingPerDay = {}
    for (const c of shiftClosings) {
        const dayStr = dateStringVN(new Date(c.closed_at))
        const prev = lastClosingPerDay[dayStr]
        if (!prev || new Date(c.closed_at) > new Date(prev.closed_at)) lastClosingPerDay[dayStr] = c
    }

    const result = {}
    // idx === 0 bỏ qua: ngày đầu window không có phiên trước đó trong tập dữ liệu
    // truyền vào nên opening chỉ là suy đoán (mặc định 0) — không đủ tin để tính diff.
    for (const { dayStr, ingredient, diff, idx } of walkDailyIngredientDiff({
        shiftClosings: Object.values(lastClosingPerDay), dailyConsumption,
    })) {
        if (idx === 0 || !recipeSet.has(ingredient)) continue
        ;(result[dayStr] ??= {})[ingredient] = diff
    }
    return result
}

// Độ nhiễu tự nhiên (đo lường + cân đong) của TỪNG nguyên liệu, suy ra từ độ lệch
// chuẩn hao hụt trong lịch sử gần đây — thay cho tolerance % cứng dùng chung cho mọi
// nguyên liệu. Cần ≥3 ngày có dữ liệu mới tin — ít hơn thì để findMissingCupCandidates
// tự fallback về ±30%/±0.5.
// @returns { [ingredient]: độ lệch chuẩn (đơn vị gốc của nguyên liệu, vd g/ml) }
export function computeIngredientNoise(historicalDailyHaoHut = {}) {
    const valuesByIngredient = {}
    for (const dayMap of Object.values(historicalDailyHaoHut)) {
        for (const [ingredient, diff] of Object.entries(dayMap)) {
            ;(valuesByIngredient[ingredient] ??= []).push(diff)
        }
    }
    const noise = {}
    for (const [ingredient, values] of Object.entries(valuesByIngredient)) {
        if (values.length < 3) continue
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
        noise[ingredient] = Math.sqrt(variance)
    }
    return noise
}

/**
 * Chạy findMissingCupCandidates trên TỪNG ngày lịch sử → 1 Set productId mỗi ngày.
 *
 * Tách riêng khỏi attachRepeatHistory vì đây là phần ĐẮT (quét tới 14 ngày) nhưng chỉ
 * phụ thuộc dữ liệu lịch sử — đứng yên trong lúc nhân viên gõ ô kiểm kê. Gộp chung như
 * trước thì mỗi phím gõ quét lại cả 14 ngày. Caller memo hoá riêng 2 phần.
 *
 * @param {Object} historicalDailyHaoHut - { [dayStr]: {ingredient: diff} } từ buildDailyHaoHutMap
 * @param {Object} [noiseByIngredient] - từ computeIngredientNoise, dùng CHUNG dung sai
 *   thích nghi cho cả ngày hôm nay lẫn từng ngày lịch sử — nhất quán 1 tiêu chuẩn.
 * @returns {Array<Set<string>>} mỗi phần tử = productId là candidate của 1 ngày lịch sử
 */
export function buildDayCandidateSets({ ingredientsList, historicalDailyHaoHut = {}, recipes, products, noiseByIngredient = {} }) {
    return Object.keys(historicalDailyHaoHut).map(dayStr =>
        new Set(findMissingCupCandidates({
            ingredientsList, recipes, products, haoHutByIngredient: historicalDailyHaoHut[dayStr], noiseByIngredient,
        }).map(c => c.productId))
    )
}

/**
 * Gắn "lặp lại mấy ngày gần đây" vào các candidate của hôm nay — tín hiệu quan
 * trọng nhất để phân biệt trùng hợp ngẫu nhiên (1 ngày) với dấu hiệu thật (lặp lại
 * nhiều ngày).
 *
 * @param {Array} todayCandidates - kết quả findMissingCupCandidates() của hôm nay
 * @param {Array<Set<string>>} dayCandidateSets - từ buildDayCandidateSets()
 * @returns candidates hôm nay, thêm field `repeatDays` (số ngày gần đây món này CŨNG
 *   là candidate) + `repeatWindowDays` (tổng số ngày có dữ liệu để so), sort theo
 *   repeatDays trước tiên — lặp lại nhiều ngày mới đáng tin, không phải trùng hợp 1 lần.
 */
export function attachRepeatHistory(todayCandidates, dayCandidateSets = []) {
    if (!todayCandidates.length) return []
    return todayCandidates
        .map(c => ({
            ...c,
            repeatDays: dayCandidateSets.filter(set => set.has(c.productId)).length,
            repeatWindowDays: dayCandidateSets.length,
        }))
        .sort((a, b) => b.repeatDays - a.repeatDays || b.matches.length - a.matches.length || b.confidence - a.confidence)
}
