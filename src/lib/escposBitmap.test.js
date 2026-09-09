import { describe, it, expect } from 'vitest'
import { packGSv0, bytesToHex } from './escposBitmap'

// Lưới an toàn cho thuật toán đóng gói bit (packGSv0/bytesToHex) — sai 1 chỗ ở đây chỉ lộ
// ra khi in thật ra giấy sai (không có cách nào biết trước khi build APK), nên cần 1 test
// cố định trên input biết trước tay thay vì chỉ tin bằng mắt khi đọc code.
describe('bytesToHex', () => {
    it('mã hex 2 ký tự mỗi byte, giữ số 0 đầu', () => {
        expect(bytesToHex([0, 255, 16, 171])).toBe('00ff10ab')
    })
})

describe('packGSv0', () => {
    it('đóng đúng header GS v 0 + bit ảnh 8x1, 2 pixel đầu đen', () => {
        // 8 pixel, RGBA mỗi pixel — 2 pixel đầu đen (< BLACK_THRESHOLD), còn lại trắng.
        const data = new Uint8ClampedArray(8 * 4).fill(255)
        data.set([0, 0, 0, 255], 0)
        data.set([0, 0, 0, 255], 4)
        const out = packGSv0({ data }, 8, 1)

        // Header GS v 0: 1D 76 30 00, rồi bytesPerLine (2 byte LE), heightPx (2 byte LE).
        expect(Array.from(out.slice(0, 8))).toEqual([0x1D, 0x76, 0x30, 0x00, 1, 0, 1, 0])
        // 1 byte dữ liệu: bit7=pixel0 (đen), bit6=pixel1 (đen), còn lại 0 → 0b11000000.
        expect(out[8]).toBe(0b11000000)
    })
})
