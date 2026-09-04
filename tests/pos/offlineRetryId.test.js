// POS — addPendingOrder: id giữ nguyên qua mọi lần retry offline.
// Nguồn: src/hooks/useOfflineSync.js
//
// Kịch bản 3: mất mạng lúc gửi đơn (POSContext.doSubmit) → orderId đã sinh sẵn TRƯỚC khi
// gọi RPC được truyền thẳng vào addPendingOrder, không phải sinh mới. syncPending sau đó
// resend đúng object đã lưu (nguyên id) — nếu server thực ra đã nhận đơn trước khi mất kết
// nối phản hồi, ON CONFLICT DO NOTHING ở bulk_create_orders làm retry thành no-op thay vì
// tạo thêm một đơn trùng. Sai ở đây (sinh id mới mỗi lần) là thu tiền/trừ kho hai lần cho
// đúng một ly khách gọi.

import { describe, it, expect, beforeEach } from 'vitest'
import { addPendingOrder, getPendingOrders, removePendingOrder } from '../../src/hooks/useOfflineSync'

// vitest `node` env has no localStorage; install an in-memory shim per test.
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
}

beforeEach(() => { installLocalStorage() })

describe('addPendingOrder — id ổn định qua retry', () => {
    it('giữ đúng id đã sinh lúc gửi online lần đầu (không tự sinh id mới)', () => {
        const orderId = 'a1b2c3d4-0000-0000-0000-000000000000'
        addPendingOrder([{ productId: 'p1', quantity: 1 }], 30000, null, 'addr-1', 6000, 'Khách', 0, orderId, null)

        const pending = getPendingOrders()
        expect(pending).toHaveLength(1)
        expect(pending[0].id).toBe(orderId)
    })

    it('hàng chờ giữ nguyên id qua nhiều lần đọc — mỗi vòng syncPending đọc lại từ localStorage, không sinh lại id', () => {
        const orderId = 'a1b2c3d4-0000-0000-0000-000000000001'
        addPendingOrder([{ productId: 'p1', quantity: 1 }], 30000, null, 'addr-1', 6000, 'Khách', 0, orderId, null)

        // syncPending gọi getPendingOrders() mỗi vòng retry, KHÔNG gọi lại addPendingOrder —
        // giả lập 2 vòng đọc liên tiếp (lần 1 mất mạng, lần 2 thử lại) để chắc hàng đã lưu
        // không đổi id giữa các lần.
        const firstAttempt = getPendingOrders()[0].id
        const secondAttempt = getPendingOrders()[0].id

        expect(firstAttempt).toBe(orderId)
        expect(secondAttempt).toBe(orderId)
    })

    it('id=null (offline ngay từ đầu, chưa từng gửi online) → tự sinh id mới, không throw', () => {
        addPendingOrder([{ productId: 'p1', quantity: 1 }], 30000, null, 'addr-1', 6000, 'Khách', 0, null, null)

        const pending = getPendingOrders()
        expect(pending).toHaveLength(1)
        expect(typeof pending[0].id).toBe('string')
        expect(pending[0].id.length).toBeGreaterThan(0)
    })

    it('removePendingOrder xoá đúng hàng theo createdAt sau khi sync thành công', () => {
        const orderId = 'a1b2c3d4-0000-0000-0000-000000000002'
        addPendingOrder([{ productId: 'p1', quantity: 1 }], 30000, null, 'addr-1', 6000, 'Khách', 0, orderId, null)
        const [saved] = getPendingOrders()

        removePendingOrder(saved.createdAt)

        expect(getPendingOrders()).toHaveLength(0)
    })
})
