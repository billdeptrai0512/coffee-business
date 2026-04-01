// Quick Extras (UUID formatted for safe DB parsing)
export const QUICK_EXTRAS = [
    { id: 'ex1', name: 'Lớn', price: 6000 },
    { id: 'ex2', name: 'Trà đá', price: 0 },
]

// Payment methods (order-level, not per-item)
// export const PAYMENT_METHODS = [
//     { id: 'cash', name: 'Tiền mặt', label: 'Tiền mặt' },
//     { id: 'transfer', name: 'Chuyển khoản', label: 'Momo' },
// ]

// Ingredient display names for warnings
export const INGREDIENT_NAMES = {
    coffee_g: 'Cà phê',
    condensed_milk_ml: 'Sữa đặc',
    fresh_milk_ml: 'Sữa tươi',
    cacao_powder_g: 'Bột cacao',
    matcha_powder_g: 'Bột matcha',
    cup: 'Ly',
    lid: 'Nắp',
    rich_g: 'Rich',
    sugar: 'Đường',
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

// Ingredient unit costs for profit calculation
export const INGREDIENT_COSTS = {
    coffee_g: 250,           // 250đ/g -> 250k/kg
    cacao_powder_g: 100,     // 100đ/g -> 100k/kg
    matcha_powder_g: 100,    // 100đ/g -> 100k/kg
    sugar: 19,               // 19đ/g -> 19k/kg
    rich_g: 150,             // 150đ/g -> 150k/kg
    condensed_milk_ml: 60,   // 60đ/ml -> sửa đặc hộp lớn  ~ 60k
    fresh_milk_ml: 35,       // 35đ/ml -> sữa tươi hộp lớn        // 2000đ/túi lọc    // 100đ/ml   // 100đ/ml         // 3000đ/quả
    cup: 800,                // 800đ/ly nhựa
    lid: 200,                // 200đ/nắp
}
