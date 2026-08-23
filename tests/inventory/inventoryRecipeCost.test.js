// Tồn kho — giá vốn từ công thức + extras (calculateItemCost).
// Nguồn: src/utils/inventory.js · xem TINH_TOAN_TON_KHO.md cùng thư mục

import { describe, it, expect } from 'vitest';
import { calculateItemCost, calculateEstimatedConsumption } from '../../src/utils/inventory';

// ──────────────────────────────────────────────────────────
//  SHARED MOCK DATA
// ──────────────────────────────────────────────────────────

const recipes = [
    { product_id: 'cafe_sua', ingredient: 'CaPhe', amount: 20 },
    { product_id: 'cafe_sua', ingredient: 'SuaDac', amount: 30 },
    { product_id: 'cafe_sua', ingredient: 'LyNho', amount: 1 },

    { product_id: 'tra_dao', ingredient: 'TraDao', amount: 15 },
    { product_id: 'tra_dao', ingredient: 'DuongLong', amount: 20 },
    { product_id: 'tra_dao', ingredient: 'LyNho', amount: 1 },
];

const extraIngredients = {
    // Up size: đổi ly nhỏ → ly lớn, thêm café
    'ly_lon': [
        { ingredient: 'LyNho', amount: -1 },
        { ingredient: 'LyLon', amount: 1 },
        { ingredient: 'CaPhe', amount: 7 },
    ],
    // Topping
    'them_tran_chau': [
        { ingredient: 'TranChau', amount: 50 },
    ],
    // Thêm đường (chỉ ảnh hưởng cost, không thay thế)
    'them_duong': [
        { ingredient: 'DuongLong', amount: 10 },
    ],
    // Extra không ảnh hưởng nguyên liệu (ví dụ: gói giấy)
    'goi_giay': [],
};

const ingredientCosts = {
    'CaPhe': 200,       // 200đ / gram
    'SuaDac': 100,      // 100đ / ml
    'LyNho': 1000,      // 1000đ / cái
    'LyLon': 1500,      // 1500đ / cái
    'TranChau': 50,     // 50đ / gram
    'TraDao': 80,       // 80đ / gram
    'DuongLong': 10,    // 10đ / gram
};

// ──────────────────────────────────────────────────────────
//  calculateItemCost
// ──────────────────────────────────────────────────────────

describe('calculateItemCost', () => {
    it('món chính không có extras', () => {
        const cost = calculateItemCost('cafe_sua', [], recipes, extraIngredients, ingredientCosts);
        // (20*200) + (30*100) + (1*1000) = 4000+3000+1000 = 8000
        expect(cost).toBe(8000);
    });

    it('up size ly lớn: thay thế ly nhỏ + thêm café', () => {
        const cost = calculateItemCost('cafe_sua', [{ id: 'ly_lon' }], recipes, extraIngredients, ingredientCosts);
        // Món chính: 8000
        // ly_lon: (-1*1000) + (1*1500) + (7*200) = -1000+1500+1400 = 1900
        expect(cost).toBe(9900);
    });

    it('up size + topping trân châu', () => {
        const cost = calculateItemCost('cafe_sua', [{ id: 'ly_lon' }, { id: 'them_tran_chau' }], recipes, extraIngredients, ingredientCosts);
        // 8000 + 1900 + (50*50) = 8000+1900+2500 = 12400
        expect(cost).toBe(12400);
    });

    it('topping trân châu không có up size', () => {
        const cost = calculateItemCost('cafe_sua', [{ id: 'them_tran_chau' }], recipes, extraIngredients, ingredientCosts);
        // 8000 + 2500 = 10500
        expect(cost).toBe(10500);
    });

    it('extra không có nguyên liệu (gói giấy) không làm thay đổi cost', () => {
        const costBase = calculateItemCost('cafe_sua', [], recipes, extraIngredients, ingredientCosts);
        const costWithEmpty = calculateItemCost('cafe_sua', [{ id: 'goi_giay' }], recipes, extraIngredients, ingredientCosts);
        expect(costWithEmpty).toBe(costBase);
    });

    it('extra_id không tồn tại trong map → bỏ qua, không crash', () => {
        const cost = calculateItemCost('cafe_sua', [{ id: 'extra_khong_ton_tai' }], recipes, extraIngredients, ingredientCosts);
        expect(cost).toBe(8000); // chỉ giá món chính
    });

    it('product_id không có recipe → cost = 0', () => {
        const cost = calculateItemCost('sp_khong_ton_tai', [], recipes, extraIngredients, ingredientCosts);
        expect(cost).toBe(0);
    });

    it('product_id không có recipe nhưng có extra → chỉ tính extra', () => {
        const cost = calculateItemCost('sp_khong_ton_tai', [{ id: 'them_tran_chau' }], recipes, extraIngredients, ingredientCosts);
        // (50*50) = 2500
        expect(cost).toBe(2500);
    });

    it('ingredient không có trong ingredientCosts → coi như 0, không crash', () => {
        const recipesWithUnknown = [
            ...recipes,
            { product_id: 'cafe_sua', ingredient: 'NguyenLieuLa', amount: 5 },
        ];
        const cost = calculateItemCost('cafe_sua', [], recipesWithUnknown, extraIngredients, ingredientCosts);
        expect(cost).toBe(8000); // NguyenLieuLa cost = 0
    });

    it('sản phẩm khác (trà đào) tính đúng recipe của nó', () => {
        const cost = calculateItemCost('tra_dao', [], recipes, extraIngredients, ingredientCosts);
        // (15*80) + (20*10) + (1*1000) = 1200+200+1000 = 2400
        expect(cost).toBe(2400);
    });

    it('trà đào + thêm đường', () => {
        const cost = calculateItemCost('tra_dao', [{ id: 'them_duong' }], recipes, extraIngredients, ingredientCosts);
        // 2400 + (10*10) = 2400+100 = 2500
        expect(cost).toBe(2500);
    });
});

// ──────────────────────────────────────────────────────────
//  calculateEstimatedConsumption
// ──────────────────────────────────────────────────────────

describe('calculateEstimatedConsumption', () => {
    it('1 ly bình thường không có extras', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 1, extras: [] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 20,
            SuaDac: 30,
            LyNho: 1,
        });
    });

    it('2 ly bình thường nhân đôi tiêu hao', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 2, extras: [] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 40,
            SuaDac: 60,
            LyNho: 2,
        });
    });

    it('up size ly lớn: LyNho bù trừ về 0 → bị xóa khỏi kết quả', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 2, extras: [{ id: 'ly_lon' }] }];
        // CaPhe: 40+14=54, SuaDac: 60, LyNho: 2-2=0 (xóa), LyLon: 2
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 54,
            SuaDac: 60,
            LyLon: 2,
        });
    });

    it('1 ly size L: LyNho = 0 → bị xóa', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 1, extras: [{ id: 'ly_lon' }] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 27,
            SuaDac: 30,
            LyLon: 1,
        });
    });

    it('size L + trân châu', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 1, extras: [{ id: 'ly_lon' }, { id: 'them_tran_chau' }] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 27,
            SuaDac: 30,
            LyLon: 1,
            TranChau: 50,
        });
    });

    it('nhiều đơn hàng khác nhau gộp tiêu hao đúng', () => {
        const orders = [
            { product_id: 'cafe_sua', qty: 1, extras: [] },
            { product_id: 'cafe_sua', qty: 1, extras: [{ id: 'ly_lon' }] },
        ];
        // Ly bình: CaPhe20, SuaDac30, LyNho1
        // Ly lớn:  CaPhe27, SuaDac30, LyLon1
        // Tổng: CaPhe47, SuaDac60, LyNho1, LyLon1
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 47,
            SuaDac: 60,
            LyNho: 1,
            LyLon: 1,
        });
    });

    it('2 sản phẩm khác nhau trong cùng đơn', () => {
        const orders = [
            { product_id: 'cafe_sua', qty: 1, extras: [] },
            { product_id: 'tra_dao', qty: 1, extras: [] },
        ];
        // LyNho dùng chung cho cả 2 sản phẩm → cộng dồn = 2
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 20,
            SuaDac: 30,
            LyNho: 2,
            TraDao: 15,
            DuongLong: 20,
        });
    });

    it('extra không có nguyên liệu (gói giấy) không ảnh hưởng tiêu hao', () => {
        const base = calculateEstimatedConsumption(
            [{ product_id: 'cafe_sua', qty: 1, extras: [] }],
            recipes, extraIngredients
        );
        const withEmpty = calculateEstimatedConsumption(
            [{ product_id: 'cafe_sua', qty: 1, extras: [{ id: 'goi_giay' }] }],
            recipes, extraIngredients
        );
        expect(withEmpty).toEqual(base);
    });

    it('extra_id không tồn tại trong map → bỏ qua, không crash', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 1, extras: [{ id: 'extra_khong_ton_tai' }] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 20,
            SuaDac: 30,
            LyNho: 1,
        });
    });

    it('danh sách đơn rỗng → tiêu hao rỗng', () => {
        expect(calculateEstimatedConsumption([], recipes, extraIngredients)).toEqual({});
    });

    it('product_id không có recipe → bỏ qua, không crash', () => {
        const orders = [
            { product_id: 'sp_khong_ton_tai', qty: 1, extras: [] },
            { product_id: 'cafe_sua', qty: 1, extras: [] },
        ];
        // Chỉ tính café sữa
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 20,
            SuaDac: 30,
            LyNho: 1,
        });
    });

    it('hỗ trợ naming convention productId (camelCase) thay vì product_id', () => {
        const orders = [{ productId: 'cafe_sua', qty: 1, extras: [] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 20,
            SuaDac: 30,
            LyNho: 1,
        });
    });

    it('hỗ trợ quantity thay vì qty', () => {
        const orders = [{ product_id: 'cafe_sua', quantity: 3, extras: [] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 60,
            SuaDac: 90,
            LyNho: 3,
        });
    });

    it('thiếu trường qty lẫn quantity → mặc định qty=1', () => {
        const orders = [{ product_id: 'cafe_sua', extras: [] }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 20,
            SuaDac: 30,
            LyNho: 1,
        });
    });

    it('thiếu trường extras → mặc định extras=[] (không crash)', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 1 }];
        expect(calculateEstimatedConsumption(orders, recipes, extraIngredients)).toEqual({
            CaPhe: 20,
            SuaDac: 30,
            LyNho: 1,
        });
    });

    // ── BUG DOCUMENTATION ─────────────────────────────────
    // Đây là test ghi lại đúng cách convert dữ liệu từ DB trước khi gọi
    // calculateEstimatedConsumption. DB lưu extra_ids: ['ly_lon'] (mảng string),
    // KHÔNG phải extras: [{id:'ly_lon'}]. PastInventoryEditor phải tự map:
    //   extras: (i.extra_ids || []).map(id => ({ id }))
    // Nếu truyền thẳng extra_ids vào extras → sẽ không match extra nào cả
    // vì extraIngredients['l'] (ký tự đầu tiên của string) không tồn tại.
    it('[BUG] truyền extra_ids dạng string thay vì {id} object → extra bị bỏ qua (sai)', () => {
        // Mô phỏng bug: i.extras = i.extra_ids = ['ly_lon'] (mảng string từ DB)
        const ordersWithBug = [{ product_id: 'cafe_sua', qty: 1, extras: ['ly_lon'] }];
        const bugResult = calculateEstimatedConsumption(ordersWithBug, recipes, extraIngredients);
        // Extra bị bỏ qua → kết quả sai (thiếu LyLon, CaPhe không được cộng thêm 7)
        expect(bugResult).toEqual({ CaPhe: 20, SuaDac: 30, LyNho: 1 }); // SAI so với thực tế

        // Cách đúng: map extra_ids → [{id}] trước khi tính
        const ordersFixed = [{ product_id: 'cafe_sua', qty: 1, extras: [{ id: 'ly_lon' }] }];
        const fixedResult = calculateEstimatedConsumption(ordersFixed, recipes, extraIngredients);
        expect(fixedResult).toEqual({ CaPhe: 27, SuaDac: 30, LyLon: 1 }); // ĐÚNG
    });

    it('[BUG FIX] PastInventoryEditor cần map extra_ids → [{id}] cho dayOrders', () => {
        // Mô phỏng raw order item từ DB (Supabase trả về)
        const rawOrderItem = {
            product_id: 'cafe_sua',
            quantity: 1,
            extra_ids: ['ly_lon'], // field từ DB
            // KHÔNG có trường "extras"
        };

        // Cách ĐÚNG (giống orderItems trong PastInventoryEditor):
        const normalizedItem = {
            productId: rawOrderItem.product_id,
            qty: rawOrderItem.quantity,
            extras: (rawOrderItem.extra_ids || []).map(id => ({ id })),
        };

        const result = calculateEstimatedConsumption([normalizedItem], recipes, extraIngredients);
        expect(result).toEqual({ CaPhe: 27, SuaDac: 30, LyLon: 1 });
    });

    it('floating point: nhiều lần cộng dồn số thập phân không bị lỗi epsilon', () => {
        const recipesFloat = [
            { product_id: 'sp_float', ingredient: 'NguyenLieu', amount: 0.1 },
        ];
        const orders = Array.from({ length: 30 }, () => ({
            product_id: 'sp_float', qty: 1, extras: [],
        }));
        const result = calculateEstimatedConsumption(orders, recipesFloat, {});
        // 0.1 * 30 = 3.0 (không phải 2.9999999...)
        expect(result).toEqual({ NguyenLieu: 3 });
    });
});
