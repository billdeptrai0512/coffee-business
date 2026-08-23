import { useEffect, useMemo, useState } from 'react'
import {
    attachRepeatHistory, buildDailyHaoHutMap, buildDayCandidateSets,
    computeHaoHut, computeIngredientNoise, findMissingCupCandidates,
} from '../utils/inventory'
import { lookupByLabel } from '../utils/ingredients'
import { dedupeShiftClosingsByDay } from '../utils/reportStats'
import { startOfDayVN } from '../utils/dateVN'
import { fetchReportByRange } from '../services/orderService'

const EMPTY_HISTORY = { shiftClosings: [], orders: [], addressId: null }

// PROTOTYPE — nghi vấn "pha bán nhưng chưa bấm bill", nuôi MissingCupSuspicionCard.
// Toàn bộ chuỗi 5 memo + fetch 14 ngày của tính năng này nằm gọn ở đây thay vì rải
// giữa DailyReportPage; page chỉ còn 1 dòng gọi hook.
//
// `enabled` do caller gộp sẵn: chỉ chạy khi đang xem HÔM NAY, ở tab có card, và
// KHÔNG phải staff — card này soi nghi vấn chính nhân viên, để staff tự thấy kết quả
// soi mình vừa vô nghĩa (biết bị phát hiện thì né) vừa tạo cảm giác bị theo dõi cho
// người trong sạch. Cùng nguyên tắc với tab "Lợi nhuận" đã ẩn khỏi staff.
export function useMissingCupSuspicion({
    enabled, addressId,
    ingredientsList, inventoryInputs, restockInputs, openingInputs, openingStock,
    usedMap, recipes, extraIngredients, products,
}) {
    // 14 ngày gần đây (KHÔNG gồm hôm nay) chỉ để dò "lặp lại nhiều ngày" — xem
    // attachRepeatHistory. Tách riêng khỏi useDailyReportData vì hook đó chỉ fetch
    // range khi user đang XEM scope tuần/tháng, còn card này cần cả khi xem "Hôm nay".
    const [fetched, setFetched] = useState(EMPTY_HISTORY)
    useEffect(() => {
        if (!enabled || !addressId) return
        let alive = true
        const end = startOfDayVN(new Date()) // đầu ngày hôm nay = mốc kết thúc window (loại hôm nay)
        const start = new Date(end.getTime() - 14 * 86_400_000)
        fetchReportByRange(addressId, start.toISOString(), end.toISOString(), start.toISOString(), start.toISOString())
            .then(data => {
                if (!alive) return
                setFetched({
                    addressId,
                    shiftClosings: dedupeShiftClosingsByDay(data?.target_shift_closings || []),
                    orders: data?.target_orders || [],
                })
            })
            .catch(() => { if (alive) setFetched(EMPTY_HISTORY) })
        return () => { alive = false }
    }, [enabled, addressId])

    // Lọc ở chỗ đọc thay vì setState(EMPTY) trong effect: tắt/đổi chi nhánh là hết dữ
    // liệu ngay trong CÙNG render, không có nhịp hiển thị lịch sử của chi nhánh cũ.
    const history = enabled && fetched.addressId === addressId ? fetched : EMPTY_HISTORY

    // Hao hụt hôm nay theo từng nguyên liệu (cùng công thức computeHaoHut dùng trong
    // InventoryReportCard) — đổi theo từng phím gõ của nhân viên.
    const haoHutByIngredient = useMemo(() => {
        const map = {}
        for (const ing of ingredientsList || []) {
            map[ing.ingredient] = computeHaoHut({
                inventoryValue: inventoryInputs[ing.ingredient],
                restockValue: restockInputs[ing.ingredient],
                openingValue: openingInputs[ing.ingredient],
                openingFallback: openingStock[ing.ingredient],
                used: lookupByLabel(ing.ingredient, usedMap),
            })
        }
        return map
    }, [ingredientsList, inventoryInputs, restockInputs, openingInputs, openingStock, usedMap])

    const historicalDailyHaoHut = useMemo(
        () => buildDailyHaoHutMap({
            shiftClosings: history.shiftClosings, orders: history.orders,
            recipes, extraIngredients,
        }),
        [history, recipes, extraIngredients],
    )

    // Độ nhiễu tự nhiên/nguyên liệu suy ra từ lịch sử 14 ngày, thay cho dung sai %
    // cứng dùng chung mọi nguyên liệu (xem computeIngredientNoise).
    const ingredientNoise = useMemo(() => computeIngredientNoise(historicalDailyHaoHut), [historicalDailyHaoHut])

    // 2 memo tách rời có chủ đích: phần quét 14 ngày lịch sử KHÔNG phụ thuộc ô đang gõ,
    // nên nó đứng yên suốt lúc nhân viên kiểm kê. Gộp 1 memo thì mỗi phím gõ quét lại
    // cả 14 ngày (haoHutByIngredient đổi theo từng keystroke) — lag thấy rõ trên máy yếu.
    const dayCandidateSets = useMemo(
        () => buildDayCandidateSets({ ingredientsList, historicalDailyHaoHut, recipes, products, noiseByIngredient: ingredientNoise }),
        [ingredientsList, historicalDailyHaoHut, recipes, products, ingredientNoise],
    )
    return useMemo(() => {
        const today = findMissingCupCandidates({ ingredientsList, haoHutByIngredient, recipes, products, noiseByIngredient: ingredientNoise })
        return attachRepeatHistory(today, dayCandidateSets)
    }, [ingredientsList, haoHutByIngredient, recipes, products, ingredientNoise, dayCandidateSets])
}
