// Tồn kho — tiêu hao & hao hụt: calculateEstimatedConsumption, calculateLossValue.
// Nguồn: src/utils/inventory.js

import { describe, it, expect } from 'vitest';
import { calculateEstimatedConsumption, calculateConsumptionBreakdown, calculateLossValue, buildRecipeIngredientSet, buildIngredientToProduct, averageIngredientMaps } from '../../src/utils/inventory';

const recipes = [
    { product_id: 'cf_den', ingredient: 'coffee_g', amount: 18 },
    { product_id: 'cf_den', ingredient: 'cup', amount: 1 },
    { product_id: 'cf_sua', ingredient: 'coffee_g', amount: 22 },
    { product_id: 'cf_sua', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: 'cf_sua', ingredient: 'cup', amount: 1 },
];

const extraIngredients = {
    size_l: [
        { ingredient: 'coffee_g', amount: 5 },
        { ingredient: 'cup', amount: 0 },
    ],
};

const products = [
    { id: 'cf_den', name: 'Cà phê đen' },
    { id: 'cf_sua', name: 'Cà phê sữa' },
];

// ─── calculateLossValue (split non-recipe consumption from waste) ─────────────

describe('calculateLossValue', () => {
    const closedAt = '2026-06-20T10:00:00';
    const dayStr = new Date(closedAt).toLocaleDateString('sv-SE');
    const closings = [{
        closed_at: closedAt,
        inventory_report: [
            { ingredient: 'coffee_g', opening: 100, restock: 0, remaining: 70 },
            { ingredient: 'straw', opening: 50, restock: 0, remaining: 30 },
        ],
    }];
    const ingredientConfigs = [
        { ingredient: 'coffee_g', unit_cost: 0.5 },
        { ingredient: 'straw', unit_cost: 10 },
    ];
    // coffee_g sold-through 25 (theoretical); straw is in no recipe → used 0.
    const dailyConsumption = { [dayStr]: { coffee_g: 25 } };

    it('routes non-recipe depletion to consumption, recipe variance to loss', () => {
        const recipeIngredients = buildRecipeIngredientSet(recipes, extraIngredients);
        const { loss, consumption } = calculateLossValue({
            shiftClosings: closings, dailyConsumption, ingredientConfigs, recipeIngredients,
        });
        // coffee_g: theoretical 100-25=75, actual 70 → -5 × 0.5 = 2.5 thất thoát
        expect(loss).toBeCloseTo(2.5);
        // straw: không công thức → 50-30=20 dùng × 10 = 200 tiêu hao (KHÔNG phải thất thoát)
        expect(consumption.straw).toBeCloseTo(200);
        expect(consumption.coffee_g).toBeUndefined();
    });

    it('without recipeIngredients, everything is loss (back-compat)', () => {
        const { loss, consumption } = calculateLossValue({
            shiftClosings: closings, dailyConsumption, ingredientConfigs,
        });
        expect(loss).toBeCloseTo(202.5);
        expect(Object.keys(consumption)).toHaveLength(0);
    });
});

// ─── calculateEstimatedConsumption ───────────────────────────────────────────

describe('calculateEstimatedConsumption', () => {
    it('tính đúng tiêu hao cơ bản không có extras', () => {
        const orders = [
            { productId: 'cf_den', qty: 3, extras: [] },
            { productId: 'cf_sua', qty: 2, extras: [] },
        ];
        const result = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        expect(result['coffee_g']).toBe(3 * 18 + 2 * 22); // 54 + 44 = 98
        expect(result['condensed_milk_ml']).toBe(2 * 30);  // 60
        expect(result['cup']).toBe(3 + 2);                 // 5
    });

    it('cộng đúng lượng từ extras', () => {
        const orders = [{ productId: 'cf_den', qty: 2, extras: [{ id: 'size_l' }] }];
        const result = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        // 2 * (18 + 5) = 46
        expect(result['coffee_g']).toBe(46);
    });

    it('trả về 0 khi không có đơn hàng', () => {
        const result = calculateEstimatedConsumption([], recipes, extraIngredients);
        expect(Object.keys(result).length).toBe(0);
    });

    it('xoá nguyên liệu có lượng = 0 sau khi tính', () => {
        const zeroExtra = { size_zero: [{ ingredient: 'coffee_g', amount: -18 }] };
        const orders = [{ productId: 'cf_den', qty: 1, extras: [{ id: 'size_zero' }] }];
        const result = calculateEstimatedConsumption(orders, recipes, zeroExtra);
        expect(result['coffee_g']).toBeUndefined();
    });

    it('làm tròn 1 chữ số thập phân để tránh floating point', () => {
        const fractionalRecipes = [{ product_id: 'p1', ingredient: 'syrup_ml', amount: 0.1 }];
        const orders = Array.from({ length: 3 }, () => ({ productId: 'p1', qty: 1, extras: [] }));
        const result = calculateEstimatedConsumption(orders, fractionalRecipes, {});
        expect(result['syrup_ml']).toBe(0.3);
    });

    it('hỗ trợ cả product_id lẫn productId', () => {
        const orders = [{ product_id: 'cf_den', quantity: 1, extras: [] }];
        const result = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        expect(result['coffee_g']).toBe(18);
    });
});

// ─── averageIngredientMaps ────────────────────────────────────────────────────

describe('averageIngredientMaps', () => {
    it('trung bình đúng nhiều tuần, làm tròn 1 chữ số', () => {
        const result = averageIngredientMaps([
            { coffee_g: 100, cup: 10 },
            { coffee_g: 80 },
            { coffee_g: 90, cup: 5 },
        ]);
        expect(result['coffee_g']).toBe(90); // (100+80+90)/3
        expect(result['cup']).toBeCloseTo(5); // (10+0+5)/3 = 5
    });

    it('tuần không bán ingredient tính là 0 trong mẫu số (không loại trừ)', () => {
        const result = averageIngredientMaps([{ coffee_g: 30 }, {}]);
        expect(result['coffee_g']).toBe(15); // 30/2, không phải 30/1
    });

    it('trả về object rỗng khi không có tuần nào', () => {
        expect(averageIngredientMaps([])).toEqual({});
    });

    it('bỏ ingredient có trung bình = 0', () => {
        const result = averageIngredientMaps([{ x: 0 }, { x: 0 }]);
        expect(result['x']).toBeUndefined();
    });
});

// ─── calculateConsumptionBreakdown ───────────────────────────────────────────

describe('calculateConsumptionBreakdown', () => {
    it('nhóm đúng theo productId', () => {
        const orders = [
            { productId: 'cf_den', qty: 3, extras: [] },
            { productId: 'cf_sua', qty: 2, extras: [] },
        ];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        expect(result['coffee_g']['cf_den'].qty).toBe(3);
        expect(result['coffee_g']['cf_den'].totalAmount).toBe(54);
        expect(result['coffee_g']['cf_sua'].qty).toBe(2);
        expect(result['coffee_g']['cf_sua'].totalAmount).toBe(44);
    });

    it('tổng breakdown khớp với calculateEstimatedConsumption', () => {
        const orders = [
            { productId: 'cf_den', qty: 5, extras: [] },
            { productId: 'cf_sua', qty: 3, extras: [{ id: 'size_l' }] },
        ];
        const total = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        const breakdown = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);

        for (const [ingredient, byProduct] of Object.entries(breakdown)) {
            const sumFromBreakdown = Object.values(byProduct).reduce((s, e) => s + e.totalAmount, 0);
            expect(Math.round(sumFromBreakdown * 10) / 10).toBe(total[ingredient]);
        }
    });

    it('dùng productId làm name fallback khi không có trong products', () => {
        const orders = [{ productId: 'unknown_id', qty: 1, extras: [] }];
        const customRecipes = [{ product_id: 'unknown_id', ingredient: 'coffee_g', amount: 10 }];
        const result = calculateConsumptionBreakdown(orders, customRecipes, {}, []);
        expect(result['coffee_g']['unknown_id'].name).toBe('unknown_id');
    });

    it('accumulate đúng khi cùng product xuất hiện nhiều lần', () => {
        const orders = [
            { productId: 'cf_den', qty: 2, extras: [] },
            { productId: 'cf_den', qty: 3, extras: [] },
        ];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        expect(result['coffee_g']['cf_den'].qty).toBe(5);
        expect(result['coffee_g']['cf_den'].totalAmount).toBe(90);
    });

    it('extras cộng vào đúng biến thể đặt hàng', () => {
        const orders = [{ productId: 'cf_den', qty: 1, extras: [{ id: 'size_l' }] }];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        // 18 (recipe) + 5 (extra) = 23, key có extra
        expect(result['coffee_g']['cf_den|size_l'].totalAmount).toBe(23);
    });

    it('trả về object rỗng khi không có đơn hàng', () => {
        const result = calculateConsumptionBreakdown([], recipes, extraIngredients, products);
        expect(Object.keys(result).length).toBe(0);
    });

    // ── qty không bị double-count khi extra ảnh hưởng cùng ingredient với recipe ──

    it('[qty] 1 ly không có extra → qty=1', () => {
        const orders = [{ productId: 'cf_den', qty: 1, extras: [] }];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        expect(result['coffee_g']['cf_den'].qty).toBe(1);
    });

    it('[qty] 1 ly có extra ảnh hưởng cùng coffee_g → qty vẫn là 1, không phải 2', () => {
        const orders = [{ productId: 'cf_den', qty: 1, extras: [{ id: 'size_l' }] }];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        // BUG cũ: qty=2 (base+extra đều increment), ĐÚNG: qty=1
        expect(result['coffee_g']['cf_den|size_l'].qty).toBe(1);
        expect(result['coffee_g']['cf_den|size_l'].totalAmount).toBe(23); // 18+5
    });

    it('[qty] 50 ly cà phê sữa, 20 có size_l → tách 2 biến thể (30 base + 20 size_l)', () => {
        const recipesLocal = [{ product_id: 'cf_sua', ingredient: 'coffee_g', amount: 17 }];
        const extraIngsLocal = { size_l: [{ ingredient: 'coffee_g', amount: 8 }] };
        const orders = [
            ...Array.from({ length: 30 }, () => ({ productId: 'cf_sua', qty: 1, extras: [] })),
            ...Array.from({ length: 20 }, () => ({ productId: 'cf_sua', qty: 1, extras: [{ id: 'size_l' }] })),
        ];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'cf_sua', name: 'Cà phê sữa' }]);
        expect(result['coffee_g']['cf_sua'].qty).toBe(30);
        expect(result['coffee_g']['cf_sua'].totalAmount).toBe(30 * 17); // 510
        expect(result['coffee_g']['cf_sua|size_l'].qty).toBe(20);
        expect(result['coffee_g']['cf_sua|size_l'].totalAmount).toBe(20 * 25); // 500
    });

    it('[qty] extra chỉ-only ingredient (không có trong recipe) → qty = số order có extra đó', () => {
        // cup không bị ảnh hưởng bởi size_l (amount=0 trong extraIngredients), chỉ recipe mới có
        // Nhưng nếu extra thêm ingredient mới hoàn toàn không có trong recipe:
        const recipesLocal = [{ product_id: 'p1', ingredient: 'coffee_g', amount: 10 }];
        const extraIngsLocal = { topping: [{ ingredient: 'tran_chau', amount: 50 }] };
        const orders = [
            { productId: 'p1', qty: 3, extras: [] },
            { productId: 'p1', qty: 2, extras: [{ id: 'topping' }] },
        ];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'p1', name: 'P1' }]);
        // coffee_g: tách 3 (base) + 2 (topping) = 5 cups tổng
        expect(result['coffee_g']['p1'].qty).toBe(3);
        expect(result['coffee_g']['p1'].totalAmount).toBe(30);
        expect(result['coffee_g']['p1|topping'].qty).toBe(2);
        expect(result['coffee_g']['p1|topping'].totalAmount).toBe(20);
        // tran_chau: chỉ 2 cups có topping
        expect(result['tran_chau']['p1|topping'].qty).toBe(2);
        expect(result['tran_chau']['p1|topping'].totalAmount).toBe(100);
    });

    it('[qty] extra âm (swap ly nhỏ → ly lớn) → qty của ingredient bị ảnh hưởng không bị double-count', () => {
        // ly_swap: LyNho=-1, LyLon=+1
        const recipesLocal = [
            { product_id: 'p1', ingredient: 'LyNho', amount: 1 },
            { product_id: 'p1', ingredient: 'coffee_g', amount: 17 },
        ];
        const extraIngsLocal = { ly_lon: [{ ingredient: 'LyNho', amount: -1 }, { ingredient: 'LyLon', amount: 1 }] };
        const orders = [{ productId: 'p1', qty: 5, extras: [{ id: 'ly_lon' }] }];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'p1', name: 'P1' }]);
        // LyNho: base +1, extra -1 → totalAmount=0 → entry có thể tồn tại với total=0
        expect(result['LyNho']['p1|ly_lon'].qty).toBe(5);       // 5 ly thực, không phải 10
        expect(result['LyNho']['p1|ly_lon'].totalAmount).toBe(0);
        // LyLon: chỉ từ extra → qty=5
        expect(result['LyLon']['p1|ly_lon'].qty).toBe(5);
        expect(result['LyLon']['p1|ly_lon'].totalAmount).toBe(5);
    });

    it('[qty] tổng breakdown totalAmount khớp calculateEstimatedConsumption (invariant)', () => {
        const orders = [
            { productId: 'cf_den', qty: 5, extras: [] },
            { productId: 'cf_sua', qty: 3, extras: [{ id: 'size_l' }] },
        ];
        const total = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        const breakdown = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        for (const [ingredient, byProduct] of Object.entries(breakdown)) {
            const sum = Math.round(Object.values(byProduct).reduce((s, e) => s + e.totalAmount, 0) * 10) / 10;
            expect(sum).toBe(total[ingredient] ?? 0);
        }
    });

    it('[qty] nhiều extras trên cùng 1 order, mỗi extra ảnh hưởng ingredient khác nhau → qty đúng cho từng', () => {
        const recipesLocal = [{ product_id: 'p1', ingredient: 'coffee_g', amount: 17 }];
        const extraIngsLocal = {
            size_l: [{ ingredient: 'coffee_g', amount: 5 }],
            topping: [{ ingredient: 'tran_chau', amount: 50 }],
        };
        const orders = [{ productId: 'p1', qty: 2, extras: [{ id: 'size_l' }, { id: 'topping' }] }];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'p1', name: 'P1' }]);
        // Variant key gồm cả 2 extras (sorted): size_l,topping
        const key = 'p1|size_l,topping';
        expect(result['coffee_g'][key].qty).toBe(2);           // không double-count
        expect(result['coffee_g'][key].totalAmount).toBe(44);  // 2*(17+5)
        expect(result['tran_chau'][key].qty).toBe(2);
        expect(result['tran_chau'][key].totalAmount).toBe(100);
    });

    it('[variant] hiển thị tên kèm extras khi truyền productExtras', () => {
        const recipesLocal = [{ product_id: 'cf_sua', ingredient: 'coffee_g', amount: 17 }];
        const extraIngsLocal = {
            size_l: [{ ingredient: 'coffee_g', amount: 8 }],
            it_ngot: [{ ingredient: 'coffee_g', amount: 0 }],
        };
        const productExtrasLocal = {
            cf_sua: [
                { id: 'size_l', name: 'Size L' },
                { id: 'it_ngot', name: 'Ít ngọt' },
            ],
        };
        const orders = [
            ...Array.from({ length: 10 }, () => ({ productId: 'cf_sua', qty: 1, extras: [] })),
            ...Array.from({ length: 15 }, () => ({ productId: 'cf_sua', qty: 1, extras: [{ id: 'size_l' }] })),
            ...Array.from({ length: 10 }, () => ({ productId: 'cf_sua', qty: 1, extras: [{ id: 'it_ngot' }] })),
        ];
        const result = calculateConsumptionBreakdown(
            orders,
            recipesLocal,
            extraIngsLocal,
            [{ id: 'cf_sua', name: 'Cà phê sữa' }],
            productExtrasLocal
        );
        expect(result['coffee_g']['cf_sua'].name).toBe('Cà phê sữa');
        expect(result['coffee_g']['cf_sua'].qty).toBe(10);
        expect(result['coffee_g']['cf_sua|size_l'].name).toBe('Cà phê sữa (Size L)');
        expect(result['coffee_g']['cf_sua|size_l'].qty).toBe(15);
        expect(result['coffee_g']['cf_sua|it_ngot'].name).toBe('Cà phê sữa (Ít ngọt)');
        expect(result['coffee_g']['cf_sua|it_ngot'].qty).toBe(10);
    });
});


// buildIngredientToProduct — chọn "món đại diện" cho mỗi nguyên liệu để quy đổi
// hao hụt → "≈ N ly <món>". Gộp từ 4 bản chép tay (DailyReportPage, RangeLossCard,
// PastInventoryEditor, InventoryRefillCard đã xoá) nên cần chốt hành vi ở 1 chỗ.
describe('buildIngredientToProduct', () => {
    const products = [
        { id: 'cf_den', name: 'Cà Phê Đen' },
        { id: 'cf_sua', name: 'Cà Phê Sữa' },
    ];

    it('chọn món bán chạy nhất trong số các món dùng nguyên liệu đó', () => {
        const map = buildIngredientToProduct({
            orderItems: [{ productId: 'cf_den', qty: 3 }, { productId: 'cf_sua', qty: 10 }],
            recipes, products,
        });
        expect(map['coffee_g'].productId).toBe('cf_sua');
        expect(map['coffee_g'].amountPerCup).toBe(22);
        expect(map['coffee_g'].productName).toBe('cà phê sữa');
    });

    it('loại nguyên liệu tỉ lệ 1:1 (ly/nắp) — "≈ 220 ly" cho "dư 220 cái" là vô nghĩa', () => {
        const map = buildIngredientToProduct({
            orderItems: [{ productId: 'cf_den', qty: 5 }],
            recipes, products,
        });
        expect(map['cup']).toBeUndefined();
    });

    it('không có đơn nào vẫn map được (rơi về recipe gặp đầu tiên)', () => {
        const map = buildIngredientToProduct({ orderItems: [], recipes, products });
        expect(map['coffee_g'].productId).toBe('cf_den');
    });

    it('bỏ nguyên liệu trỏ tới product không còn trong danh sách', () => {
        const map = buildIngredientToProduct({
            orderItems: [{ productId: 'cf_sua', qty: 1 }],
            recipes, products: [{ id: 'cf_den', name: 'Cà Phê Đen' }],
        });
        expect(map['condensed_milk_ml']).toBeUndefined();
    });
});
