import { INGREDIENT_NAMES } from '../../constants'

export const ALL_INGREDIENTS = Object.keys(INGREDIENT_NAMES)

export function sortIngredients(a, b) {
    const idxA = ALL_INGREDIENTS.indexOf(a)
    const idxB = ALL_INGREDIENTS.indexOf(b)
    if (idxA === -1 && idxB === -1) return a.localeCompare(b)
    if (idxA === -1) return 1
    if (idxB === -1) return -1
    return idxA - idxB
}

export function ingredientLabel(key) {
    return INGREDIENT_NAMES[key] || key
}

export function getIngredientUnit(key) {
    if (key.endsWith('_g')) return 'g';
    if (key.endsWith('_ml')) return 'ml';
    if (key === 'cup') return 'ly';
    if (key === 'lid') return 'nắp';
    if (key === 'tea_bag') return 'gói';
    if (key === 'orange') return 'quả';
    return 'đv';
}
