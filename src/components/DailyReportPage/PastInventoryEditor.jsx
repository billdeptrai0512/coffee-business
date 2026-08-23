import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildIngredientToProduct, calculateEstimatedConsumption, calculateConsumptionBreakdown } from '../../utils/inventory'
import { getIngredientUnit, ingredientLabel } from '../../utils/ingredients'
import { norm } from '../../utils/fieldSync'
import InventoryReportCard from './InventoryReportCard'

// Hằng số ổn định ref — để IngredientRow (memo) không re-render mọi dòng mỗi keystroke.
const EMPTY = {}
const NOOP = () => {}

// Sửa tồn của 1 NGÀY QUÁ KHỨ bằng CHÍNH editor của hôm nay (InventoryReportCard) để UI đồng
// nhất — nhưng KHÓA Đầu kỳ + Nhập thêm (lockWarehouseInputs), chỉ cho sửa "Cuối kỳ" (remaining):
// fix khi kết ca nhập sai làm hao hụt/lợi nhuận ngày đó sai, mà không đụng kho tổng hiện tại.
//
// ponytail: usedMap/breakdown/ingredientToProduct tính lại tại đây từ orders của ngày đó (các
// memo trong DailyReportPage đều gate `!isTodayScope → []`).
export default function PastInventoryEditor({
    shiftClosing,
    yesterdayClosing,
    dayOrders = [],
    recipes,
    extraIngredients,
    products = [],
    productExtras = {},
    ingredientUnits = {},
    ingredientsList = [],
    isLoading = false,
    isSaving = false,
    onSave,                  // async (newInventoryReport) => boolean (true = đã lưu). null → read-only.
    onDirtyChange,           // (dirty, lines) => void — báo cha để guard rời trang khi sửa chưa lưu
}) {
    // Không có onSave (staff, hoặc ngày không có phiếu chốt để UPDATE) → xem-only.
    const readOnly = typeof onSave !== 'function'
    const [open, setOpen] = useState(true)

    const orderItems = useMemo(() => {
        const items = []
        dayOrders.filter(o => !o.deleted_at && !o.deletedAt).forEach(o => {
            (o.order_items || o.orderItems || o.cart || []).forEach(i => items.push({
                productId: i.product_id || i.productId,
                qty: i.quantity || i.qty || 1,
                extras: i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || []),
            }))
        })
        return items
    }, [dayOrders])

    const usedMap = useMemo(
        () => calculateEstimatedConsumption(orderItems, recipes, extraIngredients),
        [orderItems, recipes, extraIngredients],
    )
    const consumptionBreakdown = useMemo(
        () => calculateConsumptionBreakdown(orderItems, recipes, extraIngredients, products, productExtras),
        [orderItems, recipes, extraIngredients, products, productExtras],
    )
    const ingredientToProduct = useMemo(
        () => buildIngredientToProduct({ orderItems, recipes, products }),
        [recipes, products, orderItems],
    )

    // Đầu kỳ hiển thị (read-only): tồn cuối hôm qua, đè bởi item.opening nếu phiếu có lưu.
    const openingStock = useMemo(() => {
        const map = {}
        ;(yesterdayClosing?.inventory_report || []).forEach(it => { map[it.ingredient] = it.remaining || 0 })
        ;(shiftClosing?.inventory_report || []).forEach(it => { if (it.opening != null) map[it.ingredient] = it.opening })
        return map
    }, [shiftClosing, yesterdayClosing])

    // Map read-only Đầu kỳ / Nhập thêm từ phiếu của ngày đó.
    const { openingInputs, openingLocked, restockInputs, seedRemaining } = useMemo(() => {
        const o = {}, ol = {}, r = {}, rem = {}
        ;(shiftClosing?.inventory_report || []).forEach(it => {
            if (typeof it.opening === 'number') o[it.ingredient] = String(it.opening)
            if (it.opening_locked) ol[it.ingredient] = true
            if (typeof it.restock === 'number') r[it.ingredient] = String(it.restock)
            if (typeof it.remaining === 'number') rem[it.ingredient] = String(it.remaining)
        })
        return { openingInputs: o, openingLocked: ol, restockInputs: r, seedRemaining: rem }
    }, [shiftClosing])

    // Chỉ "Cuối kỳ" (remaining) sửa được. Reset khi đổi phiếu/ngày (reset-trong-render pattern).
    const [remainingInputs, setRemainingInputs] = useState(seedRemaining)
    const prevIdRef = useRef(shiftClosing?.id)
    const [version, setVersion] = useState(0)
    if (prevIdRef.current !== shiftClosing?.id) {
        prevIdRef.current = shiftClosing?.id
        setRemainingInputs(seedRemaining)
        setVersion(v => v + 1)
    }

    // Các dòng "NVL · Cuối kỳ: cũ → mới" — vừa làm cờ dirty, vừa cho confirm rời trang liệt kê.
    const dirtyLines = useMemo(() => {
        const lines = []
        const keys = new Set([...Object.keys(seedRemaining), ...Object.keys(remainingInputs)])
        for (const k of keys) {
            if (norm(seedRemaining[k]) !== norm(remainingInputs[k]))
                lines.push(`${ingredientLabel(k)} · Cuối kỳ: ${norm(seedRemaining[k]) ?? '(trống)'} → ${norm(remainingInputs[k]) ?? '(trống)'}`)
        }
        return lines
    }, [seedRemaining, remainingInputs])
    const hasEdits = dirtyLines.length > 0

    // Báo cha trạng thái dirty để guardLeave cảnh báo trước khi đổi ngày/rời trang.
    useEffect(() => { onDirtyChange?.(hasEdits, dirtyLines) }, [hasEdits, dirtyLines, onDirtyChange])

    const baselineInputs = useMemo(
        () => ({ opening: openingInputs, openingLocked, restock: restockInputs, inventory: seedRemaining }),
        [openingInputs, openingLocked, restockInputs, seedRemaining],
    )

    const handleSave = async () => {
        const origByIng = {}
        ;(shiftClosing?.inventory_report || []).forEach(it => { origByIng[it.ingredient] = it })
        const keys = new Set([...Object.keys(origByIng), ...Object.keys(remainingInputs)])
        const report = []
        for (const ing of keys) {
            const orig = origByIng[ing]
            const rv = remainingInputs[ing]
            const remaining = (rv === undefined || rv === '' || isNaN(Number(rv)))
                ? (orig?.remaining ?? null)
                : Number(rv)
            if (orig) {
                report.push({ ...orig, remaining })
            } else if (remaining != null) {
                // NVL chưa từng đếm cuối ca, giờ thêm số → chỉ lưu remaining; Đầu kỳ suy ra lúc đọc.
                report.push({ ingredient: ing, unit: getIngredientUnit(ing, undefined, ingredientUnits), remaining })
            }
        }
        const ok = await onSave?.(report)
        if (ok) setVersion(v => v + 1)   // remount rows → collapse; baseline tự khớp số mới đã lưu
    }

    const handleInventoryChange = useCallback(
        (ing, v) => setRemainingInputs(prev => ({ ...prev, [ing]: v })),
        [],
    )

    // Ngày cũ không có phiếu chốt: read-only mà không có gì để đọc → ẩn hẳn thay vì
    // bày bảng trống toàn NVL (ingredientsList là danh sách của hôm nay).
    if (readOnly && !shiftClosing?.inventory_report?.length) return null

    return (
        <div className="flex flex-col gap-3">
            <InventoryReportCard
                ingredientsList={ingredientsList}
                isLoading={isLoading}
                openingStock={openingStock}
                openingInputs={openingInputs}
                openingLocked={openingLocked}
                restockInputs={restockInputs}
                inventoryInputs={remainingInputs}
                warehouseStocks={EMPTY}
                ingredientUnits={ingredientUnits}
                usedMap={usedMap}
                consumptionBreakdown={consumptionBreakdown}
                ingredientToProduct={ingredientToProduct}
                isSubmitting={isSaving}
                readOnly={readOnly}
                lockWarehouseInputs={true}
                baselineInputs={baselineInputs}
                baselineVersion={version}
                open={open}
                onToggleOpen={() => setOpen(o => !o)}
                onOpeningChange={NOOP}
                onRestockChange={NOOP}
                onInventoryChange={handleInventoryChange}
            />

            {!readOnly && hasEdits && (
                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-primary text-black rounded-[12px] px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {isSaving ? 'Đang lưu...' : 'Lưu tồn cuối ca'}
                    </button>
                </div>
            )}
        </div>
    )
}
