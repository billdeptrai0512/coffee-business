// POS (dine_in) — tính bàn thuần (không I/O) rút ra từ src/contexts/POSContext.jsx:
// handleCloseTable (dropTableByName/restoreTable) và moveTableRounds (moveRoundsIntoTable).
// Nguồn: src/services/orderService.ts

import { describe, it, expect } from 'vitest'
import { dropTableByName, restoreTable, moveRoundsIntoTable } from '../../src/services/orderService'

const table = (name, rounds) => ({
    name,
    total: rounds.reduce((s, r) => s + r.total, 0),
    rounds,
    openedAt: rounds[0]?.createdAt ?? null,
    lines: rounds.reduce((ls, r) => [...ls, ...r.lines], []),
})

const round = (id, over = {}) => ({
    id, orderNo: null, createdAt: '2026-08-13T10:00:00Z', total: 30000, discountAmount: 0,
    servedAt: null, staffName: null, lines: [{ name: 'Trà đá', qty: 1 }], items: [], ...over,
})

describe('dropTableByName / restoreTable — tính tiền bàn + hoàn tác', () => {
    it('drop bỏ đúng bàn theo tên, giữ nguyên các bàn khác', () => {
        const tables = [table('Bàn 1', [round('r1')]), table('Bàn 2', [round('r2')])]
        expect(dropTableByName(tables, 'Bàn 1')).toEqual([table('Bàn 2', [round('r2')])])
    })

    it('restore thêm lại đúng bàn đã lưu trước lúc đóng', () => {
        const remaining = [table('Bàn 2', [round('r2')])]
        const closed = table('Bàn 1', [round('r1')])
        expect(restoreTable(remaining, closed)).toEqual([table('Bàn 2', [round('r2')]), closed])
    })

    it('restore idempotent — bàn đã có mặt lại (vd refreshTables chạy xen giữa) thì KHÔNG thêm trùng', () => {
        const closed = table('Bàn 1', [round('r1')])
        const alreadyBack = [table('Bàn 2', [round('r2')]), closed]
        expect(restoreTable(alreadyBack, closed)).toBe(alreadyBack)
    })
})

describe('moveRoundsIntoTable — gộp/tách bàn', () => {
    it('chuyển 1 đợt sang bàn ĐÃ có khách → cộng dồn total/lines, giữ nguyên openedAt của bàn đích', () => {
        const src = table('Bàn 1', [round('r1', { total: 30000 })])
        const dest = table('Bàn 2', [round('r2', { total: 20000, createdAt: '2026-08-13T09:00:00Z' })])
        const { nextTables, moved } = moveRoundsIntoTable([src, dest], new Set(['r1']), 'Bàn 2')

        expect(moved.map(r => r.id)).toEqual(['r1'])
        // Bàn 1 hết đợt → biến mất khỏi lưới; Bàn 2 cộng dồn.
        expect(nextTables).toEqual([{
            name: 'Bàn 2',
            total: 50000,
            rounds: [round('r2', { total: 20000, createdAt: '2026-08-13T09:00:00Z' }), round('r1', { total: 30000 })],
            openedAt: '2026-08-13T09:00:00Z',
            lines: [{ name: 'Trà đá', qty: 2 }],
        }])
    })

    it('chuyển vào bàn CHƯA có khách (tên mới, hoặc "Mang đi") → openedAt lấy đợt SỚM NHẤT trong các đợt vừa chuyển', () => {
        const src = table('Bàn 1', [
            round('r1', { total: 30000, createdAt: '2026-08-13T10:00:00Z' }),
            round('r2', { total: 20000, createdAt: '2026-08-13T08:00:00Z' }), // tới trước r1
        ])
        const { nextTables } = moveRoundsIntoTable([src], new Set(['r1', 'r2']), 'Bàn mới')

        expect(nextTables).toHaveLength(1)
        expect(nextTables[0].name).toBe('Bàn mới')
        expect(nextTables[0].openedAt).toBe('2026-08-13T08:00:00Z')
    })

    it('tách 1 đợt khỏi bàn nhiều đợt → bàn nguồn vẫn còn (không biến mất), chỉ mất đúng đợt đó', () => {
        const src = table('Bàn 1', [round('r1', { total: 30000 }), round('r2', { total: 20000 })])
        const { nextTables } = moveRoundsIntoTable([src], new Set(['r1']), 'Bàn 2')

        const bàn1 = nextTables.find(t => t.name === 'Bàn 1')
        expect(bàn1.rounds.map(r => r.id)).toEqual(['r2'])
        expect(bàn1.total).toBe(20000)
    })

    it('orderIds không khớp round nào trong state hiện có (máy khác vừa đổi) → moved rỗng, trả NGUYÊN prevTables để người gọi tự fallback gọi mạng', () => {
        const src = table('Bàn 1', [round('r1')])
        const prevTables = [src]
        const { nextTables, moved } = moveRoundsIntoTable(prevTables, new Set(['round-khong-ton-tai']), 'Bàn 2')

        expect(moved).toEqual([])
        expect(nextTables).toBe(prevTables)
    })

    it('chuyển thành "Mang đi" (targetName=null) — null là đích hợp lệ, không phải "chưa chọn"', () => {
        const src = table('Bàn 1', [round('r1')])
        const { nextTables } = moveRoundsIntoTable([src], new Set(['r1']), null)

        expect(nextTables[0].name).toBeNull()
    })
})
