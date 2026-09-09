import * as XLSX from 'xlsx'
import { ingredientLabel, normalizeIngredientKey } from '../utils/ingredients'
import { fetchToppingIngredients } from './toppingService'
import type { UUID } from '../types/domain'

// Xuất TOÀN BỘ thiết lập hiện tại của 1 địa chỉ ra đúng layout mà importService.ts đọc được
// (public/templates/mau-nhap-lieu.xlsx) — sửa trực tiếp trong file này rồi nạp lại qua
// ExcelImportModal sẽ CẬP NHẬT (không tạo trùng) đúng những gì đã sửa.

interface ExportInput {
    addressName?: string | null
    products: Array<{ id: UUID; name: string; price: number }>
    toppings: Array<{ id: UUID; name: string; price: number }>
    ingredientConfigs: Array<{ ingredient: string; unit: string; unit_cost: number; category: string | null }>
    ingredientUnits: Record<string, string>
    recipes: Array<{ product_id: UUID; ingredient: string; amount: number; unit: string | null }>
    productToppings: Record<UUID, Array<{ id: UUID; name: string }>>
    productExtras: Record<UUID, Array<{ id: UUID; name: string; price: number; is_sticky: boolean }>>
    extraIngredients: Record<UUID, Array<{ ingredient: string; amount: number; unit: string | null }>>
}

export async function downloadCurrentDataExcel(input: ExportInput) {
    const productNameById = new Map(input.products.map(p => [p.id, p.name]))
    const toppingNameById = new Map(input.toppings.map(t => [t.id, t.name]))

    const wb = XLSX.utils.book_new()
    const addSheet = (name: string, rows: Record<string, unknown>[]) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
    }

    addSheet('Sản phẩm', input.products.map(p => ({ 'Tên món': p.name, 'Giá bán': p.price })))

    addSheet('Nguyên liệu', input.ingredientConfigs.map(c => ({
        'Tên nguyên liệu': ingredientLabel(c.ingredient),
        'Đơn vị': c.unit,
        'Giá vốn/đơn vị': c.unit_cost,
        'Loại': c.category === 'packaging' ? 'bao bì' : 'chính',
    })))

    addSheet('Công thức', input.recipes.map(r => ({
        'Tên món': productNameById.get(r.product_id) || '',
        'Tên nguyên liệu': ingredientLabel(r.ingredient),
        'Số lượng': r.amount,
        'Đơn vị': r.unit || '',
    })).filter(r => r['Tên món']))

    addSheet('Topping', input.toppings.map(t => ({
        'Tên topping': t.name,
        'Giá bán': t.price,
        'Đơn vị tồn kho': input.ingredientUnits[normalizeIngredientKey(t.name)] || 'đv',
    })))

    const toppingIngredientsMap = await fetchToppingIngredients(input.toppings.map(t => t.id))
    const toppingIngredientRows: Record<string, unknown>[] = []
    for (const [toppingId, rows] of Object.entries(toppingIngredientsMap)) {
        const toppingName = toppingNameById.get(toppingId)
        if (!toppingName) continue
        for (const r of rows) {
            toppingIngredientRows.push({
                'Tên topping': toppingName,
                'Tên nguyên liệu': ingredientLabel(r.ingredient),
                'Số lượng': r.amount,
                'Đơn vị': r.unit || '',
            })
        }
    }
    addSheet('Công thức Topping', toppingIngredientRows)

    const extrasRows: Record<string, unknown>[] = []
    const extraIngredientRows: Record<string, unknown>[] = []
    for (const [productId, extras] of Object.entries(input.productExtras)) {
        const productName = productNameById.get(productId)
        if (!productName) continue
        for (const extra of extras) {
            extrasRows.push({
                'Tên món': productName,
                'Tên tùy chọn': extra.name,
                'Giá': extra.price,
                'Tự động chọn': extra.is_sticky ? 'có' : '',
            })
            for (const ei of input.extraIngredients[extra.id] || []) {
                extraIngredientRows.push({
                    'Tên món': productName,
                    'Tên tùy chọn': extra.name,
                    'Tên nguyên liệu': ingredientLabel(ei.ingredient),
                    'Số lượng': ei.amount,
                    'Đơn vị': ei.unit || '',
                })
            }
        }
    }
    addSheet('Tùy chọn thêm', extrasRows)
    addSheet('Công thức tùy chọn', extraIngredientRows)

    const toppingLinkRows: Record<string, unknown>[] = []
    for (const [productId, toppingsOfProduct] of Object.entries(input.productToppings)) {
        const productName = productNameById.get(productId)
        if (!productName) continue
        for (const t of toppingsOfProduct) toppingLinkRows.push({ 'Tên topping': t.name, 'Tên món': productName })
    }
    addSheet('Topping áp dụng món', toppingLinkRows)

    const datePart = new Date().toISOString().slice(0, 10)
    const addressPart = input.addressName ? `-${input.addressName.trim().toLowerCase().replace(/\s+/g, '-')}` : ''
    XLSX.writeFile(wb, `du-lieu${addressPart}-${datePart}.xlsx`)
}
