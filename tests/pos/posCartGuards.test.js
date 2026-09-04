// POS (dine_in) — 2 guard rút ra từ src/contexts/POSContext.jsx, khoá lại 2 bug đã xảy ra
// thật (xem comment tại nguồn).

import { describe, it, expect } from 'vitest'
import { cartBelongsToAddress, shouldRestoreCartOnFailure } from '../../src/utils/posCartGuards'

// Kịch bản 1: đổi chi nhánh giữa chừng — giỏ/bàn của chi nhánh cũ không được sống sang
// chi nhánh mới. Đổi chi nhánh qua /addresses unmount+mount lại POSProvider hoàn toàn, nên
// chỉ có dấu địa chỉ ghi kèm giỏ trong localStorage (STORAGE_KEYS.CART_ADDRESS) để phân
// biệt — sai ở đây là đơn tiếp theo ghi nhầm vào SAI địa chỉ.
describe('cartBelongsToAddress', () => {
    it('cùng địa chỉ đã đóng dấu → cho khôi phục giỏ', () => {
        expect(cartBelongsToAddress('addr-1', 'addr-1')).toBe(true)
    })

    it('đổi sang địa chỉ khác → KHÔNG khôi phục giỏ của địa chỉ cũ', () => {
        expect(cartBelongsToAddress('addr-1', 'addr-2')).toBe(false)
    })

    it('chưa từng đóng dấu (cài mới / xoá localStorage) → không khôi phục', () => {
        expect(cartBelongsToAddress(null, 'addr-1')).toBe(false)
    })

    it('chưa chọn địa chỉ nào (addressId null) → không chặn, để state mặc định rỗng chạy', () => {
        expect(cartBelongsToAddress('addr-1', null)).toBe(true)
    })
})

// Kịch bản 2: submit lỗi THẬT (không phải mất mạng) sau khi handleConfirm đã dọn giỏ —
// phải trả giỏ về để nhân viên bấm lại, nhưng KHÔNG được đè lên đợt mới nếu nhân viên đã
// bắt đầu gọi món tiếp trong lúc đợi response.
describe('shouldRestoreCartOnFailure', () => {
    it('dineIn + giỏ đang trống (chưa gọi gì thêm) → khôi phục đợt vừa gửi hỏng', () => {
        expect(shouldRestoreCartOnFailure(true, 0)).toBe(true)
    })

    it('dineIn nhưng nhân viên đã gọi món mới trong lúc chờ → KHÔNG đè lên đợt mới', () => {
        expect(shouldRestoreCartOnFailure(true, 1)).toBe(false)
    })

    it('không phải dineIn (mang đi) → không khôi phục, đường 1-chạm không dùng cơ chế này', () => {
        expect(shouldRestoreCartOnFailure(false, 0)).toBe(false)
    })
})
