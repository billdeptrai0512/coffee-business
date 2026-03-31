// Quick Extras (UUID formatted for safe DB parsing)
export const QUICK_EXTRAS = [
    { id: '22222222-2222-2222-2222-222222222201', name: 'Lớn', price: 6000 },
]

// Payment methods (order-level, not per-item)
export const PAYMENT_METHODS = [
    { id: 'cash', name: 'Tiền mặt', label: '💵 CASH' },
    { id: 'transfer', name: 'Chuyển khoản', label: '📱 BANK' },
]

// Ingredient display names for warnings
export const INGREDIENT_NAMES = {
    coffee_g: 'Cà phê',
    condensed_milk_ml: 'Sữa đặc',
    fresh_milk_ml: 'Sữa tươi',
    tea_bag: 'Trà',
    peach_syrup_ml: 'Syrup đào',
    lychee_syrup_ml: 'Syrup vải',
    orange: 'Cam',
    cup: 'Ly',
    lid: 'Nắp',
}

// Low stock threshold per ingredient
export const LOW_STOCK_THRESHOLD = {
    coffee_g: 100,
    condensed_milk_ml: 200,
    fresh_milk_ml: 300,
    tea_bag: 10,
    peach_syrup_ml: 200,
    lychee_syrup_ml: 200,
    orange: 5,
    cup: 20,
    lid: 20,
}

// Vietnamese day names
export const DAY_NAMES = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
