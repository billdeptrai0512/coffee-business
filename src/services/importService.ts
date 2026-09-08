import * as XLSX from 'xlsx'
import { normalizeIngredientKey } from '../utils/ingredients'
import { insertProduct, upsertProductPrice, insertProductExtra, updateProductExtraPrice, updateProductExtraSticky, upsertExtraIngredient } from './productService'
import { upsertIngredientCost } from './ingredientCostService'
import { insertTopping, updateToppingPrice, upsertToppingIngredient, setToppingProductLinks } from './toppingService'
import { upsertRecipes } from './recipeService'
import type { UUID } from '../types/domain'

// Nhập liệu hàng loạt từ 1 file Excel (.xlsx) do CHÚNG TA thiết kế layout — khách chỉ điền
// theo mẫu (public/templates/mau-nhap-lieu.xlsx), nên không cần lo parse format tuỳ ý.
// 2 hàm tách bạch: resolveImportPlan (thuần, không gọi mạng — dùng cho màn xem trước) và
// commitImportPlan (gọi service layer có sẵn theo đúng thứ tự phụ thuộc FK).

export interface ParsedWorkbook {
    products: Record<string, unknown>[]
    ingredients: Record<string, unknown>[]
    recipes: Record<string, unknown>[]
    toppings: Record<string, unknown>[]
    toppingIngredients: Record<string, unknown>[]
    toppingLinks: Record<string, unknown>[]
    extras: Record<string, unknown>[]
    extraIngredients: Record<string, unknown>[]
}

export function parseWorkbook(arrayBuffer: ArrayBuffer): ParsedWorkbook {
    const wb = XLSX.read(arrayBuffer, { type: 'array' })
    const sheet = (name: string) => {
        const ws = wb.Sheets[name]
        return ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }) : []
    }
    return {
        products: sheet('Sản phẩm'),
        ingredients: sheet('Nguyên liệu'),
        recipes: sheet('Công thức'),
        toppings: sheet('Topping'),
        toppingIngredients: sheet('Công thức Topping'),
        toppingLinks: sheet('Topping áp dụng món'),
        extras: sheet('Tùy chọn thêm'),
        extraIngredients: sheet('Công thức tùy chọn'),
    }
}

function normName(v: unknown): string {
    return String(v ?? '').trim()
}

// Key dùng để so khớp/gộp tên (Set/Map) xuyên suốt file này — KHÔNG dùng cho giá trị hiển thị.
// .normalize('NFC') vì Excel/macOS đôi khi lưu tên có dấu ở dạng tổ hợp (NFD, "a" + dấu rời)
// trong khi dữ liệu đã có trong DB (gõ qua trình duyệt) thường là NFC — thiếu bước này, 2 tên
// NHÌN GIỐNG HỆT NHAU trên Excel/UI sẽ bị coi là khác nhau và tạo trùng thay vì cập nhật/khớp.
function normKey(v: unknown): string {
    return normName(v).normalize('NFC').toLowerCase()
}

function toNumber(v: unknown): number | null {
    if (v === '' || v == null) return null
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

function toBool(v: unknown): boolean {
    const s = normKey(v)
    return s === 'có' || s === 'x' || s === 'true' || s === '1'
}

// Loại chỉ có 2 giá trị thật (main/packaging) — 'tools' là giá trị legacy, không cho import
// tạo ra (mirror normalizeIngredientCategory ở src/utils/ingredients.js).
function mapCategory(raw: unknown): 'main' | 'packaging' {
    const v = normKey(raw)
    if (v.includes('bao bì') || v.includes('đóng gói') || v === 'packaging' || v === 'tools') return 'packaging'
    return 'main'
}

export interface ImportPlan {
    products: Array<{ name: string; price: number }>
    productUpdates: Array<{ name: string; price: number }>
    ingredients: Array<{ key: string; unitCost: number; unit: string; category: 'main' | 'packaging' }>
    ingredientUpdates: Array<{ key: string; unitCost: number; unit: string; category: 'main' | 'packaging' }>
    toppings: Array<{ name: string; price: number; unit: string }>
    toppingUpdates: Array<{ name: string; price: number }>
    recipes: Array<{ productName: string; ingredient: string; amount: number; unit: string | null }>
    toppingIngredients: Array<{ toppingName: string; ingredient: string; amount: number; unit: string | null }>
    toppingLinks: Array<{ toppingName: string; productNames: string[] }>
    extras: Array<{ productName: string; name: string; price: number; sticky: boolean }>
    extraUpdates: Array<{ productName: string; name: string; price: number; sticky: boolean }>
    extraIngredients: Array<{ productName: string; extraName: string; ingredient: string; amount: number; unit: string | null }>
}

interface ExistingData {
    products: Array<{ id: UUID; name: string }>
    toppings: Array<{ id: UUID; name: string }>
    ingredientCosts: Record<string, unknown>
    extras: Array<{ id: UUID; productName: string; name: string }>
}

export interface ResolveResult {
    plan: ImportPlan
    blockingErrors: string[]
    warnings: string[]
}

// Thuần — không gọi mạng, dùng cho màn xem trước. Khớp tên case-insensitive với dữ liệu
// ĐÃ CÓ (products/toppings truyền vào) — sản phẩm/topping sẽ được tạo trong CÙNG lần import
// này (VD dòng ở sheet Công thức trỏ tới 1 tên nằm trong sheet Sản phẩm) cũng tính là "sẽ có".
export function resolveImportPlan(parsed: ParsedWorkbook, existing: ExistingData): ResolveResult {
    const blockingErrors: string[] = []
    const warnings: string[] = []

    const existingProductNames = new Set(existing.products.map(p => normKey(p.name)))
    const existingToppingNames = new Set(existing.toppings.map(t => normKey(t.name)))
    const existingIngredientKeys = new Set(Object.keys(existing.ingredientCosts))

    // true nếu name có trong set; ngược lại tự đẩy cảnh báo "bỏ qua" và trả false.
    const requireName = (set: Set<string>, name: string, label: string, sheetName: string, line: string) => {
        if (set.has(normKey(name))) return true
        warnings.push(`Bỏ qua ${line}: không tìm thấy ${label} "${name}" (kiểm tra sheet ${sheetName})`)
        return false
    }

    // ---- Sản phẩm ---- (trùng tên → cập nhật giá, không tạo trùng)
    const products: ImportPlan['products'] = []
    const productUpdates: ImportPlan['productUpdates'] = []
    const seenProductNames = new Set<string>()
    const allProductNames = new Set(existingProductNames) // existing ∪ sẽ-tạo, dùng để resolve Công thức/Topping áp dụng món
    parsed.products.forEach((row, i) => {
        const name = normName(row['Tên món'])
        const price = toNumber(row['Giá bán'])
        const line = `Sản phẩm dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (price == null) { blockingErrors.push(`${line} ("${name}"): Giá bán không hợp lệ`); return }
        const key = normKey(name)
        if (seenProductNames.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Sản phẩm`); return }
        seenProductNames.add(key)
        allProductNames.add(key)
        if (existingProductNames.has(key)) productUpdates.push({ name, price })
        else products.push({ name, price })
    })

    // ---- Nguyên liệu ---- (trùng tên → cập nhật giá vốn + đơn vị)
    const ingredients: ImportPlan['ingredients'] = []
    const ingredientUpdates: ImportPlan['ingredientUpdates'] = []
    const seenIngredientKeys = new Set<string>()
    const allIngredientKeys = new Set(existingIngredientKeys) // existing ∪ sẽ-tạo (kể cả tự phát hiện từ công thức, thêm bên dưới)
    parsed.ingredients.forEach((row, i) => {
        const name = normName(row['Tên nguyên liệu'])
        const line = `Nguyên liệu dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        const key = normalizeIngredientKey(name)
        if (seenIngredientKeys.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Nguyên liệu`); return }
        seenIngredientKeys.add(key)
        const costRaw = row['Giá vốn/đơn vị']
        const cost = costRaw === '' || costRaw == null ? 0 : toNumber(costRaw)
        if (cost == null) { blockingErrors.push(`${line} ("${name}"): Giá vốn/đơn vị không hợp lệ`); return }
        const entry = { key, unitCost: cost, unit: normName(row['Đơn vị']) || 'đv', category: mapCategory(row['Loại']) }
        allIngredientKeys.add(key)
        if (existingIngredientKeys.has(key)) ingredientUpdates.push(entry)
        else ingredients.push(entry)
    })

    // ---- Topping ---- (trùng tên → cập nhật giá bán; đơn vị tồn kho của topping đã có giữ nguyên)
    const toppings: ImportPlan['toppings'] = []
    const toppingUpdates: ImportPlan['toppingUpdates'] = []
    const seenToppingNames = new Set<string>()
    const allToppingNames = new Set(existingToppingNames)
    parsed.toppings.forEach((row, i) => {
        const name = normName(row['Tên topping'])
        const price = toNumber(row['Giá bán'])
        const line = `Topping dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên topping`); return }
        if (price == null) { blockingErrors.push(`${line} ("${name}"): Giá bán không hợp lệ`); return }
        const key = normKey(name)
        if (seenToppingNames.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Topping`); return }
        seenToppingNames.add(key)
        allToppingNames.add(key)
        if (existingToppingNames.has(key)) toppingUpdates.push({ name, price })
        else toppings.push({ name, price, unit: normName(row['Đơn vị tồn kho']) || 'đv' })
    })

    // ---- Tùy chọn thêm ---- (trùng món+tên tùy chọn → cập nhật giá + cờ tự động chọn)
    const extras: ImportPlan['extras'] = []
    const extraUpdates: ImportPlan['extraUpdates'] = []
    const seenExtraKeys = new Set<string>()
    const existingExtraKeys = new Set(existing.extras.map(e => `${normKey(e.productName)}|${normKey(e.name)}`))
    const allExtraKeys = new Set(existingExtraKeys) // existing ∪ sẽ-tạo, dùng để resolve Công thức tùy chọn
    parsed.extras.forEach((row, i) => {
        const productName = normName(row['Tên món'])
        const name = normName(row['Tên tùy chọn'])
        const price = toNumber(row['Giá'])
        const line = `Tùy chọn thêm dòng ${i + 2}`
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!name) { blockingErrors.push(`${line}: thiếu Tên tùy chọn`); return }
        if (price == null) { blockingErrors.push(`${line} ("${productName}" / "${name}"): Giá không hợp lệ`); return }
        if (!requireName(allProductNames, productName, 'món', 'Sản phẩm', line)) return
        const key = `${normKey(productName)}|${normKey(name)}`
        if (seenExtraKeys.has(key)) { blockingErrors.push(`${line}: tùy chọn "${name}" bị lặp cho món "${productName}" trong sheet Tùy chọn thêm`); return }
        seenExtraKeys.add(key)
        allExtraKeys.add(key)
        const sticky = toBool(row['Tự động chọn'])
        if (existingExtraKeys.has(key)) extraUpdates.push({ productName, name, price, sticky })
        else extras.push({ productName, name, price, sticky })
    })

    // Nguyên liệu chỉ nhắc tới trong Công thức/Công thức Topping (chưa có dòng riêng ở sheet
    // Nguyên liệu) → tự đăng ký placeholder giá vốn 0, cùng nguyên tắc registerNewIngredients —
    // đơn vị lấy từ chính dòng gặp đầu tiên (không hardcode 'đv'), vì màn chi tiết công thức/
    // topping hiển thị ĐƠN VỊ GỐC của nguyên liệu (ingredient_costs.unit), không phải cột Đơn
    // vị riêng của từng dòng recipes/topping_ingredients.
    function ensureIngredientKey(name: string, unit: string) {
        const key = normalizeIngredientKey(name)
        if (!allIngredientKeys.has(key)) {
            allIngredientKeys.add(key)
            ingredients.push({ key, unitCost: 0, unit: unit || 'đv', category: 'main' })
        }
        return key
    }

    // ---- Công thức ----
    const recipes: ImportPlan['recipes'] = []
    parsed.recipes.forEach((row, i) => {
        const productName = normName(row['Tên món'])
        const ingredientName = normName(row['Tên nguyên liệu'])
        const amount = toNumber(row['Số lượng'])
        const line = `Công thức dòng ${i + 2}`
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!ingredientName) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        if (amount == null) { blockingErrors.push(`${line} ("${productName}" / "${ingredientName}"): Số lượng không hợp lệ`); return }
        if (!requireName(allProductNames, productName, 'món', 'Sản phẩm', line)) return
        const unit = normName(row['Đơn vị'])
        recipes.push({ productName, ingredient: ensureIngredientKey(ingredientName, unit), amount, unit: unit || null })
    })

    // ---- Công thức Topping ----
    const toppingIngredients: ImportPlan['toppingIngredients'] = []
    parsed.toppingIngredients.forEach((row, i) => {
        const toppingName = normName(row['Tên topping'])
        const ingredientName = normName(row['Tên nguyên liệu'])
        const amount = toNumber(row['Số lượng'])
        const line = `Công thức Topping dòng ${i + 2}`
        if (!toppingName) { blockingErrors.push(`${line}: thiếu Tên topping`); return }
        if (!ingredientName) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        if (amount == null) { blockingErrors.push(`${line} ("${toppingName}" / "${ingredientName}"): Số lượng không hợp lệ`); return }
        if (!requireName(allToppingNames, toppingName, 'topping', 'Topping', line)) return
        const unit = normName(row['Đơn vị'])
        toppingIngredients.push({ toppingName, ingredient: ensureIngredientKey(ingredientName, unit), amount, unit: unit || null })
    })

    // ---- Công thức tùy chọn ----
    const extraIngredientsPlan: ImportPlan['extraIngredients'] = []
    parsed.extraIngredients.forEach((row, i) => {
        const productName = normName(row['Tên món'])
        const extraName = normName(row['Tên tùy chọn'])
        const ingredientName = normName(row['Tên nguyên liệu'])
        const amount = toNumber(row['Số lượng'])
        const line = `Công thức tùy chọn dòng ${i + 2}`
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!extraName) { blockingErrors.push(`${line}: thiếu Tên tùy chọn`); return }
        if (!ingredientName) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        if (amount == null) { blockingErrors.push(`${line} ("${productName}" / "${extraName}" / "${ingredientName}"): Số lượng không hợp lệ`); return }
        const extraKey = `${normKey(productName)}|${normKey(extraName)}`
        if (!allExtraKeys.has(extraKey)) {
            warnings.push(`Bỏ qua ${line}: không tìm thấy tùy chọn "${extraName}" của món "${productName}" (kiểm tra sheet Tùy chọn thêm)`)
            return
        }
        const unit = normName(row['Đơn vị'])
        extraIngredientsPlan.push({ productName, extraName, ingredient: ensureIngredientKey(ingredientName, unit), amount, unit: unit || null })
    })

    // ---- Topping áp dụng món ---- (gom theo topping — 1 dòng = 1 liên kết)
    const linksByTopping = new Map<string, { toppingName: string; productNames: string[] }>()
    parsed.toppingLinks.forEach((row, i) => {
        const toppingName = normName(row['Tên topping'])
        const productName = normName(row['Tên món'])
        const line = `Topping áp dụng món dòng ${i + 2}`
        if (!toppingName) { blockingErrors.push(`${line}: thiếu Tên topping`); return }
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!requireName(allToppingNames, toppingName, 'topping', 'Topping', line)) return
        if (!requireName(allProductNames, productName, 'món', 'Sản phẩm', line)) return
        const key = normKey(toppingName)
        if (!linksByTopping.has(key)) linksByTopping.set(key, { toppingName, productNames: [] })
        linksByTopping.get(key)!.productNames.push(productName)
    })

    return {
        plan: {
            products, productUpdates,
            ingredients, ingredientUpdates,
            toppings, toppingUpdates,
            recipes, toppingIngredients,
            toppingLinks: [...linksByTopping.values()],
            extras, extraUpdates,
            extraIngredients: extraIngredientsPlan,
        },
        blockingErrors,
        warnings,
    }
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
    let i = 0
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) await fn(items[i++])
    }))
}

const CONCURRENCY = 8

// Chạy đúng thứ tự phụ thuộc FK: Sản phẩm → Nguyên liệu → Topping → Tùy chọn thêm → Công thức
// (1 lệnh batch duy nhất) → Công thức Topping → Công thức tùy chọn → Topping áp dụng món. Chỉ
// dùng service function có sẵn, KHÔNG viết logic ghi DB mới — mỗi hàm đã tự lo cả Supabase lẫn
// guest/local mode. Sheet trùng tên (Sản phẩm/Nguyên liệu/Topping/Tùy chọn thêm) đi theo nhánh
// update riêng — cùng map tên→id với nhánh tạo mới nên bước sau (Công thức...) không cần biết
// dòng nào mới/cũ. Mọi so khớp tên dùng chung normKey (NFC + lowercase) với resolveImportPlan.
export async function commitImportPlan(plan: ImportPlan, addressId: UUID | null, existing: ExistingData) {
    const productByName = new Map(existing.products.map(p => [normKey(p.name), p.id]))
    const toppingByName = new Map(existing.toppings.map(t => [normKey(t.name), t.id]))

    await runWithConcurrency(plan.products, CONCURRENCY, async (p) => {
        // insertProduct is untyped JS (checkJs:false) — TS infers its addressId param
        // from the bare `= null` default, not the real UUID|null; cast at this interop edge.
        const row = await insertProduct(p.name, p.price, addressId as any)
        productByName.set(normKey(p.name), row.id)
    })
    await runWithConcurrency(plan.productUpdates, CONCURRENCY, async (p) => {
        await upsertProductPrice(productByName.get(normKey(p.name)), addressId, p.price)
    })

    await runWithConcurrency([...plan.ingredients, ...plan.ingredientUpdates], CONCURRENCY, async (ing) => {
        await upsertIngredientCost(ing.key, ing.unitCost, addressId, ing.unit, { category: ing.category })
    })

    await runWithConcurrency(plan.toppings, CONCURRENCY, async (t) => {
        const row = await insertTopping(t.name, t.price, addressId, t.unit)
        toppingByName.set(normKey(t.name), row.id)
    })
    await runWithConcurrency(plan.toppingUpdates, CONCURRENCY, async (t) => {
        await updateToppingPrice(toppingByName.get(normKey(t.name))!, t.price)
    })

    // key = `${productId}|${normKey(tên tùy chọn)}` — dùng chung cho extras/extraUpdates/
    // extraIngredients bên dưới, seed từ dữ liệu đã có trước khi tạo/sửa thêm.
    const extraByKey = new Map<string, UUID>()
    for (const ex of existing.extras) {
        const productId = productByName.get(normKey(ex.productName))
        if (productId) extraByKey.set(`${productId}|${normKey(ex.name)}`, ex.id)
    }
    await runWithConcurrency(plan.extras, CONCURRENCY, async (ex) => {
        const productId = productByName.get(normKey(ex.productName))
        // insertProductExtra is untyped JS (checkJs:false) — same interop cast as insertProduct above.
        const row = await insertProductExtra(productId, ex.name, ex.price, addressId as any)
        extraByKey.set(`${productId}|${normKey(ex.name)}`, row.id)
        if (ex.sticky) await updateProductExtraSticky(row.id, true)
    })
    await runWithConcurrency(plan.extraUpdates, CONCURRENCY, async (ex) => {
        const productId = productByName.get(normKey(ex.productName))
        const extraId = extraByKey.get(`${productId}|${normKey(ex.name)}`)
        await updateProductExtraPrice(extraId, ex.price)
        await updateProductExtraSticky(extraId, ex.sticky)
    })

    if (plan.recipes.length > 0) {
        await upsertRecipes(plan.recipes.map(r => ({
            productId: productByName.get(normKey(r.productName))!,
            ingredient: r.ingredient,
            amount: r.amount,
            addressId,
            unit: r.unit,
        })))
    }

    await runWithConcurrency(plan.toppingIngredients, CONCURRENCY, async (ti) => {
        const toppingId = toppingByName.get(normKey(ti.toppingName))!
        await upsertToppingIngredient(toppingId, ti.ingredient, ti.amount, ti.unit)
    })

    await runWithConcurrency(plan.extraIngredients, CONCURRENCY, async (ei) => {
        const productId = productByName.get(normKey(ei.productName))
        const extraId = extraByKey.get(`${productId}|${normKey(ei.extraName)}`)
        // upsertExtraIngredient is untyped JS (checkJs:false) — same interop cast as insertProduct above.
        await upsertExtraIngredient(extraId, ei.ingredient, ei.amount, ei.unit as any)
    })

    await runWithConcurrency(plan.toppingLinks, CONCURRENCY, async (link) => {
        const toppingId = toppingByName.get(normKey(link.toppingName))!
        const productIds = link.productNames.map(n => productByName.get(normKey(n))!)
        await setToppingProductLinks(toppingId, productIds)
    })
}
