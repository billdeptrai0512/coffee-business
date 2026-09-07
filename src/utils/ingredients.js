import { INGREDIENT_NAMES } from '../constants'

// Display order matters: used as the tab order in /ingredients.
// `null` (chưa phân loại) folds into 'main' per UX rule.
// `tools` is a legacy value (kept for old DB rows) — folded into 'packaging' everywhere.
export const INGREDIENT_CATEGORIES = [
    { key: 'main',      label: 'Nguyên liệu chính' },
    { key: 'packaging', label: 'Bao bì' },
]

// Coerce raw category value into the active 2-tab set.
// null / unknown → 'main'; legacy 'tools' → 'packaging'.
export function normalizeIngredientCategory(raw) {
    if (raw === 'packaging' || raw === 'tools') return 'packaging'
    return 'main'
}

export function sortIngredients(a, b, customOrderArray) {
    if (customOrderArray && customOrderArray.length > 0) {
        const idxA = customOrderArray.indexOf(a)
        const idxB = customOrderArray.indexOf(b)
        if (idxA !== -1 && idxB !== -1) return idxA - idxB
        if (idxA !== -1) return -1
        if (idxB !== -1) return 1
    }
    return a.localeCompare(b)
}

// Canonical ingredient key: lower-case, snake_case. Used at every rename site
// so a user-typed display name ("Cà Phê") always lands on the same DB key as
// the auto-seeded one ("cà_phê"). Trim + lower + spaces→underscore is enough
// because the DB column is `text` and accepts any unicode word chars.
export function normalizeIngredientKey(raw) {
    return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_')
}

export function ingredientLabel(key) {
    if (INGREDIENT_NAMES[key]) return INGREDIENT_NAMES[key]
    const name = key.replace(/_/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
}

// Đọc giá trị của một nguyên liệu từ `map` kèm fallback theo LABEL: nếu không có key trực
// tiếp, dò một key khác cùng nhãn (dữ liệu cũ lưu theo biến thể key). Trả `fallback` nếu
// không thấy. Dùng chung cho tồn kho / dự báo để mọi nơi tra key giống nhau (tránh lệch).
export function lookupByLabel(key, map, fallback = 0) {
    if (!map) return fallback
    if (map[key] != null) return map[key]
    const label = ingredientLabel(key).toLowerCase()
    for (const [k, v] of Object.entries(map)) {
        if (k !== key && ingredientLabel(k).toLowerCase() === label) return v
    }
    return fallback
}

export function getIngredientUnit(key, storedUnit, ingredientUnits) {
    if (storedUnit && storedUnit !== 'đv') return storedUnit;
    if (ingredientUnits?.[key] && ingredientUnits[key] !== 'đv') return ingredientUnits[key];
    if (key.endsWith('_g')) return 'g';
    if (key.endsWith('_ml')) return 'ml';
    if (key === 'cup') return 'ly';
    if (key === 'lid') return 'nắp';
    if (key === 'tea_bag') return 'gói';
    if (key === 'orange') return 'quả';
    return storedUnit || ingredientUnits?.[key] || 'đv';
}

// Dùng chung bởi "thêm nguyên liệu mới" của công thức món (RecipeIngredientPage) và công
// thức topping (ToppingDetailPage): với mỗi { key, unit, category } trong toAdd (unit=null
// = chọn từ danh sách có sẵn, unit khác null = gõ tên mới qua IngredientPicker), đăng ký
// ingredient_costs cho nguyên liệu THẬT SỰ mới (còn thiếu cost) rồi trả về các key chưa có
// trong công thức hiện tại — caller tự upsert (batch hay từng dòng) + chèn vào state.
export async function registerNewIngredients(toAdd, { existingKeys, ingredientCosts, addressId, upsertIngredientCost }) {
    for (const { key, unit, category } of toAdd) {
        if (unit !== null && !(key in ingredientCosts)) {
            await upsertIngredientCost(key, 0, addressId, unit, category ? { category } : {})
        }
    }
    return toAdd.filter(t => !existingKeys.has(t.key))
}
