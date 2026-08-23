import { useMemo, useState } from 'react'
import { formatVND, capFirst } from '../../utils'
import { dayMonthVN } from '../../utils/dateVN'
import { buildCategoryBreakdown } from '../../utils/expenseCategoryBreakdown'

// "Chi phí khác" gom nhiều khoản lẻ → 1 dòng tổng đục. Cho bấm xổ ra từng khoản như
// báo cáo dòng tiền (nhưng KHÔNG phân biệt TM/CK). Dòng nhãn khác giữ LineItem phẳng.
function renderRow(r) {
    return r.name === 'Chi phí khác' && r.entries.length > 0
        ? <ExpandableLineItem key={r.id} label={r.name} amount={r.amount} entries={r.entries} />
        : <LineItem key={r.id} label={`· ${r.name}`} amount={r.amount} />
}

// Per-period P&L breakdown. Replaces the hardcoded 6+3 row list with category-
// driven rendering: each expense_categories row is one line in either the
// Operating ("Chi phí vận hành") or Overhead ("Chi phí quản lý & khác") card.
//
// "Thực chi" model: every entry comes from a real expense row tagged with a
// category. No more template × days projection — what you spent is what you see.
//
// Inputs:
//   - totalRevenue / totalCOGS / netProfit: kept as scalar props since the parent
//     has the full picture (range scaling).
//   - expenses: raw rows for the period. We filter inside (skip NVL refills).
//   - expenseCategories: address's tag list. Categories missing from this list
//     (soft-deleted) fall back to "Chi phí khác" of the same group_section.
export default function FinanceCards({
    totalRevenue,
    totalDiscount = 0,
    totalCOGS,
    netProfit,
    expenses = [],
    expenseCategories = [],
    // Category split of totalCOGS — caller passes raw bucket; we normalize so lines sum to totalCOGS.
    // Tools is folded into packaging per UX decision ("Bao bì (ly, nắp, ống hút, dụng cụ...)").
    cogsByCategory = null,
    // Σ|hao hụt × unit_cost| over the period — added on top of totalCOGS as a separate line.
    lossValue = 0,
    // Tiêu hao của bao bì/vật tư KHÔNG nằm trong công thức (ống hút, bịch chữ T): mỗi
    // dòng { ingredient, label, value } — hiện theo tên trong COGS, tách khỏi "Hao hụt".
    nonRecipeUsageLines = [],
}) {
    const { operatingRows, overheadRows, inventoryRows, operatingTotal, overheadTotal, inventoryTotal } = useMemo(
        () => buildCategoryBreakdown({ expenses, expenseCategories }),
        [expenses, expenseCategories]
    )

    const cogsLines = useMemo(() => {
        const main = Math.max(0, cogsByCategory?.main || 0)
        const packTools = Math.max(0, (cogsByCategory?.packaging || 0) + (cogsByCategory?.tools || 0))
        const sum = main + packTools
        if (sum <= 0) return { direct: totalCOGS, packaging: 0 }
        // Rescale so the two lines add up to totalCOGS — keeps numbers consistent
        // even when current-recipe split drifts from snapshot order.total_cost.
        const scale = totalCOGS / sum
        const packagingScaled = Math.round(packTools * scale)
        return { direct: totalCOGS - packagingScaled, packaging: packagingScaled }
    }, [cogsByCategory, totalCOGS])

    const nonRecipeUsageTotal = nonRecipeUsageLines.reduce((s, l) => s + (l.value || 0), 0)
    const cogsTotal = totalCOGS + lossValue + nonRecipeUsageTotal
    const grossProfit = totalRevenue - cogsTotal
    // Chi phí tồn kho (vật tư không kiểm kê) trừ sau Lợi nhuận gộp — KHÔNG lẫn COGS
    // (COGS tính từ tiêu hao công thức của hàng có kiểm kê), rồi mới tới vận hành.
    const operatingProfit = grossProfit - inventoryTotal - operatingTotal
    // Biên lợi nhuận — 3 banner cùng công thức, doanh thu 0 thì hiện 0.00 thay vì NaN.
    const margin = (amount) => (totalRevenue > 0 ? (amount / totalRevenue * 100).toFixed(2) : '0.00')

    return (
        <div className="grid grid-cols-2 gap-3.5">
            {/* 1. DOANH THU — "Bán hàng" is gross (net + discount); "Doanh thu thuần" stays net. */}
            <SimpleCard title="Doanh thu" totalLabel="Doanh thu thuần" totalAmount={totalRevenue} totalTone="success">
                <LineItem label="· Bán hàng" amount={totalRevenue + totalDiscount} />
                <LineItem label="· Giảm giá" amount={-totalDiscount || 0} />
            </SimpleCard>

            {/* 2. GIÁ VỐN (COGS) */}
            <SimpleCard title="Giá vốn (COGS)" totalLabel="Tổng giá vốn" totalAmount={cogsTotal} totalTone="warning">
                <LineItem label="· Nguyên liệu trực tiếp" amount={cogsLines.direct} />
                <LineItem label="· Bao bì" amount={cogsLines.packaging} />
                {nonRecipeUsageLines.map(l => (
                    <LineItem key={l.ingredient} label={`· ${l.label}`} amount={l.value} />
                ))}
                <LineItem label="· Hao hụt / hủy" amount={lossValue} />
            </SimpleCard>

            {/* 3. LỢI NHUẬN GỘP */}
            <ProfitBanner label="Lợi nhuận gộp" amount={grossProfit}>
                <div className="flex justify-between items-center mt-2 pl-1">
                    <span className="text-[11px] font-bold text-text-secondary uppercase">Biên lợi nhuận gộp</span>
                    <span className="text-[13px] font-black text-success tabular-nums">
                        {margin(grossProfit)}%
                    </span>
                </div>
            </ProfitBanner>

            {/* 3b. CHI PHÍ TỒN KHO — vật tư mua không kiểm kê (chỉ hiện khi có chi). */}
            {inventoryTotal > 0 && (
                <SimpleCard title="Chi phí tồn kho" totalLabel="Tổng cộng" totalAmount={inventoryTotal} totalTone="danger">
                    {inventoryRows.map(renderRow)}
                </SimpleCard>
            )}

            {/* 4. CHI PHÍ VẬN HÀNH — dynamic by category */}
            <SimpleCard title="Chi phí vận hành" totalLabel="Tổng cộng" totalAmount={operatingTotal} totalTone="danger">
                {operatingRows.length === 0
                    ? <span className="text-[12px] text-text-secondary italic pl-1">Chưa có chi phí vận hành</span>
                    : operatingRows.map(renderRow)
                }
            </SimpleCard>

            {/* 5. LỢI NHUẬN VẬN HÀNH */}
            <ProfitBanner label="Lợi nhuận vận hành" amount={operatingProfit}>
                <div className="flex justify-between items-center mt-2 pl-1">
                    <span className="text-[11px] font-bold text-text-secondary uppercase">Biên vận hành</span>
                    <span className={`text-[13px] font-black tabular-nums ${operatingProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                        {margin(operatingProfit)}%
                    </span>
                </div>
            </ProfitBanner>

            {/* 6. CHI PHÍ QUẢN LÝ & KHÁC — dynamic by category */}
            <SimpleCard title="Chi phí quản lý & khác" totalLabel="Tổng cộng" totalAmount={overheadTotal} totalTone="danger">
                {overheadRows.length === 0
                    ? <span className="text-[12px] text-text-secondary italic pl-1">Chưa có chi phí quản lý & khác</span>
                    : overheadRows.map(renderRow)
                }
            </SimpleCard>

            {/* 7. LỢI NHUẬN RÒNG (NET PROFIT) */}
            <NetProfitCard netProfit={netProfit} margin={margin} />
        </div>
    )
}

// ─── Subcomponents ──────────────────────────────────────────────────────────
function SimpleCard({ title, totalLabel, totalAmount, totalTone, children }) {
    const toneCls = totalTone === 'success' ? 'text-success' : totalTone === 'warning' ? 'text-warning' : 'text-danger'
    return (
        <div className="col-span-2 bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
            <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">{title}</h3>
            <div className="flex flex-col gap-2 pl-2">{children}</div>
            <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
            <div className="flex justify-between items-center mt-1 pl-1">
                <span className="text-[13px] font-black text-text uppercase tracking-wide">{totalLabel}</span>
                <span className={`text-[14px] font-black tabular-nums ${toneCls}`}>{formatVND(totalAmount)}</span>
            </div>
        </div>
    )
}

function LineItem({ label, amount }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-[12px] font-bold text-text-secondary">{label}</span>
            <span className="text-[13px] font-bold text-text tabular-nums">{formatVND(amount)}</span>
        </div>
    )
}

// Dòng nhãn bấm xổ ra các khoản con (· ngày · tên + số tiền). Chevron thay dấu "·".
function ExpandableLineItem({ label, amount, entries }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="flex flex-col gap-1.5">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex justify-between items-center text-left hover:opacity-85 active:scale-[0.99] transition-all"
            >
                <span className="flex items-center gap-1 text-[12px] font-bold text-text-secondary">
                    · {label}
                    <span className="text-text-dim font-medium">({entries.length})</span>
                </span>
                <span className="text-[13px] font-bold text-text tabular-nums">{formatVND(amount)}</span>
            </button>
            {open && entries.map(e => (
                <div key={e.id} className="flex justify-between items-center gap-2 pl-5">
                    <span className="text-[11px] font-medium text-text-secondary/90 min-w-0 truncate">
                        {e.created_at && <span className="text-text-dim tabular-nums">{dayMonthVN(e.created_at)} · </span>}
                        {capFirst(e.name || 'Chi phí khác')}
                    </span>
                    <span className="text-[11px] font-medium text-text/70 tabular-nums shrink-0">{formatVND(e.amount)}</span>
                </div>
            ))}
        </div>
    )
}

function ProfitBanner({ label, amount, children }) {
    // Lợi nhuận âm → tô đỏ (danger) như NetProfitCard, không cứng màu xanh.
    const isPositive = amount >= 0
    return (
        <div
            className={`col-span-2 rounded-[24px] p-5 shadow-sm border flex flex-col justify-center relative overflow-hidden
                ${isPositive ? 'bg-success/[0.03] border-success/30' : 'bg-danger/[0.03] border-danger/30'}`}
        >
            <div className={`absolute top-0 left-0 w-1.5 h-full ${isPositive ? 'bg-success/60' : 'bg-danger/60'}`} />
            <div className="flex justify-between items-center pl-1">
                <span className="text-[13px] font-black text-text uppercase tracking-wide min-w-0 truncate">{label}</span>
                <span className={`text-[14px] font-black tabular-nums shrink-0 ml-2 ${isPositive ? 'text-success' : 'text-danger'}`}>{formatVND(amount)}</span>
            </div>
            {children}
        </div>
    )
}

function NetProfitCard({ netProfit, margin }) {
    const isPositive = netProfit >= 0
    return (
        <div className={`col-span-2 rounded-[24px] p-5 shadow-sm border flex flex-col justify-center relative overflow-hidden
            ${isPositive ? 'bg-success/[0.04] border-success/30' : 'bg-danger/[0.04] border-danger/30'}`}
        >
            <div className={`absolute top-0 left-0 w-1.5 h-full ${isPositive ? 'bg-success/80' : 'bg-danger/80'}`} />
            <div className="flex justify-between items-center pl-1">
                <h3 className="text-[14px] font-black text-text/80 uppercase tracking-wide">Lợi nhuận ròng</h3>
                <div className={`text-[14px] font-black tabular-nums ${isPositive ? 'text-success' : 'text-danger'}`}>
                    {formatVND(netProfit)}
                </div>
            </div>
            <div className="flex justify-between items-center pl-1 mt-2">
                <span className="text-[11px] font-bold text-text-secondary uppercase">Biên ròng</span>
                <span className={`text-[13px] font-black tabular-nums ${isPositive ? 'text-success' : 'text-danger'}`}>
                    {margin(netProfit)}%
                </span>
            </div>
        </div>
    )
}
