import * as XLSX from 'xlsx'
import { normalizeIngredientKey } from '../utils/ingredients'
import { insertProduct } from './productService'
import { upsertIngredientCost } from './ingredientCostService'
import { insertTopping, upsertToppingIngredient, setToppingProductLinks } from './toppingService'
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
    }
}

function normName(v: unknown): string {
    return String(v ?? '').trim()
}

function toNumber(v: unknown): number | null {
    if (v === '' || v == null) return null
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

// Loại chỉ có 2 giá trị thật (main/packaging) — 'tools' là giá trị legacy, không cho import
// tạo ra (mirror normalizeIngredientCategory ở src/utils/ingredients.js).
function mapCategory(raw: unknown): 'main' | 'packaging' {
    const v = normName(raw).toLowerCase()
    if (v.includes('bao bì') || v.includes('đóng gói') || v === 'packaging' || v === 'tools') return 'packaging'
    return 'main'
}

export interface ImportPlan {
    products: Array<{ name: string; price: number }>
    ingredients: Array<{ key: string; unitCost: number; unit: string; category: 'main' | 'packaging' }>
    toppings: Array<{ name: string; price: number; unit: string }>
    recipes: Array<{ productName: string; ingredient: string; amount: number; unit: string | null }>
    toppingIngredients: Array<{ toppingName: string; ingredient: string; amount: number; unit: string | null }>
    toppingLinks: Array<{ toppingName: string; productNames: string[] }>
}

interface ExistingData {
    products: Array<{ id: UUID; name: string }>
    toppings: Array<{ id: UUID; name: string }>
    ingredientCosts: Record<string, unknown>
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

    const existingProductNames = new Set(existing.products.map(p => p.name.trim().toLowerCase()))
    const existingToppingNames = new Set(existing.toppings.map(t => t.name.trim().toLowerCase()))
    const existingIngredientKeys = new Set(Object.keys(existing.ingredientCosts))

    // true nếu name có trong set; ngược lại tự đẩy cảnh báo "bỏ qua" và trả false.
    const requireName = (set: Set<string>, name: string, label: string, sheetName: string, line: string) => {
        if (set.has(name.toLowerCase())) return true
        warnings.push(`Bỏ qua ${line}: không tìm thấy ${label} "${name}" (kiểm tra sheet ${sheetName})`)
        return false
    }

    // ---- Sản phẩm ----
    const products: ImportPlan['products'] = []
    const seenProductNames = new Set<string>()
    const allProductNames = new Set(existingProductNames) // existing ∪ sẽ-tạo, dùng để resolve Công thức/Topping áp dụng món
    parsed.products.forEach((row, i) => {
        const name = normName(row['Tên món'])
        const price = toNumber(row['Giá bán'])
        const line = `Sản phẩm dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (price == null) { blockingErrors.push(`${line} ("${name}"): Giá bán không hợp lệ`); return }
        const key = name.toLowerCase()
        if (seenProductNames.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Sản phẩm`); return }
        seenProductNames.add(key)
        allProductNames.add(key)
        if (!existingProductNames.has(key)) products.push({ name, price })
    })

    // ---- Nguyên liệu ----
    const ingredients: ImportPlan['ingredients'] = []
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
        allIngredientKeys.add(key)
        if (!existingIngredientKeys.has(key)) {
            ingredients.push({ key, unitCost: cost, unit: normName(row['Đơn vị']) || 'đv', category: mapCategory(row['Loại']) })
        }
    })

    // ---- Topping ----
    const toppings: ImportPlan['toppings'] = []
    const seenToppingNames = new Set<string>()
    const allToppingNames = new Set(existingToppingNames)
    parsed.toppings.forEach((row, i) => {
        const name = normName(row['Tên topping'])
        const price = toNumber(row['Giá bán'])
        const line = `Topping dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên topping`); return }
        if (price == null) { blockingErrors.push(`${line} ("${name}"): Giá bán không hợp lệ`); return }
        const key = name.toLowerCase()
        if (seenToppingNames.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Topping`); return }
        seenToppingNames.add(key)
        allToppingNames.add(key)
        if (!existingToppingNames.has(key)) toppings.push({ name, price, unit: normName(row['Đơn vị tồn kho']) || 'đv' })
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
        const key = toppingName.toLowerCase()
        if (!linksByTopping.has(key)) linksByTopping.set(key, { toppingName, productNames: [] })
        linksByTopping.get(key)!.productNames.push(productName)
    })

    return {
        plan: { products, ingredients, toppings, recipes, toppingIngredients, toppingLinks: [...linksByTopping.values()] },
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

// Chạy đúng thứ tự phụ thuộc FK: Sản phẩm → Nguyên liệu → Topping → Công thức (1 lệnh batch
// duy nhất) → Công thức Topping → Topping áp dụng món. Chỉ dùng service function có sẵn,
// KHÔNG viết logic ghi DB mới — mỗi hàm đã tự lo cả Supabase lẫn guest/local mode.
export async function commitImportPlan(plan: ImportPlan, addressId: UUID | null, existing: ExistingData) {
    // Map tên -> id, khởi tạo từ dữ liệu ĐÃ CÓ; mỗi thực thể mới tạo bên dưới chèn ngay id
    // thật vào đây để bước sau (Công thức, Công thức Topping, Topping áp dụng món) chỉ đọc
    // qua map, không fetch lại.
    const productByName = new Map(existing.products.map(p => [p.name.trim().toLowerCase(), p.id]))
    const toppingByName = new Map(existing.toppings.map(t => [t.name.trim().toLowerCase(), t.id]))

    await runWithConcurrency(plan.products, CONCURRENCY, async (p) => {
        // insertProduct is untyped JS (checkJs:false) — TS infers its addressId param
        // from the bare `= null` default, not the real UUID|null; cast at this interop edge.
        const row = await insertProduct(p.name, p.price, addressId as any)
        productByName.set(p.name.toLowerCase(), row.id)
    })

    await runWithConcurrency(plan.ingredients, CONCURRENCY, async (ing) => {
        await upsertIngredientCost(ing.key, ing.unitCost, addressId, ing.unit, { category: ing.category })
    })

    await runWithConcurrency(plan.toppings, CONCURRENCY, async (t) => {
        const row = await insertTopping(t.name, t.price, addressId, t.unit)
        toppingByName.set(t.name.toLowerCase(), row.id)
    })

    if (plan.recipes.length > 0) {
        await upsertRecipes(plan.recipes.map(r => ({
            productId: productByName.get(r.productName.toLowerCase())!,
            ingredient: r.ingredient,
            amount: r.amount,
            addressId,
            unit: r.unit,
        })))
    }

    await runWithConcurrency(plan.toppingIngredients, CONCURRENCY, async (ti) => {
        const toppingId = toppingByName.get(ti.toppingName.toLowerCase())!
        await upsertToppingIngredient(toppingId, ti.ingredient, ti.amount, ti.unit)
    })

    await runWithConcurrency(plan.toppingLinks, CONCURRENCY, async (link) => {
        const toppingId = toppingByName.get(link.toppingName.toLowerCase())!
        const productIds = link.productNames.map(n => productByName.get(n.toLowerCase())!)
        await setToppingProductLinks(toppingId, productIds)
    })
}
