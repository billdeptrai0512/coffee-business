import { Fragment, memo, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ClipboardList, Info } from 'lucide-react'
import { ingredientLabel, getIngredientUnit, lookupByLabel } from '../../utils/ingredients'
import { formatPackedQty, computeHaoHut, r1 } from '../../utils/inventory'
import { formatVND } from '../../utils'
import { onboardingHintClass } from '../../utils/onboardingHint'
import CollapsibleCard from './CollapsibleCard'

// Status priority for sorting collapsed list. Lower = render earlier.
// Chưa nhập first (needs action), then anomalies (Hụt/Dư), then Khớp (done).
const STATUS_PRIORITY = { pending: 0, loss: 1, excess: 2, match: 3 }

function computeRowStatus(args) {
    const haoHut = computeHaoHut(args)
    if (haoHut == null) return 'pending'
    if (haoHut === 0) return 'match'
    if (haoHut < 0) return 'loss'
    return 'excess'
}

// Per-ingredient layout (counter-side only — Tồn kho tách ra ngoài):
//   row 1 (inputs):  Đầu kỳ    |  Nhập thêm (col-span 2)
//   row 2:           Đã bán    |  Sử dụng (col-span 2)
//   row 3 (audit):   Chênh lệch|  Lý thuyết   |  Cuối kỳ (input, = Thực tế)
//
// Staff inputs: Đầu kỳ, Nhập thêm, Cuối kỳ. Everything else is computed and disabled.
// Audit math:
//   Thực tế   = Cuối kỳ                       (đếm vật lý tại quầy)
//   Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng  (lượng dự kiến còn tại quầy)
//   Hao hụt   = Thực tế − Lý thuyết           (âm = thiếu, dương = dư, 0 = khớp)
export default function InventoryReportCard({
    ingredientsList, isLoading,
    openingStock, openingInputs, openingLocked,
    restockInputs, inventoryInputs,
    warehouseStocks = {},
    ingredientUnits = {},
    usedMap = {},            // ingredient → todayEstimatedConsumption qty
    consumptionBreakdown = {}, // ingredient → { [variantKey]: { name, qty, totalAmount } } for expand-on-tap
    ingredientToProduct = {}, // ingredient → { amountPerCup, productName } for "Tương đương N ly" label
    isSubmitting,
    // Sửa lịch sử (ngày cũ): khóa Đầu kỳ + Nhập thêm read-only, chỉ cho sửa Cuối kỳ —
    // tránh đụng kho tổng (Nhập thêm nằm trong công thức warehouse anchor).
    lockWarehouseInputs = false,
    // Xem-only toàn bảng (ngày cũ, không có quyền sửa). Khác isSubmitting ở chỗ nó là
    // trạng thái VĨNH VIỄN của lượt xem → tô kiểu "khoá" như Đầu kỳ/Nhập thêm, không
    // phải kiểu "đang bận lưu" (mờ đi). lockWarehouseInputs là ca riêng của nó.
    readOnly = false,
    // Last-persisted snapshot — drives sort + collapse so live keystrokes don't
    // re-order rows while staff is mid-edit; row key includes baselineVersion so
    // every row remounts (→ collapses) right after a successful save.
    baselineInputs, baselineVersion = 0,
    open = true, onToggleOpen,
    onOpeningChange, onRestockChange, onInventoryChange,
    // Nguyên liệu đang được onboarding phase 4 gợi ý bấm vào — xem DailyReportPage.jsx
    // (hintCoffeeIngredient) + inventoryStep.jsx.
    hintIngredient = null,
}) {
    // Sort by status priority so staff sees "Chưa nhập" first, then anomalies,
    // then matched rows at the bottom. Tie-break by display name for stability.
    //
    // Status is computed against the LAST-PERSISTED snapshot, not the live input
    // maps — otherwise typing a Cuối kỳ value would flip the row from Chưa nhập
    // → Hụt/Dư mid-keystroke and shuffle it down the list before staff finishes.
    // Falls back to live maps when no baseline is wired (older callers).
    // When baseline is wired these refs are stable across keystrokes, so the sort
    // (its only inputs) is memoized away — typing a Cuối kỳ value no longer re-runs
    // the O(n log n) comparator (each compare scans the maps via lookupByLabel).
    const sortOpening = baselineInputs?.opening ?? openingInputs
    const sortRestock = baselineInputs?.restock ?? restockInputs
    const sortInventory = baselineInputs?.inventory ?? inventoryInputs
    const sortedList = useMemo(() => [...ingredientsList].sort((a, b) => {
        const sa = computeRowStatus({
            inventoryValue: sortInventory[a.ingredient],
            restockValue: sortRestock[a.ingredient],
            warehouseAvailable: warehouseStocks[a.ingredient],
            openingValue: sortOpening[a.ingredient],
            openingFallback: openingStock[a.ingredient],
            used: lookupByLabel(a.ingredient, usedMap),
        })
        const sb = computeRowStatus({
            inventoryValue: sortInventory[b.ingredient],
            restockValue: sortRestock[b.ingredient],
            warehouseAvailable: warehouseStocks[b.ingredient],
            openingValue: sortOpening[b.ingredient],
            openingFallback: openingStock[b.ingredient],
            used: lookupByLabel(b.ingredient, usedMap),
        })
        const pa = STATUS_PRIORITY[sa]
        const pb = STATUS_PRIORITY[sb]
        if (pa !== pb) return pa - pb
        return ingredientLabel(a.ingredient).localeCompare(ingredientLabel(b.ingredient))
    }), [ingredientsList, sortOpening, sortRestock, sortInventory, warehouseStocks, openingStock, usedMap])

    // Tổng giá trị hao hụt — sum |Hao hụt × unit_cost| over rows that came up short,
    // computed against LIVE inputs so the header summary tracks what staff is counting now.
    // countedCount (số NVL đã nhập Cuối kỳ) đi kèm luôn — cùng vòng lặp, cùng deps.
    // useMemo vì card này KHÔNG memo: mọi re-render của trang (gõ tiền mặt, tick chi phí…)
    // vốn chạy lại cả vòng lặp lookupByLabel này dù không có gì đổi.
    const { totalLossValue, countedCount } = useMemo(() => {
        let loss = 0
        let counted = 0
        for (const ing of sortedList) {
            const v = inventoryInputs[ing.ingredient]
            if (v !== undefined && v !== '') counted++
            const haoHut = computeHaoHut({
                inventoryValue: v,
                restockValue: restockInputs[ing.ingredient],
                openingValue: openingInputs[ing.ingredient],
                openingFallback: openingStock[ing.ingredient],
                used: lookupByLabel(ing.ingredient, usedMap),
            })
            if (haoHut != null && haoHut < 0) loss += Math.abs(haoHut) * (Number(ing.unit_cost) || 0)
        }
        return { totalLossValue: loss, countedCount: counted }
    }, [sortedList, inventoryInputs, restockInputs, openingInputs, openingStock, usedMap])

    if (isLoading) {
        return (
            <div className="flex flex-col gap-3 py-4 animate-pulse">
                <div className="bg-surface-light rounded-[12px] h-8 w-1/3 mb-2" />
                <div className="bg-surface-light rounded-[20px] h-32 w-full" />
            </div>
        )
    }
    if (!ingredientsList.length) return null

    return (
        <CollapsibleCard
            icon={<ClipboardList size={15} className="text-primary shrink-0" />}
            title="Kiểm kê tồn quầy"
            count={`${countedCount}/${sortedList.length}`}
            open={open}
            onToggle={onToggleOpen}
        >
            <div className="flex flex-col">
            {sortedList.map(ing => (
                <IngredientRow
                    key={`${ing.ingredient}-${baselineVersion}`}
                    ing={ing}
                    ingredientUnits={ingredientUnits}
                    openingValue={openingInputs[ing.ingredient]}
                    openingFallback={openingStock[ing.ingredient]}
                    isLocked={openingLocked[ing.ingredient]}
                    restockValue={restockInputs[ing.ingredient]}
                    inventoryValue={inventoryInputs[ing.ingredient]}
                    warehouseAvailable={warehouseStocks[ing.ingredient]}
                    used={lookupByLabel(ing.ingredient, usedMap)}
                    breakdown={lookupByLabel(ing.ingredient, consumptionBreakdown) || null}
                    productRef={ingredientToProduct[ing.ingredient]}
                    isSubmitting={isSubmitting}
                    lockWarehouseInputs={lockWarehouseInputs}
                    readOnly={readOnly}
                    onOpeningChange={onOpeningChange}
                    onRestockChange={onRestockChange}
                    onInventoryChange={onInventoryChange}
                    hint={ing.ingredient === hintIngredient}
                />
            ))}
            </div>

            {/* Footer tổng — tiền hao hụt cộng dồn, chỉ hiện khi đã kiểm ít nhất 1 NVL. */}
            {countedCount > 0 && (
                <div className="flex items-center justify-between pt-3 mt-1 border-t border-border/40">
                    <span className="text-[14px] font-black text-text">Tổng cộng</span>
                    <span className={`text-[14px] font-black tabular-nums ${totalLossValue > 0 ? 'text-danger' : 'text-text-secondary'}`}>
                        {totalLossValue > 0 ? '-' : ''}{formatVND(Math.round(totalLossValue))}
                    </span>
                </div>
            )}
        </CollapsibleCard>
    )
}

// memo: parent re-renders on every keystroke (input state lives in the page/hook),
// but each row gets indexed primitives + stable callbacks — so only the row being
// edited re-renders instead of all ~40. Relies on ingredientUnits/usedMap/handlers
// being referentially stable (they are: page useMemo + useShiftInventoryState useCallback).
const IngredientRow = memo(function IngredientRow({
    ing, ingredientUnits, openingValue, openingFallback, isLocked, restockValue, inventoryValue,
    warehouseAvailable, used, breakdown, productRef,
    isSubmitting, lockWarehouseInputs, readOnly,
    onOpeningChange, onRestockChange, onInventoryChange,
    hint,
}) {
    // Whole-row collapse: default closed so staff can scroll the list of NVL fast and
    // open just the ones they're counting. Status badge in the header tells them
    // which rows still need "+ Cuối kỳ" input vs. already counted.
    const [open, setOpen] = useState(false)
    // Sub-expand: per-recipe consumption breakdown inside the expanded row.
    const [expanded, setExpanded] = useState(false)
    // Inline help bubble for the Lý thuyết formula — tap the (i) to toggle.
    const [showLyThuyetInfo, setShowLyThuyetInfo] = useState(false)
    const hasBreakdown = breakdown && Object.keys(breakdown).length > 0
    const toggleExpanded = () => hasBreakdown && setExpanded(e => !e)

    const unit = getIngredientUnit(ing.ingredient, ing.unit, ingredientUnits)
    const packSize = Number(ing.pack_size || 0)
    const packUnit = ing.pack_unit
    const fmt = (n) => formatPackedQty(n, packSize, packUnit, unit, { compact: true })
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')

    // Over-report detection: if staff types restock > kho tổng available, the difference
    // becomes a phantom deficit that absorbs future NHẬP KHO. Surface it inline.
    const restockNum = r1(restockValue)
    const warehouseNum = Number(warehouseAvailable || 0)
    const restockOverflow = warehouseAvailable !== undefined && restockNum > warehouseNum
    const overBy = restockOverflow ? restockNum - warehouseNum : 0

    // Live computed balances — counter-side only. Tồn kho được tách ra khỏi
    // công thức để Lý thuyết / Thực tế cùng quy chiếu về lượng đứng tại quầy.
    //   Sử dụng   = recipe-based estimated consumption
    //   Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng   (lượng dự kiến còn tại quầy)
    //   Thực tế   = Cuối kỳ                        (đếm vật lý cuối ca)
    //   Hao hụt   = Thực tế − Lý thuyết
    //               (âm = thiếu → mất hàng / công thức sai;
    //                dương = dư → nhập vượt / công thức trừ thiếu)
    const openingNum = r1(openingDisplay)
    const usedNum = r1(used)
    const hasActual = inventoryValue !== undefined && inventoryValue !== ''
    const cuoiKyNum = hasActual ? r1(inventoryValue) : null
    const lyThuyet = r1(openingNum + restockNum - usedNum)
    const haoHut = cuoiKyNum != null ? r1(cuoiKyNum - lyThuyet) : null
    const haoHutTone = haoHut == null
        ? 'neutral'
        : haoHut === 0 ? 'good' : haoHut < 0 ? 'bad' : 'warn'

    // Money value of the discrepancy = |Hao hụt| × unit_cost. Render absolute number
    // tinted by sign so the negative magnitude is implicit in the tone.
    const unitCost = Number(ing.unit_cost) || 0
    let giaTri = null
    if (haoHut != null && unitCost > 0) {
        const rawCost = Math.abs(haoHut * unitCost)
        giaTri = haoHut < 0 ? -rawCost : rawCost
    }

    // Cups-equivalent label: how many drinks of the dominant product the |Hao hụt|
    // could have made. Skips ingredients where amountPerCup is missing/1 (cup/lid passthrough).
    let tuongDuongText = '—'
    if (haoHut != null && productRef?.amountPerCup > 0 && haoHut !== 0) {
        const cups = Math.round(Math.abs(haoHut) / productRef.amountPerCup)
        if (cups > 0) tuongDuongText = `≈ ${cups} ly ${productRef.productName || ''}`.trim()
    }

    // Tổng cộng cell text: total cups across all variants that consumed this ingredient
    // today (sum of breakdown[*].qty). Variants with totalAmount === 0 (e.g. size LỚN /
    // BÌNH NHỎ that don't draw on this unit) are excluded — counting them would inflate
    // the cup total above "Sử dụng" even though they consumed nothing. Tap to expand.
    const totalCupsUsing = hasBreakdown
        ? Object.values(breakdown).reduce(
            (sum, e) => sum + ((Number(e.totalAmount) || 0) > 0 ? (Number(e.qty) || 0) : 0),
            0,
        )
        : 0
    const totalCupsText = totalCupsUsing > 0 ? `${totalCupsUsing} ly` : '—'

    // Status badge text + tone for the collapsed header.
    // 'pending' uses a quiet secondary tone — "Chưa nhập" is the default state of
    // every row before staff opens chốt ca, not a problem to flag.
    let badge
    if (!hasActual) {
        badge = { text: 'Chưa nhập', tone: 'pending' }
    } else if (haoHut === 0) {
        badge = { text: 'Khớp', tone: 'good' }
    } else if (haoHut < 0) {
        const moneyTxt = giaTri != null ? ` · ${formatVND(Math.abs(giaTri))}` : ''
        badge = { text: `Hụt ${Math.abs(haoHut)} ${unit}${moneyTxt}`, tone: 'bad' }
    } else {
        badge = { text: `Dư ${haoHut} ${unit}`, tone: 'warn' }
    }
    const badgeToneCls = {
        good: 'bg-success/10 text-success border-success/30',
        bad: 'bg-danger/10 text-danger border-danger/30',
        warn: 'bg-warning/10 text-warning border-warning/30',
        pending: 'bg-surface-light text-text-secondary border-border/60',
    }[badge.tone]

    return (
        <div className="border-b border-border/20 last:border-0">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 py-2.5 group rounded-lg"
            >
                <span className="text-[14px] font-bold text-text text-left">{ingredientLabel(ing.ingredient)}</span>
                <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border tabular-nums ${badgeToneCls} ${onboardingHintClass(hint && !open)}`}>
                        {badge.text}
                    </span>
                    {open
                        ? <ChevronUp size={14} className="text-text-dim" />
                        : <ChevronDown size={14} className="text-text-dim" />
                    }
                </div>
            </button>

            {!open ? null : (<div className="pb-3">
                {/* Row 1 — warehouse level */}
                <div className="grid grid-cols-3 gap-2">
                    <ColumnInput
                        label="Đầu kỳ"
                        value={openingDisplay}
                        unit={unit}
                        disabled={isLocked || isSubmitting || lockWarehouseInputs || readOnly}
                        onChange={(v) => onOpeningChange(ing.ingredient, v)}
                        locked={isLocked || lockWarehouseInputs || readOnly}
                    />
                    <div className="col-span-2">
                        <ColumnInput
                            label="Nhập thêm"
                            value={restockValue || ''}
                            unit={unit}
                            disabled={isSubmitting || lockWarehouseInputs || readOnly}
                            onChange={(v) => onRestockChange(ing.ingredient, v)}
                            overflow={restockOverflow}
                            locked={lockWarehouseInputs || readOnly}
                        />
                    </div>
                </div>

                {/* Row 2 — counter level */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                    <TextCell label="Đã bán" text={totalCupsText} />
                    <div className="col-span-2">
                        <TextCell
                            label="Sử dụng"
                            text={`${usedNum} ${unit}`}
                            onClick={hasBreakdown ? toggleExpanded : undefined}
                            expanded={expanded}
                        />
                    </div>

                </div>

                {expanded && hasBreakdown && (
                    <div className="mt-2 px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 flex flex-col gap-1">
                        {Object.values(breakdown)
                            .filter((e) => (Number(e.totalAmount) || 0) > 0)
                            .sort((a, b) => b.totalAmount - a.totalAmount)
                            .map((entry, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <span className="text-[11px] text-text-secondary truncate flex-1">{entry.name}</span>
                                    <span className="text-[11px] font-bold text-text-dim tabular-nums shrink-0 ml-2">
                                        {entry.qty} ly × {Math.round(entry.totalAmount / entry.qty * 10) / 10} {unit} = <span className="text-text font-black">{entry.totalAmount} {unit}</span>
                                    </span>
                                </div>
                            ))
                        }
                    </div>
                )}

                {/* Row 3 — audit: Hao hụt | Lý thuyết | Cuối kỳ (= Thực tế, gộp 1 input) */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                    <ColumnInput
                        label="Chênh lệch"
                        value={haoHut != null ? haoHut : ''}
                        unit={unit}
                        disabled
                        tone={haoHutTone}
                    />
                    <ColumnInput
                        label="Lý thuyết"
                        value={lyThuyet}
                        unit={unit}
                        disabled
                        onBoxClick={() => setShowLyThuyetInfo(s => !s)}
                    />
                    <ColumnInput
                        label="Cuối kỳ"
                        value={inventoryValue ?? ''}
                        unit={unit}
                        disabled={isSubmitting || readOnly}
                        locked={readOnly}
                        onChange={(v) => onInventoryChange(ing.ingredient, v)}
                        hint={hint && open}
                    />
                </div>
                {showLyThuyetInfo && (
                    /* Nhãn trên, số dưới — 1 hàng không wrap kể cả màn 320px */
                    <div className="mt-2 px-2 py-2 bg-surface-light rounded-[10px] border border-border/40 flex items-center justify-between gap-1 text-[10px] leading-tight whitespace-nowrap">
                        {[['Đầu kỳ', openingNum], ['Nhập thêm', restockNum], ['Sử dụng', usedNum], ['Lý thuyết', lyThuyet]].map(([label, val], i) => (
                            <Fragment key={label}>
                                {i > 0 && <span className="text-text-secondary">{['+', '−', '='][i - 1]}</span>}
                                <span className="flex flex-col items-center gap-0.5">
                                    <span className="text-text-secondary">{label}</span>
                                    <span className="text-text-dim">({val} {unit})</span>
                                </span>
                            </Fragment>
                        ))}
                    </div>
                )}
                {/* Row 4 — money + cups-equivalent context for Hao hụt */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                    <TextCell
                        label="Giá trị"
                        text={giaTri != null
                            ? `${giaTri < 0 ? '-' : ''}${formatVND(Math.abs(giaTri))}`
                            : '—'}
                        tone={haoHutTone}
                    />
                    <div className="col-span-2">
                        <TextCell label="Tương đương" text={tuongDuongText} tone={haoHutTone} />
                    </div>
                </div>

                {restockOverflow && (
                    <div className="flex items-start gap-1.5 mt-1.5 text-[10px] font-bold text-danger leading-tight">
                        <AlertTriangle size={11} className="mt-[1px] shrink-0" />
                        <span>
                            Vượt kho tổng {fmt(overBy)}.
                            Nếu hàng được mua mới, vào <span className="underline">/ingredients → + Nhập kho</span> trước.
                        </span>
                    </div>
                )}
            </div>)}
        </div>
    )
})

function ColumnInput({ label, value, unit, disabled, locked, onChange, headerRight, overflow, tone = 'neutral', onBoxClick, hint = false }) {
    // tone overrides the default disabled coloring for read-only diff cells.
    const toneMap = {
        good: { wrap: 'bg-success/8 border border-success/30', input: 'text-success', unit: 'text-success/70' },
        bad: { wrap: 'bg-danger/8 border border-danger/30', input: 'text-danger', unit: 'text-danger/70' },
        warn: { wrap: 'bg-warning/8 border border-warning/30', input: 'text-warning', unit: 'text-warning/70' },
        neutral: { wrap: '', input: '', unit: '' },
    }
    const t = toneMap[tone] || toneMap.neutral

    const wrapCls = overflow
        ? 'bg-danger/5 border border-danger/40 focus-within:border-danger'
        : t.wrap
            ? t.wrap
            : locked
                ? 'bg-primary/8 border border-primary/30'
                : 'bg-surface-light border border-border/60 focus-within:border-primary/40'
    const inputCls = overflow ? 'text-danger' : t.input || (locked ? 'text-primary cursor-not-allowed' : 'text-text')
    const unitCls = overflow ? 'text-danger/70' : t.unit || (locked ? 'text-primary/70' : 'text-text-dim')
    const Box = onBoxClick ? 'div' : 'label'

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-center gap-1 mb-1">
                <span className="text-[9px] font-black uppercase text-text-dim">{label}</span>
                {headerRight}
            </div>
            {/* <label> để bấm chỗ nào trong ô cũng focus vào input — input tự co theo số
                (width tính bằng ch) nên đơn vị luôn nằm sát ngay sau số, cả cụm canh giữa.
                (i) đặt absolute để số + đơn vị vẫn canh giữa như các ô khác.
                Ô bấm được phải là <div>: Chrome nuốt click trên <label> khi input bên trong disabled. */}
            <Box
                onClick={onBoxClick}
                className={`relative flex items-center justify-center rounded-[10px] overflow-hidden transition-all gap-1 px-1.5 py-1.5 ${wrapCls} ${onBoxClick ? 'pr-3 cursor-pointer' : ''} ${onboardingHintClass(hint)}`}
            >
                <input
                    type="number"
                    placeholder="-"
                    value={value}
                    onChange={e => onChange?.(e.target.value)}
                    disabled={disabled}
                    style={{ width: `${Math.max(String(value ?? '').length, 1)}ch` }}
                    className={`min-w-0 bg-transparent text-[13px] font-bold text-center placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${tone === 'neutral' ? 'disabled:opacity-50' : ''} ${inputCls}`}
                />
                <span className={`text-[10px] font-medium shrink-0 ${unitCls}`}>{unit}</span>
                {onBoxClick && <Info size={10} className="absolute right-1.5 text-text-dim pointer-events-none" />}
            </Box>
        </div>
    )
}

// Read-only text cell that visually matches ColumnInput (same label+box rhythm) but
// renders a string instead of a number input. Used for "Tương đương N ly <product>".
function TextCell({ label, text, tone = 'neutral', onClick, expanded = false }) {
    const toneMap = {
        good: { wrap: 'bg-success/8 border-success/30', text: 'text-success' },
        bad: { wrap: 'bg-danger/8 border-danger/30', text: 'text-danger' },
        warn: { wrap: 'bg-warning/8 border-warning/30', text: 'text-warning' },
        neutral: { wrap: 'bg-surface-light border-border/60', text: 'text-text-secondary' },
    }
    const t = toneMap[tone] || toneMap.neutral
    const interactive = typeof onClick === 'function'
    const boxClasses = `w-full rounded-[10px] py-1.5 px-2 text-[13px] text-center font-bold border ${t.wrap} ${t.text}${interactive ? ' relative flex items-center justify-center hover:brightness-110 active:scale-[0.99] transition' : ''}`
    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-center gap-1 mb-1">
                <span className="text-[9px] font-black uppercase text-text-dim">{label}</span>
            </div>
            {interactive ? (
                <button type="button" onClick={onClick} className={boxClasses}>
                    <span className="truncate">{text}</span>
                    <ChevronDown size={11} className={`absolute right-2 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
            ) : (
                <div className={boxClasses}>{text}</div>
            )}
        </div>
    )
}

