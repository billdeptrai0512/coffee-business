// Nhập liệu hàng loạt từ Excel — chỉ test resolveImportPlan (hàm thuần, không gọi mạng).
// Nguồn: src/services/importService.ts

import { describe, it, expect } from 'vitest'
import { resolveImportPlan } from '../../src/services/importService'

const EMPTY_EXISTING = { products: [], toppings: [], ingredientCosts: {} }

function parsed(overrides = {}) {
    return {
        products: [], ingredients: [], recipes: [], toppings: [], toppingIngredients: [], toppingLinks: [],
        ...overrides,
    }
}

describe('resolveImportPlan', () => {
    it('tạo sản phẩm + nguyên liệu + công thức mới, bỏ qua sản phẩm đã tồn tại', () => {
        const existing = { products: [{ id: 'p-existing', name: 'Trà Đá' }], toppings: [], ingredientCosts: {} }
        const { plan, blockingErrors, warnings } = resolveImportPlan(parsed({
            products: [{ 'Tên món': 'Trà Đá', 'Giá bán': 10000 }, { 'Tên món': 'Cà Phê Sữa', 'Giá bán': 20000 }],
            ingredients: [{ 'Tên nguyên liệu': 'Sữa đặc', 'Đơn vị': 'ml', 'Giá vốn/đơn vị': 100, 'Loại': 'chính' }],
            recipes: [{ 'Tên món': 'Cà Phê Sữa', 'Tên nguyên liệu': 'Sữa đặc', 'Số lượng': 30, 'Đơn vị': 'ml' }],
        }), existing)

        expect(blockingErrors).toEqual([])
        expect(warnings).toEqual([])
        expect(plan.products).toEqual([{ name: 'Cà Phê Sữa', price: 20000 }])
        expect(plan.ingredients).toEqual([{ key: 'sữa_đặc', unitCost: 100, unit: 'ml', category: 'main' }])
        expect(plan.recipes).toEqual([{ productName: 'Cà Phê Sữa', ingredient: 'sữa_đặc', amount: 30, unit: 'ml' }])
    })

    it('chặn cứng khi thiếu ô bắt buộc hoặc số không hợp lệ', () => {
        const { blockingErrors } = resolveImportPlan(parsed({
            products: [{ 'Tên món': '', 'Giá bán': 10000 }, { 'Tên món': 'Trà Đá', 'Giá bán': 'abc' }],
        }), EMPTY_EXISTING)
        expect(blockingErrors).toHaveLength(2)
        expect(blockingErrors[0]).toMatch(/thiếu Tên món/)
        expect(blockingErrors[1]).toMatch(/Giá bán không hợp lệ/)
    })

    it('chặn cứng khi trùng tên trong cùng 1 sheet', () => {
        const { blockingErrors } = resolveImportPlan(parsed({
            products: [{ 'Tên món': 'Trà Đá', 'Giá bán': 10000 }, { 'Tên món': 'trà đá', 'Giá bán': 12000 }],
        }), EMPTY_EXISTING)
        expect(blockingErrors).toHaveLength(1)
        expect(blockingErrors[0]).toMatch(/bị lặp/)
    })

    it('bỏ qua + cảnh báo khi công thức trỏ tới món không tồn tại, không chặn cả file', () => {
        const { plan, blockingErrors, warnings } = resolveImportPlan(parsed({
            recipes: [{ 'Tên món': 'Món Không Tồn Tại', 'Tên nguyên liệu': 'Đường', 'Số lượng': 10, 'Đơn vị': 'g' }],
        }), EMPTY_EXISTING)
        expect(blockingErrors).toEqual([])
        expect(plan.recipes).toEqual([])
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toMatch(/Món Không Tồn Tại/)
    })

    it('tự đăng ký nguyên liệu chỉ xuất hiện trong Công thức (chưa có ở sheet Nguyên liệu)', () => {
        const existing = { products: [{ id: 'p1', name: 'Trà Đá' }], toppings: [], ingredientCosts: {} }
        const { plan, blockingErrors } = resolveImportPlan(parsed({
            recipes: [{ 'Tên món': 'Trà Đá', 'Tên nguyên liệu': 'Đá viên', 'Số lượng': 5, 'Đơn vị': 'viên' }],
        }), existing)
        expect(blockingErrors).toEqual([])
        expect(plan.ingredients).toEqual([{ key: 'đá_viên', unitCost: 0, unit: 'viên', category: 'main' }])
    })

    it('gom Topping áp dụng món theo topping thay vì tạo 1 dòng/liên kết', () => {
        const existing = { products: [{ id: 'p1', name: 'Trà Sữa' }, { id: 'p2', name: 'Cà Phê Đen' }], toppings: [{ id: 't1', name: 'Trân Châu' }], ingredientCosts: {} }
        const { plan, blockingErrors } = resolveImportPlan(parsed({
            toppingLinks: [
                { 'Tên topping': 'Trân Châu', 'Tên món': 'Trà Sữa' },
                { 'Tên topping': 'Trân Châu', 'Tên món': 'Cà Phê Đen' },
            ],
        }), existing)
        expect(blockingErrors).toEqual([])
        expect(plan.toppingLinks).toEqual([{ toppingName: 'Trân Châu', productNames: ['Trà Sữa', 'Cà Phê Đen'] }])
    })

    it('map Loại về đúng 2 giá trị main/packaging, không bao giờ trả về tools', () => {
        const { plan } = resolveImportPlan(parsed({
            ingredients: [
                { 'Tên nguyên liệu': 'Ly nhựa', 'Đơn vị': 'cái', 'Giá vốn/đơn vị': 500, 'Loại': 'Bao bì' },
                { 'Tên nguyên liệu': 'Đường', 'Đơn vị': 'g', 'Giá vốn/đơn vị': 20, 'Loại': 'tools' },
                { 'Tên nguyên liệu': 'Sữa', 'Đơn vị': 'ml', 'Giá vốn/đơn vị': 30, 'Loại': '' },
            ],
        }), EMPTY_EXISTING)
        expect(plan.ingredients.map(i => i.category)).toEqual(['packaging', 'packaging', 'main'])
    })
})
