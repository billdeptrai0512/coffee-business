// Tồn kho — guest ingredient service, parity đổi tên key với localRepository.
// Nguồn: src/services/ingredientStockService.ts + src/services/restockService.ts

import { describe, it, expect, beforeEach } from 'vitest'
import * as repo from '../../src/services/localRepository'
import * as ingredientService from '../../src/services/orderService'

function installLocalStorage() {
    const store = new Map()
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)) },
        removeItem: (k) => { store.delete(k) },
        clear: () => { store.clear() },
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size },
    }
    return store
}

const ADDR = 'addr-1'

beforeEach(() => {
    installLocalStorage()
    repo.setIsGuest(true)
})

describe('Guest Ingredient Service', () => {
    it('fetchIngredientStocks filters out cancelled refills from anchor', async () => {
        // Seed some refills
        const now = Date.now()
        
        // Refill 1 (earlier): valid, after_stock = 10
        repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 1000,
            metadata: { ingredient: 'milk', qty: 2, after_stock: 10, before_stock: 8 },
            created_at: new Date(now - 10000).toISOString()
        })
        
        // Refill 2 (later, but cancelled): after_stock = 15, should be skipped
        repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 0,
            metadata: { ingredient: 'milk', qty: 0, after_stock: 15, before_stock: 10, cancelled: true },
            created_at: new Date(now - 5000).toISOString()
        })

        // Fetch stocks using fallback
        const stocks = await ingredientService.fetchIngredientStocks(ADDR)
        const milk = stocks.find(s => s.ingredient === 'milk')
        expect(milk).toBeDefined()
        // anchor should be 10, not 15
        expect(milk.warehouse_stock).toBe(10)
    })

    it('fetchIngredientWithdrawals filters out cancelled refills from replay', async () => {
        const now = Date.now()
        
        // Refill 1 (earlier): valid
        repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 1000,
            metadata: { ingredient: 'milk', qty: 2, after_stock: 10, before_stock: 8 },
            created_at: new Date(now - 10000).toISOString()
        })
        
        // Refill 2 (cancelled): should be ignored
        repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 0,
            metadata: { ingredient: 'milk', qty: 0, after_stock: 15, before_stock: 10, cancelled: true },
            created_at: new Date(now - 8000).toISOString()
        })

        // Shift closing (withdrawal)
        repo.upsertLocalShiftClosing({
            address_id: ADDR,
            inventory_report: [{ ingredient: 'milk', remaining: 8, restock: 2 }],
            created_at: new Date(now - 2000).toISOString()
        })

        const withdrawals = await ingredientService.fetchIngredientWithdrawals(
            ADDR,
            'milk',
            new Date(now - 20000).toISOString(),
            new Date(now + 10000).toISOString()
        )
        // Only 1 withdrawal event (since refills are not returned directly in withdrawals,
        // but they establish the starting warehouse value for the replay).
        expect(withdrawals).toHaveLength(1)
        // With Refill 2 cancelled, we start at Refill 1 (10). Then we subtract restock 2 -> ending stock should be 8.
        expect(withdrawals[0].before_stock).toBe(10)
        expect(withdrawals[0].after_stock).toBe(8)
    })

    it('processIngredientRestock backdate cascades after_stock to subsequent entries', async () => {
        const now = Date.now()
        const dateLater = new Date(now + 10000).toISOString()
        const dateEarlier = new Date(now - 10000).toISOString()

        // 1. Insert a "later" refill
        const laterInvoice = repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 1000,
            metadata: { ingredient: 'milk', qty: 2, before_stock: 5, after_stock: 7 },
            created_at: dateLater
        })

        // 2. Perform a backdated restock of qty=3
        await ingredientService.processIngredientRestock(
            ADDR,
            'milk',
            3,      // qty
            'Staff',// staffName
            { subtotal: 1500, purchaseDate: dateEarlier }
        )

        // 3. The later refill should have cascade +3 added to before_stock and after_stock
        const updatedLater = repo.fetchAllLocalExpenses(ADDR).find(e => e.id === laterInvoice.id)
        expect(updatedLater.metadata.before_stock).toBe(8) // 5 + 3
        expect(updatedLater.metadata.after_stock).toBe(10) // 7 + 3
    })

    it('cancelRestock cascades after_stock to subsequent entries and nullifies targets snapshot', async () => {
        const now = Date.now()
        const date1 = new Date(now - 10000).toISOString()
        const date2 = new Date(now).toISOString()

        // 1. Refill to cancel (qty = 4)
        const refill1 = repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 2000,
            metadata: { ingredient: 'milk', qty: 4, before_stock: 2, after_stock: 6 },
            created_at: date1
        })

        // 2. Subsequent refill (qty = 2)
        const refill2 = repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 1000,
            metadata: { ingredient: 'milk', qty: 2, before_stock: 6, after_stock: 8 },
            created_at: date2
        })

        // 3. Cancel refill 1
        await ingredientService.cancelRestock(ADDR, refill1.id, 'Staff')

        // 4. Verify refill 1 is updated (amount=0, qty=0, cancelled=true, snapshot properties deleted)
        const cancelled = repo.fetchAllLocalExpenses(ADDR).find(e => e.id === refill1.id)
        expect(cancelled.amount).toBe(0)
        expect(cancelled.metadata.qty).toBe(0)
        expect(cancelled.metadata.cancelled).toBe(true)
        expect(cancelled.metadata.after_stock).toBeUndefined()
        expect(cancelled.metadata.before_stock).toBeUndefined()

        // 5. Verify refill 2 has cascaded -4 (was 6 -> 2, was 8 -> 4)
        const updatedRefill2 = repo.fetchAllLocalExpenses(ADDR).find(e => e.id === refill2.id)
        expect(updatedRefill2.metadata.before_stock).toBe(2)
        expect(updatedRefill2.metadata.after_stock).toBe(4)
    })

    it('editIngredientRestock cascades quantity delta to subsequent entries', async () => {
        const now = Date.now()
        const date1 = new Date(now - 10000).toISOString()
        const date2 = new Date(now).toISOString()

        // 1. Refill to edit (qty = 4 -> will change to 6, delta = +2)
        const refill1 = repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 2000,
            metadata: { ingredient: 'milk', qty: 4, before_stock: 2, after_stock: 6 },
            created_at: date1
        })

        // 2. Subsequent refill (qty = 2)
        const refill2 = repo.insertLocalExpense({
            address_id: ADDR,
            is_refill: true,
            amount: 1000,
            metadata: { ingredient: 'milk', qty: 2, before_stock: 6, after_stock: 8 },
            created_at: date2
        })

        // 3. Edit refill 1 to qty = 6 (subtotal=3000)
        await ingredientService.editIngredientRestock(ADDR, refill1.id, {
            qty: 6,
            subtotal: 3000,
            staffName: 'Staff'
        })

        // 4. Verify refill 1 updated (qty=6, after_stock=8)
        const updatedRefill1 = repo.fetchAllLocalExpenses(ADDR).find(e => e.id === refill1.id)
        expect(updatedRefill1.metadata.qty).toBe(6)
        expect(updatedRefill1.metadata.after_stock).toBe(8)

        // 5. Verify refill 2 has cascaded +2 delta (before_stock 6 -> 8, after_stock 8 -> 10)
        const updatedRefill2 = repo.fetchAllLocalExpenses(ADDR).find(e => e.id === refill2.id)
        expect(updatedRefill2.metadata.before_stock).toBe(8)
        expect(updatedRefill2.metadata.after_stock).toBe(10)
    })
})
