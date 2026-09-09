/**
 * localRepository.js
 * Manages all "Guest Mode" data in LocalStorage.
 * Mimics Supabase CRUD operations for products, recipes, orders, etc.
 */
import { dateStringVN, startOfDayVN } from '../utils/dateVN'
import { ONBOARDING_STORAGE_PREFIX } from '../utils/onboardingStorage'
import type { Row } from '../types/domain'

const generateId = () => crypto.randomUUID();

const KEYS = {
    ADDRESSES: 'guest_addresses',
    PRODUCTS: 'guest_products',
    RECIPES: 'guest_recipes',
    INGREDIENT_COSTS: 'guest_ingredient_costs',
    PRODUCT_EXTRAS: 'guest_product_extras',
    EXTRA_INGREDIENTS: 'guest_extra_ingredients',
    TOPPINGS: 'guest_toppings',
    TOPPING_INGREDIENTS: 'guest_topping_ingredients',
    PRODUCT_TOPPINGS: 'guest_product_toppings',
    DISCOUNT_PROGRAMS: 'guest_discount_programs',
    DISCOUNT_PROGRAM_PRODUCTS: 'guest_discount_program_products',
    ORDERS: 'guest_orders',
    EXPENSES: 'guest_expenses',
    SHIFT_CLOSINGS: 'guest_shift_closings',
    FIXED_COSTS: 'guest_fixed_costs',
    EXPENSE_CATEGORIES: 'guest_expense_categories',
    EXPENSE_PAYMENTS: 'guest_expense_payments',
    IS_GUEST: 'pos_is_guest'
};

const get = (key: string, fallback: Row[] = []): Row[] => {
    try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : fallback;
    } catch {
        return fallback;
    }
};

const set = (key: string, val: unknown) => localStorage.setItem(key, JSON.stringify(val));

// --- Auth / State ---
export const setIsGuest = (val: boolean) => localStorage.setItem(KEYS.IS_GUEST, val ? 'true' : 'false');
export const isGuest = () => localStorage.getItem(KEYS.IS_GUEST) === 'true';

// --- Addresses ---
const DEMO_ADDRESS_ID = 'demo-address-uuid-123';
const KEY_GUEST_INGREDIENT_SORT = 'guest_ingredient_sort_order';

export const getGuestIngredientSortOrder = () => {
    try {
        const raw = localStorage.getItem(KEY_GUEST_INGREDIENT_SORT);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
};

export const setGuestIngredientSortOrder = (arr: string[]) => {
    localStorage.setItem(KEY_GUEST_INGREDIENT_SORT, JSON.stringify(arr || []));
};

export const getDemoAddress = () => ({
    id: DEMO_ADDRESS_ID,
    name: 'Sử dụng thử',
    manager_id: 'guest',
    ingredient_sort_order: getGuestIngredientSortOrder() || [],
    created_at: new Date().toISOString()
});

// --- Seeding ---
export const initializeGuestFromGlobal = (data: Row) => {
    const addressId = DEMO_ADDRESS_ID;

    if (data.ingredients) {
        set(KEYS.INGREDIENT_COSTS, data.ingredients.map((i: Row) => ({ ...i, address_id: addressId })));
    }
    if (data.products) {
        set(KEYS.PRODUCTS, data.products.map((p: Row) => ({ ...p, owner_address_id: addressId, is_active: true })));
    }
    if (data.recipes) {
        set(KEYS.RECIPES, data.recipes.map((r: Row) => ({ ...r, address_id: addressId })));
    }
    if (data.extras) {
        set(KEYS.PRODUCT_EXTRAS, data.extras.map((e: Row) => ({ ...e, address_id: addressId })));
    }
    if (data.extraIngredients) {
        set(KEYS.EXTRA_INGREDIENTS, data.extraIngredients.map((i: Row) => ({ ...i })));
    }

    set(KEYS.ORDERS, []);

    // Seed expenses with synthetic refill rows so the playground inherits the default's
    // warehouse stock — fetchLocalIngredientStocks reads Σ refill_qty to compute warehouse.
    // Only the warehouse portion goes here; the counter portion is seeded below as a shift
    // closing, so the kho/quầy split matches the template instead of dumping everything
    // into kho tổng. Each seeded refill has amount=0 (no fake cash impact on P&L) and
    // metadata.seeded=true so it can be filtered out of the Đi chợ tab if we want later.
    const seedTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const seededExpenses = (data.stocks || [])
        .filter((s: Row) => s && s.ingredient && Number(s.warehouse_stock) > 0)
        .map((s: Row) => ({
            id: generateId(),
            name: `Tồn ban đầu: ${s.ingredient}`,
            amount: 0,
            address_id: addressId,
            is_fixed: false,
            is_refill: true,
            payment_method: 'cash',
            staff_name: null,
            metadata: { ingredient: s.ingredient, qty: Number(s.warehouse_stock), totalCost: 0, seeded: true },
            created_at: seedTime
        }));
    set(KEYS.EXPENSES, seededExpenses);

    // Seed a "yesterday" shift closing carrying the counter portion, so counter_stock
    // (quầy) shows up split from warehouse_stock instead of everything landing in kho
    // tổng, and Daily Report / Nhật ký have a real closing to carry forward as opening.
    // restock=0 (no transfer flow to fake); opening=remaining (no sales to fake for a
    // shift that never happened) keeps hao hụt math at 0 instead of a fake negative.
    const seededReport = (data.stocks || [])
        .filter((s: Row) => s && s.ingredient && Number(s.counter_stock) > 0)
        .map((s: Row) => ({ ingredient: s.ingredient, opening: Number(s.counter_stock), restock: 0, remaining: Number(s.counter_stock) }));
    set(KEYS.SHIFT_CLOSINGS, seededReport.length ? [{
        id: generateId(),
        address_id: addressId,
        inventory_report: seededReport,
        actual_cash: 0,
        actual_transfer: 0,
        closed_at: seedTime,
        created_at: seedTime
    }] : []);
    // fixed_costs seed removed — "thực chi" model no longer uses templates.

    // Onboarding widget UI state (collapsed/expanded) is scoped by addressId but lives outside
    // KEYS.* — every other piece of this address's guest data resets fresh above, so a
    // leftover "collapsed" from a previous trial session would hide the guide with nothing
    // in this function's own output explaining why. Clear it so each "Sử dụng thử" starts
    // the guide fresh too.
    localStorage.removeItem(ONBOARDING_STORAGE_PREFIX + addressId);
};

// --- CRUD Helpers ---

export const fetchLocalProducts = (addressId: string | null) => {
    const list = get(KEYS.PRODUCTS).filter(p => p.owner_address_id === addressId && p.is_active);
    list.sort((a, b) => {
        const aSort = a.sort_order ?? 999999;
        const bSort = b.sort_order ?? 999999;
        if (aSort !== bSort) return aSort - bSort;
        return (a.name || '').localeCompare(b.name || '');
    });
    return list;
};
export const insertLocalProduct = (payload: Row) => {
    const products = get(KEYS.PRODUCTS);
    const newProd = { id: generateId(), is_active: true, ...payload, created_at: new Date().toISOString() };
    products.push(newProd);
    set(KEYS.PRODUCTS, products);
    return newProd;
};

export const fetchLocalRecipes = (addressId: string | null) => get(KEYS.RECIPES).filter(r => r.address_id === addressId);
export const upsertLocalRecipe = (payload: Row) => {
    const recipes = get(KEYS.RECIPES);
    const idx = recipes.findIndex(r => r.product_id === payload.product_id && r.ingredient === payload.ingredient && r.address_id === payload.address_id);
    if (idx >= 0) recipes[idx] = { ...recipes[idx], ...payload };
    else recipes.push(payload);
    set(KEYS.RECIPES, recipes);
};

export const fetchLocalIngredientCosts = (addressId: string | null) => {
    const list = get(KEYS.INGREDIENT_COSTS).filter(i => i.address_id === addressId || i.address_id === null);
    return list.map(item => ({
        ingredient: item.ingredient,
        unit: item.unit || 'đv',
        unit_cost: item.unit_cost !== undefined ? item.unit_cost : item.unitCost,
        pack_size: item.pack_size !== undefined ? item.pack_size : item.packSize,
        pack_unit: item.pack_unit !== undefined ? item.pack_unit : item.packUnit,
        min_stock: item.min_stock !== undefined ? item.min_stock : item.minStock,
        category: item.category,
        count_in_audit: item.count_in_audit !== undefined ? item.count_in_audit : (item.countInAudit !== undefined ? item.countInAudit : true),
        tare_weight: item.tare_weight ?? null
    }));
};

export const upsertLocalIngredientCost = (payload: Row) => {
    const items = get(KEYS.INGREDIENT_COSTS);
    const idx = items.findIndex(i => i.ingredient === payload.ingredient && i.address_id === payload.address_id);
    
    const mapped: Row = {
        ingredient: payload.ingredient,
        unit_cost: payload.unit_cost !== undefined ? payload.unit_cost : payload.unitCost,
        address_id: payload.address_id,
    };
    // unit: chỉ ghi khi caller thực sự truyền (vd processIngredientRestock chỉ đổi unit_cost,
    // không truyền unit) — nếu không, key `unit: undefined` tường minh sẽ ghi đè mất unit đã
    // lưu qua spread {...items[idx], ...mapped} bên dưới, rơi về mặc định 'đv'.
    if (payload.unit !== undefined) mapped.unit = payload.unit;

    const packSize = payload.pack_size !== undefined ? payload.pack_size : payload.packSize;
    if (packSize !== undefined) mapped.pack_size = packSize;
    
    const packUnit = payload.pack_unit !== undefined ? payload.pack_unit : payload.packUnit;
    if (packUnit !== undefined) mapped.pack_unit = packUnit;
    
    const minStock = payload.min_stock !== undefined ? payload.min_stock : payload.minStock;
    if (minStock !== undefined) mapped.min_stock = minStock;
    
    if (payload.category !== undefined) mapped.category = payload.category;
    
    const countInAudit = payload.count_in_audit !== undefined ? payload.count_in_audit : payload.countInAudit;
    if (countInAudit !== undefined) mapped.count_in_audit = countInAudit;

    const tareWeight = payload.tare_weight !== undefined ? payload.tare_weight : payload.tareWeight;
    if (tareWeight !== undefined) mapped.tare_weight = tareWeight;

    if (idx >= 0) items[idx] = { ...items[idx], ...mapped };
    else items.push(mapped);
    set(KEYS.INGREDIENT_COSTS, items);
};

export const fetchLocalProductExtras = (addressId: string | null) => {
    const list = get(KEYS.PRODUCT_EXTRAS).filter(e => e.address_id === addressId);
    // Match Supabase path: order by sort_order ASC, nulls last.
    list.sort((a, b) => {
        const aSort = a.sort_order ?? 999999;
        const bSort = b.sort_order ?? 999999;
        if (aSort !== bSort) return aSort - bSort;
        return (a.name || '').localeCompare(b.name || '');
    });
    const map: Record<string, Row[]> = {};
    list.forEach(ex => {
        if (!map[ex.product_id]) map[ex.product_id] = [];
        map[ex.product_id].push({ id: ex.id, name: ex.name, price: ex.price, is_sticky: ex.is_sticky });
    });
    return map;
};

export const fetchLocalExtraIngredients = (extraIds: string[] | null = null) => {
    let list = get(KEYS.EXTRA_INGREDIENTS);
    if (extraIds) {
        list = list.filter(i => extraIds.includes(i.extra_id));
    }
    const map: Record<string, Row[]> = {};
    list.forEach(i => {
        if (!map[i.extra_id]) map[i.extra_id] = [];
        map[i.extra_id].push(i);
    });
    return map;
};

export const submitLocalOrder = (order: Row) => {
    const orders = get(KEYS.ORDERS);
    const newOrder = {
        id: generateId(),
        ...order,
        created_at: order.created_at || new Date().toISOString()
    };
    orders.push(newOrder);
    set(KEYS.ORDERS, orders);
    return newOrder;
};

export const fetchLocalOrders = (addressId: string | null, dateStr: string | null = null): Row[] => {
    let orders = get(KEYS.ORDERS).filter(o => o.address_id === addressId);
    const d = dateStr ? dateStringVN(new Date(dateStr)) : dateStringVN();
    orders = orders.filter(o => dateStringVN(new Date(o.created_at)) === d);
    // Maintain compatibility with both 'items' and 'order_items'
    return orders.map(o => ({ ...o, order_items: o.order_items || o.items }));
};

export const fetchLocalExpenses = (addressId: string | null, dateStr: string | null = null) => {
    let list = get(KEYS.EXPENSES).filter(e => e.address_id === addressId);
    const d = dateStr ? dateStringVN(new Date(dateStr)) : dateStringVN();
    list = list.filter(e => dateStringVN(new Date(e.created_at)) === d);
    return list;
};

// `: Row[]` bắt buộc, không phải trang trí: object spread làm RƠI index signature của Row,
// nên kiểu suy ra là `{ order_items: any }` — mọi field khác (deleted_at, created_at...)
// thành lỗi TS2339 ở phía caller dù runtime vẫn đúng. Cùng lý do cho fetchLocalOrders trên.
export const fetchAllLocalOrders = (addressId: string | null): Row[] => get(KEYS.ORDERS).filter(o => o.address_id === addressId).map(o => ({ ...o, order_items: o.order_items || o.items }));
export const fetchAllLocalExpenses = (addressId: string | null) => get(KEYS.EXPENSES).filter(e => e.address_id === addressId);
export const fetchAllLocalShiftClosings = (addressId: string | null) => get(KEYS.SHIFT_CLOSINGS).filter(s => s.address_id === addressId);

export const insertLocalExpense = (payload: Row) => {
    const list = get(KEYS.EXPENSES);
    // payload.created_at có thể được truyền khi user backdate (RestockModal). Fallback now() khi không có.
    const newItem = { id: generateId(), created_at: new Date().toISOString(), discount_amount: 0, extra_cost: 0, ...payload };
    list.push(newItem);
    set(KEYS.EXPENSES, list);
    return newItem;
};

// expense_payments mirror — same fallback shape as remote table.
export const fetchAllLocalExpensePayments = (addressId: string | null) =>
    get(KEYS.EXPENSE_PAYMENTS).filter(p => p.address_id === addressId);

// Remove every payment linked to an expense (mirrors the DB's ON DELETE CASCADE
// on expense_payments.expense_id, used when cancelling a restock in guest mode).
export const deleteLocalExpensePaymentsByExpense = (expenseId: string) => {
    set(KEYS.EXPENSE_PAYMENTS, get(KEYS.EXPENSE_PAYMENTS).filter(p => p.expense_id !== expenseId));
    return true;
};

export const insertLocalExpensePayment = (payload: Row) => {
    const list = get(KEYS.EXPENSE_PAYMENTS);
    const paidAt = payload.paid_at || new Date().toISOString();
    const newItem = {
        id: generateId(),
        created_at: paidAt,
        paid_at: paidAt,
        ...payload
    };
    list.push(newItem);
    set(KEYS.EXPENSE_PAYMENTS, list);
    return newItem;
};

export const fetchLocalShiftClosing = (addressId: string | null, dateStr: string) => {
    const list = get(KEYS.SHIFT_CLOSINGS);
    const d = dateStringVN(new Date(dateStr));
    return list.find(s => s.address_id === addressId && dateStringVN(new Date(s.created_at)) === d);
};

export const fetchLocalYesterdayShiftClosing = (addressId: string | null) => {
    const list = get(KEYS.SHIFT_CLOSINGS).filter(s => s.address_id === addressId);
    const today = startOfDayVN();

    // Find the latest closing before today
    const past = list
        .filter(s => new Date(s.created_at) < today)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return past[0] || null;
};

export const fetchLocalIngredientStocks = (addressId: string | null) => {
    const expenses = get(KEYS.EXPENSES).filter(e => e.address_id === addressId && e.is_refill);
    const closings = get(KEYS.SHIFT_CLOSINGS).filter(s => s.address_id === addressId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latestClosing = closings[0];

    const ingredients = new Set<string>();
    expenses.forEach(e => { if (e.metadata?.ingredient) ingredients.add(e.metadata.ingredient) });
    if (latestClosing?.inventory_report) {
        latestClosing.inventory_report.forEach((item: Row) => { if (item.ingredient) ingredients.add(item.ingredient) });
    }

    // Walk closings DESC for the most-recent non-null `remaining` per ingredient.
    // null = staff didn't count this ingredient that shift; we carry the previous
    // count forward instead of resetting counter_stock to 0.
    // openingByIngredient: fallback khi NVL CHƯA từng có remaining (tồn quầy nhập lúc
    // setup, trước lần chốt ca đầu tiên) — khớp ingredientStockService + RPC v2.
    const counterByIngredient: Record<string, number> = {};
    const openingByIngredient: Record<string, number> = {};
    closings.forEach(closing => {
        (closing.inventory_report || []).forEach((item: Row) => {
            if (!item?.ingredient) return;
            if (item.remaining != null && counterByIngredient[item.ingredient] === undefined) {
                counterByIngredient[item.ingredient] = Number(item.remaining);
            }
            if (item.opening != null && openingByIngredient[item.ingredient] === undefined) {
                openingByIngredient[item.ingredient] = Number(item.opening);
            }
        });
    });

    return Array.from(ingredients).map(ing => {
        const myRefills = expenses.filter(e => e.metadata?.ingredient === ing);
        // Σ refill
        const totalRefill = myRefills.reduce((sum, e) => sum + (Number(e.metadata?.qty) || 0), 0);

        // Σ restock
        const totalRestock = closings
            .reduce((sum, s) => {
                const item = (s.inventory_report || []).find((i: Row) => i.ingredient === ing);
                return sum + (Number(item?.restock) || 0);
            }, 0);

        // MỐC NEO: phiếu nhập/hiệu chỉnh mới nhất có after_stock = chốt số kho tuyệt đối.
        // Kho = số neo − Σ rút sau neo (chống trôi số). Chưa có → công thức cộng dồn cũ.
        let anchorAfter, anchorAt = -Infinity;
        for (const e of myRefills) {
            if (e.metadata?.cancelled) continue;
            const after = Number(e.metadata?.after_stock);
            const t = new Date(e.created_at).getTime();
            if (Number.isFinite(after) && t > anchorAt) { anchorAt = t; anchorAfter = after; }
        }
        let warehouseRaw;
        if (anchorAfter !== undefined) {
            const restockSinceAnchor = closings.reduce((sum, s) => {
                if (new Date(s.created_at).getTime() <= anchorAt) return sum;
                const item = (s.inventory_report || []).find((i: Row) => i.ingredient === ing);
                return sum + (Number(item?.restock) || 0);
            }, 0);
            warehouseRaw = anchorAfter - restockSinceAnchor;
        } else {
            warehouseRaw = totalRefill - totalRestock;
        }
        const warehouse = Math.max(0, warehouseRaw);
        const item = (latestClosing?.inventory_report || []).find((i: Row) => i.ingredient === ing);
        const counter = counterByIngredient[ing] ?? openingByIngredient[ing] ?? 0;

        return {
            ingredient: ing,
            current_stock: warehouse + counter,
            restocked_qty: Number(item?.restock) || 0,
            warehouse_stock: warehouse,
            counter_stock: counter,
            warehouse_stock_set: warehouse > 0,
            counter_stock_set: counter > 0
        };
    });
};

// Rename (or merge) an ingredient key across the same 4 stores the sync_ingredient_key
// RPC touches: ingredient_costs, recipes, shift_closings.inventory_report, expenses.metadata.
// Always-merge mode: if newKey already exists in ingredient_costs for this address, the
// oldKey cost row is dropped (newKey kept canonical) — mirrors migration 20260519/20260520.
// Scoped by address_id like every other guest helper. Returns the same shape as the RPC.
export const renameLocalIngredient = (addressId: string | null, oldKey: string, newKey: string) => {
    if (!oldKey || !newKey) {
        return { recipes_updated: 0, closings_updated: 0, expenses_updated: 0, costs_action: 'none' };
    }
    if (oldKey === newKey) {
        return { recipes_updated: 0, closings_updated: 0, expenses_updated: 0, costs_action: 'noop' };
    }

    // 1. ingredient_costs — rename or merge
    const costs = get(KEYS.INGREDIENT_COSTS);
    const oldIdx = costs.findIndex(c => c.ingredient === oldKey && c.address_id === addressId);
    const newExists = costs.some(c => c.ingredient === newKey && c.address_id === addressId);
    let costsAction = 'none';
    if (oldIdx >= 0 && newExists) {
        costs.splice(oldIdx, 1);          // merge: drop old, keep newKey as canonical
        costsAction = 'merged';
    } else if (oldIdx >= 0) {
        costs[oldIdx] = { ...costs[oldIdx], ingredient: newKey };
        costsAction = 'renamed';
    }
    set(KEYS.INGREDIENT_COSTS, costs);

    // 2. recipes — straight rename
    const recipes = get(KEYS.RECIPES);
    let recipesUpdated = 0;
    recipes.forEach(r => {
        if (r.address_id === addressId && r.ingredient === oldKey) {
            r.ingredient = newKey;
            recipesUpdated++;
        }
    });
    set(KEYS.RECIPES, recipes);

    // 3. shift_closings.inventory_report (array of { ingredient, remaining, restock, ... })
    const closings = get(KEYS.SHIFT_CLOSINGS);
    let closingsUpdated = 0;
    closings.forEach(sc => {
        if (sc.address_id !== addressId || !Array.isArray(sc.inventory_report)) return;
        let touched = false;
        sc.inventory_report.forEach(elem => {
            if (elem && elem.ingredient === oldKey) { elem.ingredient = newKey; touched = true; }
        });
        if (touched) closingsUpdated++;
    });
    set(KEYS.SHIFT_CLOSINGS, closings);

    // 4. expenses.metadata.ingredient (refill rows reference the ingredient by key)
    const expenses = get(KEYS.EXPENSES);
    let expensesUpdated = 0;
    expenses.forEach(e => {
        if (e.address_id === addressId && e.metadata && e.metadata.ingredient === oldKey) {
            e.metadata = { ...e.metadata, ingredient: newKey };
            expensesUpdated++;
        }
    });
    set(KEYS.EXPENSES, expenses);

    return {
        recipes_updated: recipesUpdated,
        closings_updated: closingsUpdated,
        expenses_updated: expensesUpdated,
        costs_action: costsAction,
    };
};

// Local fixed_costs CRUD removed — see expenseService.js comment.

// --- Expense Categories (tags for the profit report) ---
// Default seed matches the Supabase migration so guest and signed-in users see
// the same starter set. Categories are scoped per address.
const DEFAULT_EXPENSE_CATEGORIES = [
    { name: 'Lương nhân viên',     group_section: 'operating', sort_order: 10 },
    { name: 'Thuê mặt bằng',       group_section: 'operating', sort_order: 20 },
    { name: 'Điện nước',           group_section: 'operating', sort_order: 30 },
    { name: 'Marketing',           group_section: 'operating', sort_order: 40 },
    { name: 'Phần mềm / Hệ thống', group_section: 'operating', sort_order: 50 },
    { name: 'Chi phí khác',        group_section: 'operating', sort_order: 999 },
    { name: 'Lương quản lý',       group_section: 'overhead',  sort_order: 10 },
    { name: 'Khấu hao máy móc',    group_section: 'overhead',  sort_order: 20 },
    { name: 'Chi phí tài chính',   group_section: 'overhead',  sort_order: 30 },
    // Tên nhãn phải duy nhất theo địa chỉ (idx_expense_categories_unique_name) — không
    // lặp "Chi phí khác" sang nhóm khác. Khớp seed server 20260613.
    { name: 'Mua nguyên liệu',     group_section: 'inventory', sort_order: 10 },
    { name: 'Mua bao bì',          group_section: 'inventory', sort_order: 20 },
    { name: 'Rút vốn / cá nhân',   group_section: 'non_operating', sort_order: 10 },
];

const seedLocalExpenseCategoriesIfNeeded = (addressId: string | null) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const hasAny = list.some(c => c.address_id === addressId && c.is_default);
    if (hasAny) return list;
    const seeded = DEFAULT_EXPENSE_CATEGORIES.map(d => ({
        id: generateId(),
        address_id: addressId,
        is_active: true,
        is_default: true,
        created_at: new Date().toISOString(),
        ...d,
    }));
    const next = [...list, ...seeded];
    set(KEYS.EXPENSE_CATEGORIES, next);
    return next;
};

export const fetchLocalExpenseCategories = (addressId: string | null) => {
    const list = seedLocalExpenseCategoriesIfNeeded(addressId);
    return list
        .filter(c => c.address_id === addressId && c.is_active)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
};

export const insertLocalExpenseCategory = (payload: Row) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const newItem = {
        id: generateId(),
        is_active: true,
        is_default: false,
        sort_order: 100,
        created_at: new Date().toISOString(),
        ...payload,
    };
    list.push(newItem);
    set(KEYS.EXPENSE_CATEGORIES, list);
    return newItem;
};

export const updateLocalExpenseCategory = (id: string, updates: Row) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...updates, updated_at: new Date().toISOString() };
        set(KEYS.EXPENSE_CATEGORIES, list);
        return list[idx];
    }
    return null;
};

export const fetchLocalExpensesByCategory = (addressId: string | null, categoryId: string) =>
    get(KEYS.EXPENSES)
        .filter(e => e.address_id === addressId && e.category_id === categoryId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

export const fetchLocalExpenseCategoryCounts = (addressId: string | null) => {
    const counts: Record<string, number> = {};
    for (const e of get(KEYS.EXPENSES)) {
        if (e.address_id === addressId && e.category_id) counts[e.category_id] = (counts[e.category_id] || 0) + 1;
    }
    return counts;
};

export const restoreLocalExpenseCategory = (id: string) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
        list[idx].is_active = true;
        list[idx].updated_at = new Date().toISOString();
        set(KEYS.EXPENSE_CATEGORIES, list);
    }
    return true;
};

export const deleteLocalExpenseCategory = (id: string) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
        list[idx].is_active = false;
        list[idx].updated_at = new Date().toISOString();
        set(KEYS.EXPENSE_CATEGORIES, list);
    }
    return true;
};

export const upsertLocalShiftClosing = (payload: Row) => {
    const list = get(KEYS.SHIFT_CLOSINGS);
    // payload.id (when the caller — e.g. editing a PAST day's closing, or
    // setCounterStock patching the latest closing — already knows which row)
    // targets that exact row. Otherwise fall back to "today's row for this
    // address", the create-or-merge-into-today heuristic the save/merge flows use.
    const dateStr = dateStringVN();
    const idx = payload.id
        ? list.findIndex(s => s.id === payload.id)
        : list.findIndex(s => s.address_id === payload.address_id && dateStringVN(new Date(s.created_at)) === dateStr);
    let saved: Row;
    if (idx >= 0) {
        // closed_at mirrors the real DB column — useShiftInventoryState's "is this
        // row really today" guard reads shift_closing.closed_at, not created_at.
        // Backfill it on rows saved before this field existed so they aren't
        // silently treated as stale on next load.
        saved = { ...list[idx], ...payload, closed_at: list[idx].closed_at || new Date().toISOString() };
        list[idx] = saved;
    } else {
        const now = new Date().toISOString();
        saved = { ...payload, id: payload.id || generateId(), created_at: now, closed_at: now };
        list.push(saved);
    }
    set(KEYS.SHIFT_CLOSINGS, list);
    // Callers (insertShiftClosing/updateShiftClosing/setCounterStock) mirror the
    // Supabase path's `.select().single()` — they need the saved row back, e.g.
    // handleSaveCashflow's `if (!saved) return` treats a missing return as
    // "save was skipped" and silently no-ops (no toast, no error, FAB stays stuck).
    return saved;
};

export const clearGuestData = () => {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    // KEY_GUEST_INGREDIENT_SORT lives outside KEYS, so clear it explicitly — otherwise a
    // stale guest sort order leaks into the next guest session or a real account.
    localStorage.removeItem(KEY_GUEST_INGREDIENT_SORT);
};

// --- Missing Product & Order Helpers ---
export const updateLocalProductPrice = (productId: string, price: number) => {
    const products = get(KEYS.PRODUCTS);
    const p = products.find(p => p.id === productId);
    if (p) { p.price = price; set(KEYS.PRODUCTS, products); }
};

export const updateLocalProductName = (productId: string, name: string) => {
    const products = get(KEYS.PRODUCTS);
    const p = products.find(p => p.id === productId);
    if (p) { p.name = name; set(KEYS.PRODUCTS, products); }
};

export const updateLocalProductCountAsCup = (productId: string, countAsCup: boolean) => {
    const products = get(KEYS.PRODUCTS);
    const p = products.find(p => p.id === productId);
    if (p) { p.count_as_cup = countAsCup; set(KEYS.PRODUCTS, products); }
};

export const updateLocalProductSortOrder = (orderedProductIds: string[]) => {
    const products = get(KEYS.PRODUCTS);
    orderedProductIds.forEach((id: string, index: number) => {
        const p = products.find(p => p.id === id);
        if (p) p.sort_order = index;
    });
    set(KEYS.PRODUCTS, products);
};

// Soft-delete a product (mirror of the remote `is_active = false` write). Lives here so
// callers never reach into localStorage with an out-of-module key constant.
export const deleteLocalProduct = (productId: string) => {
    const products = get(KEYS.PRODUCTS);
    const idx = products.findIndex(p => p.id === productId);
    if (idx >= 0) {
        products[idx].is_active = false;
        set(KEYS.PRODUCTS, products);
    }
    return true;
};

export const updateLocalExpense = (id: string, updates: Row) => {
    const list = get(KEYS.EXPENSES);
    const idx = list.findIndex(e => e.id === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...updates, updated_at: new Date().toISOString() };
        set(KEYS.EXPENSES, list);
        return list[idx];
    }
    return null;
};

export const deleteLocalExpense = (expenseId: string) => {
    let expenses = get(KEYS.EXPENSES);
    expenses = expenses.filter(e => e.id !== expenseId);
    set(KEYS.EXPENSES, expenses);
    return true;
};

export const deleteLocalOrder = (orderId: string, staffName: string | null) => {
    const orders = get(KEYS.ORDERS);
    const o = orders.find(o => o.id === orderId);
    if (o) {
        o.deleted_at = new Date().toISOString();
        o.deleted_by = staffName;
        set(KEYS.ORDERS, orders);
    }
    return true;
};

export const updateLocalOrderDiscount = (orderId: string, total: number, discountAmount: number, itemDiscounts: { id: string, discount_amount: number }[] = []) => {
    const orders = get(KEYS.ORDERS);
    const o = orders.find(o => o.id === orderId);
    if (o) {
        o.total = total;
        o.discount_amount = discountAmount;
        for (const { id, discount_amount } of itemDiscounts) {
            const item = (o.order_items || o.items || []).find((it: Row) => it.id === id);
            if (item) item.discount_amount = discount_amount;
        }
        set(KEYS.ORDERS, orders);
    }
    return true;
};

export const deleteLocalRecipeRow = (productId: string, ingredient: string) => {
    let recipes = get(KEYS.RECIPES);
    recipes = recipes.filter(r => !(r.product_id === productId && r.ingredient === ingredient));
    set(KEYS.RECIPES, recipes);
};

export const deleteLocalIngredientCost = (ingredient: string) => {
    let costs = get(KEYS.INGREDIENT_COSTS);
    costs = costs.filter(c => c.ingredient !== ingredient);
    set(KEYS.INGREDIENT_COSTS, costs);
};

// --- Missing Extras Helpers ---
export const insertLocalProductExtra = (payload: Row) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const maxSort = extras.filter(e => e.product_id === payload.product_id).reduce((max: number, e) => Math.max(max, e.sort_order || -1), -1);
    const newExtra = { id: generateId(), sort_order: maxSort + 1, is_sticky: false, ...payload };
    extras.push(newExtra);
    set(KEYS.PRODUCT_EXTRAS, extras);
    return newExtra;
};

export const updateLocalProductExtraName = (extraId: string, name: string) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const e = extras.find(e => e.id === extraId);
    if (e) { e.name = name; set(KEYS.PRODUCT_EXTRAS, extras); }
};

export const updateLocalProductExtraPrice = (extraId: string, price: number) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const e = extras.find(e => e.id === extraId);
    if (e) { e.price = price; set(KEYS.PRODUCT_EXTRAS, extras); }
};

export const updateLocalProductExtraSticky = (extraId: string, isSticky: boolean) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const e = extras.find(e => e.id === extraId);
    if (e) { e.is_sticky = isSticky; set(KEYS.PRODUCT_EXTRAS, extras); }
};

export const updateLocalExtrasSortOrder = (orderedExtraIds: string[]) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    orderedExtraIds.forEach((id: string, index: number) => {
        const e = extras.find(e => e.id === id);
        if (e) e.sort_order = index;
    });
    set(KEYS.PRODUCT_EXTRAS, extras);
};

export const duplicateLocalProductExtra = (extraId: string, newName: string, addressId: string | null) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const src = extras.find(e => e.id === extraId);
    if (!src) return null;
    
    const maxSort = extras.filter(e => e.product_id === src.product_id).reduce((max: number, e) => Math.max(max, e.sort_order || -1), -1);
    const newExtra = { id: generateId(), product_id: src.product_id, name: newName, price: src.price, address_id: addressId, sort_order: maxSort + 1, is_sticky: false };
    extras.push(newExtra);
    set(KEYS.PRODUCT_EXTRAS, extras);

    const extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    const srcIngs = extraIngs.filter(i => i.extra_id === extraId);
    srcIngs.forEach(i => {
        extraIngs.push({ ...i, id: generateId(), extra_id: newExtra.id });
    });
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);

    return newExtra;
};

export const deleteLocalProductExtra = (extraId: string) => {
    let extras = get(KEYS.PRODUCT_EXTRAS);
    extras = extras.filter(e => e.id !== extraId);
    set(KEYS.PRODUCT_EXTRAS, extras);
    
    let extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    extraIngs = extraIngs.filter(i => i.extra_id !== extraId);
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);
    return true;
};

export const upsertLocalExtraIngredient = (payload: Row) => {
    const extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    const idx = extraIngs.findIndex(i => i.extra_id === payload.extra_id && i.ingredient === payload.ingredient);
    if (idx >= 0) {
        extraIngs[idx] = { ...extraIngs[idx], ...payload };
    } else {
        extraIngs.push({ id: generateId(), ...payload });
    }
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);
};

export const deleteLocalExtraIngredient = (extraId: string, ingredient: string) => {
    let extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    extraIngs = extraIngs.filter(i => !(i.extra_id === extraId && i.ingredient === ingredient));
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);
    return true;
};

// --- Toppings (thực thể toàn cục, gắn nhiều món qua PRODUCT_TOPPINGS) ---

export const fetchLocalToppings = (addressId: string | null) => {
    const list = get(KEYS.TOPPINGS).filter(t => t.address_id === addressId);
    list.sort((a, b) => {
        const aSort = a.sort_order ?? 999999;
        const bSort = b.sort_order ?? 999999;
        if (aSort !== bSort) return aSort - bSort;
        return (a.name || '').localeCompare(b.name || '');
    });
    return list;
};

export const insertLocalTopping = (payload: Row) => {
    const toppings = get(KEYS.TOPPINGS);
    const maxSort = toppings.filter(t => t.address_id === payload.address_id).reduce((max: number, t) => Math.max(max, t.sort_order || -1), -1);
    const newTopping = { id: generateId(), sort_order: maxSort + 1, ...payload };
    toppings.push(newTopping);
    set(KEYS.TOPPINGS, toppings);
    return newTopping;
};

export const updateLocalToppingName = (toppingId: string, name: string) => {
    const toppings = get(KEYS.TOPPINGS);
    const t = toppings.find(t => t.id === toppingId);
    if (t) { t.name = name; set(KEYS.TOPPINGS, toppings); }
};

export const updateLocalToppingPrice = (toppingId: string, price: number) => {
    const toppings = get(KEYS.TOPPINGS);
    const t = toppings.find(t => t.id === toppingId);
    if (t) { t.price = price; set(KEYS.TOPPINGS, toppings); }
};

export const deleteLocalTopping = (toppingId: string) => {
    let toppings = get(KEYS.TOPPINGS);
    toppings = toppings.filter(t => t.id !== toppingId);
    set(KEYS.TOPPINGS, toppings);

    let toppingIngs = get(KEYS.TOPPING_INGREDIENTS);
    toppingIngs = toppingIngs.filter(i => i.topping_id !== toppingId);
    set(KEYS.TOPPING_INGREDIENTS, toppingIngs);

    let links = get(KEYS.PRODUCT_TOPPINGS);
    links = links.filter(l => l.topping_id !== toppingId);
    set(KEYS.PRODUCT_TOPPINGS, links);
    return true;
};

export const fetchLocalToppingIngredients = (toppingIds: string[] | null = null) => {
    let list = get(KEYS.TOPPING_INGREDIENTS);
    if (toppingIds) list = list.filter(i => toppingIds.includes(i.topping_id));
    const map: Record<string, Row[]> = {};
    for (const row of list) {
        if (!map[row.topping_id]) map[row.topping_id] = [];
        map[row.topping_id].push(row);
    }
    return map;
};

export const upsertLocalToppingIngredient = (payload: Row) => {
    const toppingIngs = get(KEYS.TOPPING_INGREDIENTS);
    const idx = toppingIngs.findIndex(i => i.topping_id === payload.topping_id && i.ingredient === payload.ingredient);
    if (idx >= 0) {
        toppingIngs[idx] = { ...toppingIngs[idx], ...payload };
    } else {
        toppingIngs.push({ id: generateId(), ...payload });
    }
    set(KEYS.TOPPING_INGREDIENTS, toppingIngs);
};

export const deleteLocalToppingIngredient = (toppingId: string, ingredient: string) => {
    let toppingIngs = get(KEYS.TOPPING_INGREDIENTS);
    toppingIngs = toppingIngs.filter(i => !(i.topping_id === toppingId && i.ingredient === ingredient));
    set(KEYS.TOPPING_INGREDIENTS, toppingIngs);
    return true;
};

export const fetchLocalProductToppingLinks = (toppingIds: string[]) => {
    const links = get(KEYS.PRODUCT_TOPPINGS);
    return links.filter(l => toppingIds.includes(l.topping_id));
};

export const setLocalToppingProductLinks = (toppingId: string, productIds: string[]) => {
    let links = get(KEYS.PRODUCT_TOPPINGS);
    links = links.filter(l => l.topping_id !== toppingId);
    for (const productId of productIds) {
        links.push({ id: generateId(), product_id: productId, topping_id: toppingId });
    }
    set(KEYS.PRODUCT_TOPPINGS, links);
};

// --- Discount programs (thực thể toàn cục theo địa chỉ, gắn nhiều món qua
// DISCOUNT_PROGRAM_PRODUCTS) — mirrors Toppings ở trên. ---

export const fetchLocalDiscountPrograms = (addressId: string | null) => {
    const programs = get(KEYS.DISCOUNT_PROGRAMS);
    return programs.filter(p => p.address_id === addressId);
};

export const insertLocalDiscountProgram = (payload: Row) => {
    const programs = get(KEYS.DISCOUNT_PROGRAMS);
    const newProgram = { id: generateId(), days_of_week: [], start_date: null, end_date: null, enabled: false, ...payload };
    programs.push(newProgram);
    set(KEYS.DISCOUNT_PROGRAMS, programs);
    return newProgram;
};

export const updateLocalDiscountProgram = (programId: string, patch: Row) => {
    const programs = get(KEYS.DISCOUNT_PROGRAMS);
    const p = programs.find(p => p.id === programId);
    if (p) { Object.assign(p, patch); set(KEYS.DISCOUNT_PROGRAMS, programs); }
};

export const deleteLocalDiscountProgram = (programId: string) => {
    let programs = get(KEYS.DISCOUNT_PROGRAMS);
    programs = programs.filter(p => p.id !== programId);
    set(KEYS.DISCOUNT_PROGRAMS, programs);

    let links = get(KEYS.DISCOUNT_PROGRAM_PRODUCTS);
    links = links.filter(l => l.discount_program_id !== programId);
    set(KEYS.DISCOUNT_PROGRAM_PRODUCTS, links);
    return true;
};

export const fetchLocalDiscountProgramProductLinks = (programIds: string[]) => {
    const links = get(KEYS.DISCOUNT_PROGRAM_PRODUCTS);
    return links.filter(l => programIds.includes(l.discount_program_id));
};

export const setLocalDiscountProgramProducts = (programId: string, productIds: string[]) => {
    let links = get(KEYS.DISCOUNT_PROGRAM_PRODUCTS);
    links = links.filter(l => l.discount_program_id !== programId);
    for (const productId of productIds) {
        links.push({ id: generateId(), product_id: productId, discount_program_id: programId });
    }
    set(KEYS.DISCOUNT_PROGRAM_PRODUCTS, links);
};
