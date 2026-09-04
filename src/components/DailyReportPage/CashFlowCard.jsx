import { useMemo, useState, useRef } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatVND, parseVNDInput, capFirst } from '../../utils'
import { dayMonthVN } from '../../utils/dateVN'
import { ingredientLabel, normalizeIngredientCategory, INGREDIENT_CATEGORIES } from '../../utils/ingredients'
import { groupMeta } from '../../constants/expenseGroups'
import { useClickOutside } from '../../hooks/useClickOutside'
import { computeCashFlowTotals } from '../../utils/reportStats'
import { useProducts } from '../../contexts/ProductContext'
import { onboardingHintClass } from '../../utils/onboardingHint'

// Phase 1 payment: cờ trên payment ưu tiên cờ hoá đơn gốc; chỉ 'in_shift' rõ ràng
// mới là trong ca, còn lại (kể cả null/phiếu cũ) → sau chốt ca. Khớp reportStats.
const paymentPhase = (p) => ((p.cash_phase || p.invoice_metadata?.cash_phase) === 'in_shift' ? 'in_shift' : 'post_close')
// Phase của 1 NHÓM payment gộp: cả 2 loại → 'mixed'.
const groupPhase = (hasIn, hasPost) => (hasIn && hasPost ? 'mixed' : hasIn ? 'in_shift' : 'post_close')
// Phương thức trả của 1 dòng: chỉ phân biệt CK với phần còn lại (tiền mặt).
const methodOf = (x) => (x?.payment_method === 'transfer' ? 'transfer' : 'cash')
// Method của 1 NHÓM gộp: lẫn cả hai → 'mixed'.
const groupMethod = (hasCash, hasTransfer) => (hasCash && hasTransfer ? 'mixed' : hasTransfer ? 'transfer' : 'cash')
export default function CashFlowCard({
    actualCash = 0,
    actualTransfer = 0,
    dailyExpense = 0,
    refillFreeForm = 0,
    expenses = [],
    payments = [],   // NEW: expense_payments của ngày này (cash-out thực, theo paid_at)
    expenseCategories = [],  // nhãn chi phí — nhóm section Vận hành theo tên nhãn
    // Khối doanh thu (SalesCard + biểu đồ) render phía trên panel Thực thu.
    children,
    // Inline-edit props (today scope on /daily-report). When `editable` is true the
    // Tiền mặt / Chuyển khoản rows become text inputs. The Lưu thực thu CTA itself
    // lives as a FAB on DailyReportPage so it shares position/style with Lưu báo cáo.
    editable = false,
    cashInput = '',
    transferInput = '',
    isSaving = false,
    onCashChange,
    onTransferChange,
    hintCash = false,
    hintTransfer = false,
    // Bấm 1 dòng chi phí → mở modal sửa (DailyReportPage điều hướng sang tab Chi phí).
    onEditExpense,
    // Bấm 1 dòng "Mua nguyên liệu/bao bì" → mở RestockModal sửa phiếu nhập (chỉ khi
    // dòng gộp từ ĐÚNG 1 hoá đơn — xem groupByIngredient bên dưới).
    onEditRestockPayment,
}) {
    // Category (Nguyên liệu chính / Bao bì) của từng nguyên liệu — để phân loại
    // mục "Mua nguyên liệu / bao bì" bên dưới. Mặc định collapse từng nhóm.
    const { ingredientConfigs } = useProducts()
    const [expandedCats, setExpandedCats] = useState({})
    const toggleCat = (key) => setExpandedCats(prev => ({ ...prev, [key]: !prev[key] }))
    // When editing, totals/Thực nhận track the typed values so the user sees the impact
    // live before saving. Read-only mode falls back to the persisted (actualCash/Transfer) props.
    const liveCash = editable ? (parseVNDInput(cashInput) || 0) : actualCash
    const liveTransfer = editable ? (parseVNDInput(transferInput) || 0) : actualTransfer
    // Chưa gõ cả 2 ô Tiền mặt/Chuyển khoản (không phải "đã đếm và bằng 0") — Thực nhận
    // tính ra vẫn chỉ là placeholder, hiện "—" thay vì "0đ" để khỏi trông như đã đối soát xong.
    const cashNotEntered = editable && !cashInput && !transferInput

    // Cả khối dựng section Thực chi dưới đây chỉ phụ thuộc payments/expenses/nhãn/
    // ingredientConfigs — KHÔNG phụ thuộc ô tiền đang gõ. Component này không memo được
    // (nhận children là JSX mới mỗi render), nên không có useMemo thì mỗi phím gõ — tiền
    // mặt LẪN kiểm kê tồn, vì cả trang re-render chung — dựng lại toàn bộ group, 2 Map,
    // 1 object/dòng chi phí, và 4 lần sort localeCompare('vi') (đối chiếu tiếng Việt là
    // phần đắt nhất). Scope tháng ~200 chi phí + ~150 payment.
    const {
        totalExpenses, shiftExpenses, afterShiftOps,
        operating, overhead, nonOp, inventoryBlocks, inventoryTotal,
    } = useMemo(() => {
        // Payments của ngày (đã filter theo paid_at bởi report RPC). Tách nhóm để HIỂN THỊ:
        //   nvlPayments      = đi chợ NVL (loại free_form)
        //   freeFormPayments = chi "sau chốt ca" free_form
        const nvlPayments = []
        const freeFormPayments = []
        for (const p of payments || []) {
            if (p.invoice_metadata?.adjustment) continue
            if (p.invoice_metadata?.free_form) freeFormPayments.push(p)
            else nvlPayments.push(p)
        }
        const refillNvlPaid = nvlPayments.reduce((s, p) => s + (p.amount || 0), 0)
        const refillFreeFormPaid = freeFormPayments.reduce((s, p) => s + (p.amount || 0), 0)

        // 2. Tổng chi phí — dùng số thực trả (paid_at-based), không tính nghĩa vụ chưa trả.
        const totalExpenses = (dailyExpense || 0) + (refillFreeForm || refillFreeFormPaid) + refillNvlPaid

        const shiftExpenses = (expenses || []).filter(e => !e.is_refill)
        const afterShiftOps = (expenses || []).filter(e => e.is_refill && e.metadata?.free_form)

        // Gộp đi chợ theo TÊN nguyên liệu, bỏ ngày (scope nhiều ngày tên lặp lại mỗi
        // ngày → 1 dòng/nguyên liệu ×số lần + tổng, sắp theo tổng giảm dần). Chi tiết
        // từng ngày xem ở Nhật ký của nguyên liệu đó.
        const groupByIngredient = (list) => {
            const byName = new Map()
            for (const p of list) {
                const ing = p.invoice_metadata?.ingredient
                const name = ing ? ingredientLabel(ing) : (p.invoice_name || 'Trả NCC')
                let g = byName.get(name)
                if (!g) { g = { name, key: p.id, amount: 0, count: 0, hasIn: false, hasPost: false, hasCash: false, hasTransfer: false, payments: [] }; byName.set(name, g) }
                g.amount += p.amount || 0
                g.count += 1
                g.payments.push(p)
                if (paymentPhase(p) === 'in_shift') g.hasIn = true; else g.hasPost = true
                if (methodOf(p) === 'transfer') g.hasTransfer = true; else g.hasCash = true
            }
            return [...byName.values()]
                .map(g => ({ ...g, phase: groupPhase(g.hasIn, g.hasPost), method: groupMethod(g.hasCash, g.hasTransfer) }))
                .sort((a, b) => b.amount - a.amount)
        }
        // ── Phân chi phí non-refill theo group_section của nhãn (legacy/null → Vận hành).
        // Mỗi section gom theo TÊN nhãn, tách phase trong ca (chấm xám) / sau chốt ca
        // (chấm hổ phách). Bấm chấm xem chú thích phase.
        const catById = new Map((expenseCategories || []).map(c => [c.id, c]))
        // groupMeta rơi về EXPENSE_GROUPS[0] ('operating') cho nhãn legacy/null/không rõ.
        const expenseGroupKey = (e) => groupMeta(catById.get(e.category_id)?.group_section).key
        // Dòng con của cả 2 producer (chi phí gắn nhãn + chi phí nhãn tồn kho) — cùng shape.
        const toItemRow = (e, phase, fallbackLabel) => ({
            key: e.id, expense: e, date: dayMonthVN(e.created_at),
            name: capFirst(e.name || fallbackLabel), amount: e.amount,
            phase: phase === 'inShift' ? 'in_shift' : 'post_close', method: methodOf(e),
        })
        // Trả về CÙNG shape với block Tồn kho bên dưới ({label, total, count, children})
        // để cả 4 section dùng chung 1 component Section. Thứ tự children = thứ tự `tagged`
        // (trong ca trước, sau chốt ca sau) — giữ nguyên như khi tách 2 mảng inShift/postClose.
        const buildLabelGroups = (items) => {
            const map = new Map()
            for (const { e, phase } of items) {
                const cat = catById.get(e.category_id)
                const label = cat?.name || 'Chi phí khác'
                const sortKey = cat ? (cat.sort_order ?? 100) : 999
                let g = map.get(label)
                if (!g) { g = { label, sortKey, total: 0, count: 0, children: [] }; map.set(label, g) }
                g.children.push(toItemRow(e, phase, 'Chi phí khác'))
                g.total += e.amount || 0
                g.count += 1
                g.sortKey = Math.min(g.sortKey, sortKey)
            }
            return [...map.values()].sort((a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label, 'vi'))
        }
        const tagged = { operating: [], overhead: [], inventory: [], non_operating: [] }
        for (const e of shiftExpenses) tagged[expenseGroupKey(e)].push({ e, phase: 'inShift' })
        for (const e of afterShiftOps) tagged[expenseGroupKey(e)].push({ e, phase: 'postClose' })

        const sectionOf = (key) => {
            const groups = buildLabelGroups(tagged[key])
            return { groups, total: groups.reduce((s, g) => s + g.total, 0) }
        }
        const operating = sectionOf('operating')
        const overhead = sectionOf('overhead')
        const nonOp = sectionOf('non_operating')

        // ── Section TỒN KHO — mua NVL refill (gom theo nhóm nguyên liệu) GỘP với chi phí
        // gắn nhãn nhóm "Chi phí tồn kho" (vật tư không kiểm kê) cùng tên nhãn, + Trả nợ cũ.
        // Gộp theo label để "Mua nguyên liệu" refill và chi phí nhãn "Mua nguyên liệu" về 1 dòng.
        const catByKey = new Map(
            (ingredientConfigs || []).map(c => [c.ingredient, normalizeIngredientCategory(c.category)])
        )
        const invBlocks = new Map()
        const ensureBlock = (label, sortKey) => {
            let b = invBlocks.get(label)
            if (!b) { b = { label, sortKey, total: 0, count: 0, children: [] }; invBlocks.set(label, b) }
            b.sortKey = Math.min(b.sortKey, sortKey)
            return b
        }
        // Mọi payment NVL (đi chợ trả ngay LẪN trả nợ cũ) gom chung 1 lượt theo tên
        // nguyên liệu — báo cáo dòng tiền chỉ quan tâm tiền ra trong kỳ, không phân
        // biệt trả cho hoá đơn ngày nào.
        for (const cat of INGREDIENT_CATEGORIES) {
            const pays = nvlPayments.filter(p => (catByKey.get(p.invoice_metadata?.ingredient) || 'main') === cat.key)
            if (pays.length === 0) continue
            const b = ensureBlock(cat.key === 'packaging' ? 'Mua bao bì' : 'Mua nguyên liệu', cat.key === 'packaging' ? 20 : 10)
            for (const r of groupByIngredient(pays)) {
                b.total += r.amount; b.count += r.count
                // Chỉ mở sửa được khi cả nhóm chỉ gộp từ 1 hoá đơn CÓ ingredient (1 expense_id
                // + có invoice_metadata.ingredient) — gộp nhiều lần mua/trả nợ khác hoá đơn, hoặc
                // payment không gắn nguyên liệu (vd trả nợ NCC chung), thì không có phiếu để mở.
                const firstExpenseId = r.payments[0]?.expense_id
                const oneInvoice = !!firstExpenseId && !!r.payments[0]?.invoice_metadata?.ingredient
                    && r.payments.every(p => p.expense_id === firstExpenseId)
                b.children.push({
                    key: r.key, name: r.name, amount: r.amount, count: r.count, phase: r.phase, method: r.method,
                    restockPayment: oneInvoice ? r.payments[0] : null,
                })
            }
        }
        for (const { e, phase } of tagged.inventory) {
            const cat = catById.get(e.category_id)
            const label = cat?.name || 'Mua nguyên liệu'
            const b = ensureBlock(label, cat?.sort_order ?? 100)
            b.total += e.amount || 0; b.count += 1
            b.children.push(toItemRow(e, phase, label))
        }
        const inventoryBlocks = [...invBlocks.values()].sort((a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label, 'vi'))
        const inventoryTotal = inventoryBlocks.reduce((s, b) => s + b.total, 0)

        return {
            totalExpenses, shiftExpenses, afterShiftOps,
            operating, overhead, nonOp, inventoryBlocks, inventoryTotal,
        }
    }, [payments, expenses, expenseCategories, ingredientConfigs, dailyExpense, refillFreeForm])

    // 1. Thực thu / Thực nhận — phân loại tiền mặt theo cờ `cash_phase` lưu trên từng
    //    phiếu NVL (đặt lúc nhập kho): in_shift → cộng Thực thu (dựng lại doanh thu tiền
    //    mặt); sau chốt / phiếu cũ → trừ Thực nhận. Xem computeCashFlowTotals. CK luôn
    //    trừ Thực nhận, không cộng Thực thu.
    const {
        actualTotal, takeHomeCash, takeHomeTransfer, takeHome,
        inShiftRefillCash, inShiftOpsCash,
    } = computeCashFlowTotals({ liveCash, liveTransfer, payments, shiftExpenses, afterShiftExpenses: afterShiftOps })

    return (
        <div className="flex flex-col gap-4">
            {children && <div className="w-full">{children}</div>}

            {/* PANEL 1: THỰC THU */}
            <div className={`w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group ${onboardingHintClass(hintCash || hintTransfer)}`}>
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực thu</h3>
                <div className="flex flex-col gap-2.5 pl-2">
                    {editable ? (
                        <>
                            <MoneyInputRow
                                label="Tiền mặt"
                                value={cashInput}
                                disabled={isSaving}
                                onChange={onCashChange}
                            />
                            <MoneyInputRow
                                label="Chuyển khoản"
                                value={transferInput}
                                disabled={isSaving}
                                onChange={onTransferChange}
                            />
                        </>
                    ) : (
                        <>
                            <div className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">Tiền mặt</span>
                                <span className="text-[13px] font-bold text-text tabular-nums">
                                    {formatVND(actualCash)}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">Chuyển khoản</span>
                                <span className="text-[13px] font-bold text-text tabular-nums">
                                    {formatVND(actualTransfer)}
                                </span>
                            </div>
                        </>
                    )}
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">
                            Chi phí trong ca
                        </span>
                        <span className="text-[13px] font-bold text-warning tabular-nums">
                            {formatVND(inShiftOpsCash)}
                        </span>
                    </div>
                    {/* NVL/đi chợ trả tiền mặt TRƯỚC chốt cũng là tiền rút từ két trong ca →
                        cộng vào Thực thu. Hiện riêng để tổng nhìn ra được phần cộng lại. */}
                    {inShiftRefillCash > 0 && (
                        <div className="flex justify-between items-center">
                            <span className="text-[12px] font-bold text-text-secondary">Mua NVL trong ca</span>
                            <span className="text-[13px] font-bold text-warning tabular-nums">
                                {formatVND(inShiftRefillCash)}
                            </span>
                        </div>
                    )}
                </div>
                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide leading-none">Tổng thực thu</span>
                    <span className="text-[14px] font-black text-success tabular-nums leading-none">
                        {formatVND(actualTotal)}
                    </span>
                </div>
            </div>

            {/* PANEL 2: THỰC CHI — 4 section theo group_section nhãn (Vận hành / Quản lý
                & khác / Tồn kho / Ngoài kinh doanh), section phụ chỉ hiện khi có chi.
                Mỗi section là các dòng nhãn collapse; Tổng thực chi nằm cuối CÙNG PANEL. */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực chi</h3>

                {/* SECTION: VẬN HÀNH (luôn hiện) */}
                <Section title="Vận hành" total={operating.total} blocks={operating.groups}
                    expandedCats={expandedCats} toggleCat={toggleCat} emptyText="Không có chi phí vận hành" onEditExpense={onEditExpense} />

                {/* SECTION: QUẢN LÝ & KHÁC (chỉ khi có chi) */}
                {overhead.groups.length > 0 && (
                    <>
                        <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />
                        <Section title="Quản lý & khác" total={overhead.total} blocks={overhead.groups}
                            expandedCats={expandedCats} toggleCat={toggleCat} onEditExpense={onEditExpense} />
                    </>
                )}

                <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />

                {/* SECTION: TỒN KHO (luôn hiện) — refill + chi phí nhãn tồn kho, gộp theo dòng */}
                <Section title="Tồn kho" total={inventoryTotal} blocks={inventoryBlocks}
                    expandedCats={expandedCats} toggleCat={toggleCat} emptyText="Không có chi tồn kho trong kỳ"
                    onEditExpense={onEditExpense} onEditRestockPayment={onEditRestockPayment} />

                {/* SECTION: NGOÀI KINH DOANH (chỉ khi có chi) — không vào lợi nhuận */}
                {nonOp.groups.length > 0 && (
                    <>
                        <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />
                        <Section title="Ngoài kinh doanh" total={nonOp.total} blocks={nonOp.groups}
                            expandedCats={expandedCats} toggleCat={toggleCat} onEditExpense={onEditExpense} />
                    </>
                )}

                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />

                {/* TỔNG THỰC CHI — cùng panel, cùng kiểu với Tổng thực nhận. */}
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide leading-none">Tổng thực chi</span>
                    <span className="text-[14px] font-black text-danger tabular-nums leading-none">
                        -{formatVND(totalExpenses)}
                    </span>
                </div>
            </div>

            {/* PANEL 4: THỰC NHẬN */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực nhận</h3>
                <div className="flex flex-col gap-2.5 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Tiền mặt</span>
                        <span className={`text-[13px] font-bold tabular-nums ${cashNotEntered ? 'text-text-dim' : takeHomeCash < 0 ? 'text-danger' : 'text-text'}`}>
                            {cashNotEntered ? '—' : formatVND(takeHomeCash)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Chuyển khoản</span>
                        <span className={`text-[13px] font-bold tabular-nums ${cashNotEntered ? 'text-text-dim' : takeHomeTransfer < 0 ? 'text-danger' : 'text-text'}`}>
                            {cashNotEntered ? '—' : formatVND(takeHomeTransfer)}
                        </span>
                    </div>
                </div>

                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />

                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide leading-none">Tổng thực nhận</span>
                    <span className={`text-[14px] font-black tabular-nums leading-none ${cashNotEntered ? 'text-text-dim' : takeHome < 0 ? 'text-danger' : 'text-success'}`}>
                        {cashNotEntered ? '—' : formatVND(takeHome)}
                    </span>
                </div>
            </div>
        </div>
    )
}

// Dòng nhãn collapse trong panel Thực chi — chevron + tên (số món) + tổng tiền,
// bấm để mở/đóng chi tiết (children). Cấp giữa của thang phân cấp: nhỏ hơn tổng
// section (13px black), to hơn món bên trong (11px medium).
function CollapseGroup({ expanded, onToggle, label, count, total, children }) {
    return (
        <div className="flex flex-col gap-1">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex justify-between items-center text-left hover:opacity-85 active:scale-[0.99] transition-all"
            >
                <span className="flex items-center gap-1 text-[12px] font-bold text-text-secondary">
                    {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {label}
                    <span className="text-text-dim font-medium">({count})</span>
                </span>
                <span className="text-[12px] font-bold text-danger tabular-nums">-{formatVND(total)}</span>
            </button>
            {expanded && children}
        </div>
    )
}

// Header 1 section Thực chi: tên nhóm + tổng tiền nhóm.
function SectionHead({ title, total }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest">{title}</span>
            {total > 0 && <span className="text-[13px] font-black text-danger tabular-nums">-{formatVND(total)}</span>}
        </div>
    )
}

// 1 section của panel Thực chi (Vận hành / Quản lý & khác / Tồn kho / Ngoài KD).
// `blocks` đã gộp sẵn theo nhãn, mỗi nhãn collapse ra children là ItemRow props —
// buildLabelGroups (chi phí) và invBlocks (đi chợ NVL) đều dựng đúng shape này.
function Section({ title, total, blocks, expandedCats, toggleCat, emptyText, onEditExpense, onEditRestockPayment }) {
    return (
        <div className="flex flex-col gap-1 pl-1">
            <SectionHead title={title} total={total} />
            {blocks.length === 0 ? (
                emptyText ? <span className="text-[12px] text-text-secondary italic">{emptyText}</span> : null
            ) : blocks.map((b) => {
                const k = `${title}:${b.label}`
                return (
                    <CollapseGroup key={k} expanded={!!expandedCats[k]} onToggle={() => toggleCat(k)}
                        label={b.label} count={b.count} total={b.total}>
                        {/* Dòng dựng từ 1 expense thật (chi phí nhãn tồn kho) sửa qua ExpenseEditorModal;
                            dòng đi chợ NVL (restockPayment) sửa qua RestockModal — chỉ khi gộp từ
                            đúng 1 hoá đơn, xem "oneInvoice" ở chỗ dựng block phía trên. */}
                        {b.children.map((c) => (
                            <ItemRow key={c.key} date={c.date} name={c.name} amount={c.amount} count={c.count} phase={c.phase} method={c.method}
                                onClick={
                                    onEditExpense && c.expense ? () => onEditExpense(c.expense)
                                        : onEditRestockPayment && c.restockPayment ? () => onEditRestockPayment(c.restockPayment)
                                            : undefined
                                } />
                        ))}
                    </CollapseGroup>
                )
            })}
        </div>
    )
}

// Chấm ● đầu dòng đánh dấu phase, BẤM ĐƯỢC → popup chú thích. Tách khỏi span tên
// (span tên có `truncate`/overflow-hidden sẽ cắt mất popup). Màu: sau chốt ca /
// mixed = hổ phách (đáng chú ý khi đối soát két), trong ca = xám.
function PhaseDot({ phase }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useClickOutside(ref, () => setOpen(false), { active: open })
    const isPost = phase === 'post_close' || phase === 'mixed'
    const label = phase === 'mixed' ? 'Gồm chi phí trong ca và sau chốt ca'
        : phase === 'post_close' ? 'Chi phí phát sinh sau chốt ca'
        : 'Chi phí phát sinh trong ca'
    return (
        <span ref={ref} className="relative inline-flex shrink-0">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
                aria-label={label}
                className={`leading-none text-[8px] ${isPost ? 'text-warning' : 'text-text-dim'} hover:opacity-70 active:scale-90 transition`}
            >
                ●
            </button>
            {open && (
                <span
                    role="tooltip"
                    className="absolute left-0 bottom-full mb-1 z-30 whitespace-nowrap rounded-lg bg-surface-light border border-border/60 shadow-lg px-2 py-1 text-[10px] font-bold text-text-secondary"
                >
                    {label}
                </span>
            )}
        </span>
    )
}

// Nhãn TM/CK đánh dấu phương thức trả của 1 dòng/nhóm chi phí. CK (chuyển khoản) tô
// đậm hơn vì là khoản trừ vào "Thực nhận chuyển khoản" — manager hay đối soát thiếu.
// 'mixed' = nhóm gồm cả 2 → "TM/CK". TM mặc định, mờ, để CK nổi lên.
const METHOD_TAGS = {
    cash: ['TM', 'text-text-dim border-border/50'],
    transfer: ['CK', 'text-text border-border bg-surface-light'],
    mixed: ['TM/CK', 'text-text border-border bg-surface-light'],
}
function MethodTag({ method }) {
    const [label, cls] = METHOD_TAGS[method] || METHOD_TAGS.cash
    return (
        <span className={`shrink-0 text-[8px] font-black leading-none px-1 py-[2px] rounded border ${cls}`}>
            {label}
        </span>
    )
}

// Dòng món bên trong nhóm đã mở — cấp nhỏ nhất, thụt vào + nhạt hơn hàng nhãn.
// Thứ tự `● [TM|CK] ngày · tên`; chấm + nhãn method đứng riêng, tên truncate độc lập.
function ItemRow({ date, name, amount, count, phase = 'in_shift', method = 'cash', onClick }) {
    return (
        <div
            onClick={onClick}
            className={`flex justify-between items-center gap-2 pl-4 ${onClick ? 'cursor-pointer hover:opacity-75 active:scale-[0.99] transition' : ''}`}
        >
            <span className="flex items-center gap-1.5 min-w-0">
                <PhaseDot phase={phase} />
                <MethodTag method={method} />
                <span className="text-[11px] font-medium text-text-secondary/90 min-w-0 truncate">
                    {date && <span className="text-text-dim tabular-nums">{date} · </span>}
                    {name}
                    {count > 1 && <span className="ml-1 text-text-dim">×{count}</span>}
                </span>
            </span>
            <span className="text-[11px] font-medium text-danger/80 tabular-nums shrink-0">-{formatVND(amount)}</span>
        </div>
    )
}

function MoneyInputRow({ label, value, disabled, onChange }) {
    // Chưa gõ gì → ô trông y hệt dòng chỉ-đọc bên dưới, chủ quán không biết là
    // bấm được. Viền đứt + icon bút chỉ hiện lúc rỗng, gõ vào là biến mất.
    const empty = !value
    return (
        <div className="flex items-center justify-between gap-3 rounded-lg">
            <span className="text-[12px] font-bold text-text-secondary shrink-0">{label}</span>
            {/* pr-0: khung viền đứt chỉ chừa lề bên trái, để mép phải của "đ" thẳng
                hàng với số của các dòng chỉ-đọc bên dưới (Chi phí trong ca, Tổng thực thu). */}
            <div className={`flex items-center max-w-[180px] flex-1 justify-end rounded-[8px] pl-1.5 pr-0 py-0.5 transition-colors ${empty ? 'border border-dashed border-primary/50 bg-primary/5' : 'border border-transparent'}`}>
                <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={value}
                    onChange={e => onChange?.(e.target.value)}
                    disabled={disabled}
                    className="flex-1 w-0 min-w-0 bg-transparent text-right text-[13px] font-bold text-text tabular-nums placeholder:text-text-secondary/40 focus:outline-none disabled:opacity-50"
                />
                {/* "đ" đi theo màu của con số: mờ như placeholder khi chưa ai nhập,
                    đậm bằng chữ khi đã có số — để "0đ" đọc ra như một cụm. */}
                <span className={`text-[13px] font-bold shrink-0 pointer-events-none ${empty ? 'text-text-secondary/40' : 'text-text'}`}>đ</span>
            </div>
        </div>
    )
}
