// Format VND currency
export function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

import { INGREDIENT_COSTS } from './constants'

// Calculate the ingredient cost of a single product based on its recipe
// ingredientCosts is optional – if not provided, uses hardcoded INGREDIENT_COSTS
export function calculateProductCost(productId, recipes, ingredientCosts) {
    if (!recipes || !Array.isArray(recipes)) return 0;
    const costs = ingredientCosts || INGREDIENT_COSTS;
    const productRecipe = recipes.filter(r => r.product_id === productId);

    return productRecipe.reduce((totalCost, item) => {
        const unitCost = costs[item.ingredient] || 0;
        return totalCost + (item.amount * unitCost);
    }, 0);
}
