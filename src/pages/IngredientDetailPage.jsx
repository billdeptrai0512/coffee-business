import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useHistory } from '../contexts/HistoryContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import {
    fetchIngredientRestockHistory, fetchIngredientStocks, fetchIngredientWithdrawals,
    deleteIngredientCost, upsertIngredientCost, renameIngredient,
    adjustIngredientStock, setCounterStock, recordInvoicePayment, cancelRestock,
    editIngredientRestock, mergeShiftClosingInventory, fetchIngredientDailyContext,
    processIngredientRestock,
} from '../services/orderService'
import { fetchCashClosedToday } from '../services/reportService'
import { formatVND } from '../utils'
import {
    ingredientLabel, getIngredientUnit,
    normalizeIngredientCategory, normalizeIngredientKey,
} from '../utils/ingredients'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import PackConfigModal from '../components/IngredientManagementPage/PackConfigModal'
import IngredientDetailsTab, { IngredientStockPanel, IngredientCounterPanel, DeleteIngredientButton } from '../components/IngredientManagementPage/IngredientDetailsTab'
import IngredientHistoryTab from '../components/IngredientManagementPage/IngredientHistoryTab'
import InvoicePaymentSheet from '../components/IngredientManagementPage/InvoicePaymentSheet'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../contexts/ConfirmContext'
import { dateStringVN, timeStringVN, startOfMonthVN, endOfMonthVN } from '../utils/dateVN'
import { findCoffeeIngredient, nextIngredientSetupField } from '../utils/onboardingHint'
import { isRecipeProgressDone } from '../utils/onboardingStorage'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'

// Page-level orchestrator: fetches data, owns the canonical state (stock, history,
// config), and exposes per-field save callbacks. All edit-mode UI state lives
// inside child components — see IngredientDetailsTab for the inverted control.
export default function IngredientDetailPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { ingredientKey } = useParams()
    const { ingredientCosts, ingredientUnits, ingredientConfigs, refreshProducts } = useProducts()
    const { selectedAddress, siblingsByAddress } = useAddress()
    const { requestRefresh: requestOnboardingRefresh } = useOnboardingVisibility()
    const warehouseSiblings = selectedAddress ? siblingsByAddress[selectedAddress.id] : null
    const warehouseGroupNote = warehouseSiblings?.length
        ? `Dùng chung với: ${warehouseSiblings.map(a => a.name).join(', ')}`
        : null
    // Nhật ký phải thấy phiếu nhập/rút ở CẢ NHÓM khi có kho tổng chung — 1 phần tử khi độc lập.
    const groupAddressIds = useMemo(
        () => selectedAddress ? [selectedAddress.id, ...(warehouseSiblings || []).map(a => a.id)] : [],
        [selectedAddress, warehouseSiblings]
    )
    const addressNameById = useMemo(() => {
        const map = {}
        if (selectedAddress) map[selectedAddress.id] = selectedAddress.name
        for (const a of warehouseSiblings || []) map[a.id] = a.name
        return map
    }, [selectedAddress, warehouseSiblings])
    const { isManager, isAdmin, profile, isGuest } = useAuth()
    const { refreshTodayExpenses } = useHistory()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    const [viewMode, setViewMode] = useState('details')
    const [history, setHistory] = useState([])
    const [loading, setLoading] = useState(true)
    const [stockData, setStockData] = useState(null)
    const [dailyContext, setDailyContext] = useState(null)
    const [siblingCounterStocks, setSiblingCounterStocks] = useState(null)
    const [saving, setSaving] = useState(false)
    const [packModalOpen, setPackModalOpen] = useState(false)
    const [paymentInvoice, setPaymentInvoice] = useState(null)
    const [editingEntry, setEditingEntry] = useState(null)
    const [restockOpen, setRestockOpen] = useState(false)
    // Đã chốt ca tiền hôm nay chưa → default phân loại tiền mặt khi nhập kho. Fetch khi
    // mở modal nhập kho để luôn tươi (user có thể vừa chốt ở /daily-report).
    const [cashClosedToday, setCashClosedToday] = useState(false)
    useEffect(() => {
        if (!restockOpen) return
        let alive = true
        fetchCashClosedToday(selectedAddress?.id).then(v => { if (alive) setCashClosedToday(!!v) })
        return () => { alive = false }
    }, [restockOpen, selectedAddress?.id])

    // Month navigation (Nhật ký tab)
    const [monthOffset, setMonthOffset] = useState(0)
    const { targetMonth, fromDate, toDate } = useMemo(() => {
        const from = startOfMonthVN(new Date(), monthOffset)
        const to = endOfMonthVN(new Date(), monthOffset)
        return { targetMonth: from, fromDate: from.toISOString(), toDate: to.toISOString() }
    }, [monthOffset])
    const monthLabel = targetMonth.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })

    // Derived view from context — single source of truth, never a local copy.
    const config = useMemo(
        () => (ingredientConfigs || []).find(c => c.ingredient === ingredientKey) || {},
        [ingredientConfigs, ingredientKey]
    )
    const unit = getIngredientUnit(ingredientKey, ingredientUnits[ingredientKey])
    const cost = ingredientCosts[ingredientKey] || 0
    const category = normalizeIngredientCategory(config.category)
    const packSize = config.pack_size ?? null
    const packUnit = config.pack_unit ?? null
    // `??` so an explicit 0 round-trips faithfully (DB column NULL stays as null;
    // a stored 0 stays as 0). See ingredientCostService.upsertIngredientCost for the
    // matching write-side rule.
    const minStock = config.min_stock ?? null
    // Khối lượng bì của hộp/chai đựng tại quầy — null/0 = không có bì.
    const tareWeight = config.tare_weight ?? null
    // Mặc định true (chưa migrate / phiếu cũ → vẫn kiểm kê).
    const countInAudit = config.count_in_audit ?? true
    const currentStock = stockData?.current_stock ?? null

    // Stocks only depend on address+key — refetching on month-arrow taps would
    // burn one extra round-trip per nav.
    useEffect(() => {
        if (!selectedAddress || !ingredientKey) return
        fetchIngredientStocks(selectedAddress.id)
            .then(stocks => setStockData(stocks.find(s => s.ingredient === ingredientKey)))
    }, [selectedAddress, ingredientKey])

    // Đầu ngày/Lấy ra/Nhập mới cho panel Kiểm kê — cùng nguồn dữ liệu với card ở /ingredients.
    useEffect(() => {
        if (!selectedAddress || !ingredientKey) return
        fetchIngredientDailyContext(selectedAddress.id ?? null)
            .then(map => setDailyContext(map[ingredientKey] || null))
    }, [selectedAddress, ingredientKey])

    // Tồn quầy của các địa chỉ khác dùng chung kho tổng — chỉ đọc (sửa quầy của họ phải mở đúng địa chỉ đó).
    useEffect(() => {
        if (!warehouseSiblings?.length || !ingredientKey) { setSiblingCounterStocks(null); return }
        Promise.all(warehouseSiblings.map(a => fetchIngredientStocks(a.id)))
            .then(results => setSiblingCounterStocks(warehouseSiblings.map((a, i) => ({
                addressId: a.id,
                addressName: a.name,
                counterStock: results[i].find(s => s.ingredient === ingredientKey)?.counter_stock ?? 0,
            }))))
    }, [selectedAddress, warehouseSiblings, ingredientKey])

    // History is scoped to the displayed month. Gồm 2 nguồn xen kẽ theo thời gian:
    // phiếu nhập/hiệu chỉnh (expenses) + lượt "Rút ra quầy" (restock trong phiếu
    // chốt ca). Lượt rút là chuyển kho nội bộ — không tiền, không payments.
    const loadHistory = useCallback(async () => {
        const [hist, withdrawals] = await Promise.all([
            fetchIngredientRestockHistory(groupAddressIds, ingredientKey, fromDate, toDate),
            fetchIngredientWithdrawals(groupAddressIds, ingredientKey, fromDate, toDate),
        ])
        const withdrawalEntries = withdrawals.map(w => ({
            id: `wd-${w.id}`,
            created_at: w.created_at,
            is_withdrawal: true,
            amount: 0,
            payments: [],
            staff_name: w.staff_name,
            address_id: w.address_id,
            // before/after kho — card vẽ "Tồn kho X → Y" y hệt phiếu nhập/hiệu chỉnh.
            metadata: { qty: w.qty, before_stock: w.before_stock, after_stock: w.after_stock },
        }))
        return [...hist, ...withdrawalEntries]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }, [groupAddressIds, ingredientKey, fromDate, toDate])

    const reloadStock = useCallback(async () => {
        if (!selectedAddress) return
        const stocks = await fetchIngredientStocks(selectedAddress.id)
        setStockData(stocks.find(s => s.ingredient === ingredientKey))
    }, [selectedAddress, ingredientKey])

    const reloadHistory = useCallback(async () => {
        if (!selectedAddress) return
        setHistory(await loadHistory())
    }, [selectedAddress, loadHistory])

    useEffect(() => {
        if (!selectedAddress || !ingredientKey) return
        setLoading(true)
        loadHistory()
            .then(setHistory)
            .finally(() => setLoading(false))
    }, [loadHistory, selectedAddress, ingredientKey])

    const summary = useMemo(() => {
        let totalSpent = 0, totalQty = 0, totalOwing = 0, totalPaidInMonth = 0
        // `fromDate` / `toDate` xác định cửa sổ tháng đang xem — payments có paid_at
        // trong cửa sổ này được tính vào "Đã trả" của tháng. Một payment có thể trả
        // cho invoice tháng khác, nên paid không = invoice.amount khớp 1-1.
        const monthStartMs = new Date(fromDate).getTime()
        const monthEndMs = new Date(toDate).getTime()
        let purchaseCount = 0
        history.forEach(e => {
            // Lượt rút ra quầy không phải mua hàng — không tính vào tổng tiền/lượng nhập.
            if (e.is_withdrawal) return
            purchaseCount += 1
            totalSpent += e.amount || 0
            const qty = e.metadata?.qty || 0
            totalQty += qty
            const paid = (e.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
            totalOwing += Math.max(0, (e.amount || 0) - paid)
            for (const p of e.payments || []) {
                const t = new Date(p.paid_at).getTime()
                if (t >= monthStartMs && t <= monthEndMs) totalPaidInMonth += p.amount || 0
            }
        })
        return { totalSpent, totalQty, totalOwing, totalPaidInMonth, count: purchaseCount }
    }, [history, fromDate, toDate])

    // ── Save callbacks for child rows ───────────────────────────────────────
    async function saveCategory(newCat) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, { category: newCat })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu nhóm nguyên liệu') }
        finally { setSaving(false) }
    }

    async function saveCountInAudit(next) {
        if (next === countInAudit) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, { countInAudit: next })
            refreshProducts?.()
            showToast(next ? 'Nguyên liệu này sẽ được kiểm kê trong báo cáo tồn kho' : 'Nguyên liệu này sẽ không phải kiểm kê trong báo cáo tồn kho', 'success')
        } catch (err) { showError(err, 'Lưu thiết lập kiểm kê') }
        finally { setSaving(false) }
    }

    async function savePackConfig({ packSize: ps, packUnit: pu }) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, {
                packSize: ps, packUnit: pu, minStock: config.min_stock,
            })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu quy cách đóng gói') }
        finally { setSaving(false) }
    }

    // Sửa KHO SAU (warehouse) = nhập số tuyệt đối. delta so với kho sau hiện tại
    // (KHÔNG so với tổng) → chỉ tác động warehouse, không đụng quầy.
    async function saveWarehouse(newWarehouse) {
        const current = stockData?.warehouse_stock ?? 0
        const delta = newWarehouse - current
        if (delta === 0) return
        setSaving(true)
        try {
            // Snapshot kho sau để Nhật ký vẽ "Tồn X → Y". Chỉ truyền khi stocks đã load.
            const snapshotOpts = stockData ? { beforeStock: stockData.warehouse_stock } : {}
            await adjustIngredientStock(selectedAddress?.id, ingredientKey, delta, profile?.name, snapshotOpts)
            await Promise.all([reloadStock(), refreshTodayExpenses?.()])
            showToast('Đã hiệu chỉnh kho sau', 'success')
            requestOnboardingRefresh()
        } catch (err) { showError(err, 'Hiệu chỉnh kho sau') }
        finally { setSaving(false) }
    }

    // Sửa TỒN QUẦY (counter) = nhập số tuyệt đối. Ghi thẳng `remaining` vào phiếu
    // chốt mới nhất → khớp với số chốt ca ở Hao hụt.
    // Chưa có phiếu chốt nào (địa chỉ mới) → ghi thành Đầu kỳ (khoá) của phiếu hôm nay
    // thay vì báo lỗi, để nhập tồn quầy lúc setup ban đầu vẫn hoạt động; chốt ca đầu
    // tiên sẽ tự tính hao hụt dựa trên Đầu kỳ này.
    async function saveCounter(newCounter) {
        if (newCounter === (stockData?.counter_stock ?? 0)) return
        setSaving(true)
        try {
            const res = await setCounterStock(selectedAddress?.id, ingredientKey, newCounter)
            if (!res) {
                await mergeShiftClosingInventory(selectedAddress?.id, [{
                    ingredient: ingredientKey,
                    unit,
                    opening: newCounter,
                    opening_locked: true,
                    remaining: null,
                    restock: null,
                    skipped: false,
                }], null)
            }
            await reloadStock()
            showToast('Đã sửa tồn quầy', 'success')
            requestOnboardingRefresh()
        } catch (err) { showError(err, 'Sửa tồn quầy') }
        finally { setSaving(false) }
    }

    async function saveUnit(newUnit) {
        if (newUnit === unit) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, newUnit, { category: config.category })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu đơn vị') }
        finally { setSaving(false) }
    }

    async function saveName(newDisplayName) {
        const newKey = normalizeIngredientKey(newDisplayName)
        if (!newKey || newKey === ingredientKey) return
        setSaving(true)
        try {
            await renameIngredient(ingredientKey, newKey, selectedAddress?.id)
            refreshProducts?.()
            // URL param drives every fetch on this page — repoint at the new key
            // so the page keeps showing the same ingredient under its new name.
            navigate(`/ingredients/${newKey}`, { replace: true, state: location.state })
        } catch (err) { showError(err, 'Đổi tên nguyên liệu') }
        finally { setSaving(false) }
    }

    async function saveMinStock(newMin) {
        if (newMin === (minStock || 0)) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, {
                category: config.category,
                packSize: config.pack_size,
                packUnit: config.pack_unit,
                minStock: newMin,
            })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu tồn tối thiểu') }
        finally { setSaving(false) }
    }

    async function saveTareWeight(newTare) {
        if (newTare === (tareWeight || 0)) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, {
                category: config.category,
                packSize: config.pack_size,
                packUnit: config.pack_unit,
                tareWeight: newTare || null, // 0 = xoá bì
            })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu khối lượng bì') }
        finally { setSaving(false) }
    }

    async function handleRestock({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) {
        // beforeStock only used by guest / default-address paths; the address RPC
        // computes its own authoritative snapshot. Only include when stocks đã load.
        const snapshot = stockData ? { beforeStock: stockData.warehouse_stock } : {}
        const result = await processIngredientRestock(selectedAddress?.id, ing, qty, profile?.name, {
            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
            ...snapshot,
        })
        await Promise.all([reloadStock(), reloadHistory(), refreshProducts?.(), refreshTodayExpenses?.()])
        showToast('Đã nhập kho', 'success')
        requestOnboardingRefresh()
        return result
    }

    async function handleRecordPayment({ amount, paymentMethod, paidAt, cashPhase }) {
        if (!paymentInvoice) return
        setSaving(true)
        try {
            // Kho tổng nhóm: hoá đơn đang trả nợ có thể ghi nhận ở địa chỉ KHÁC địa chỉ đang xem —
            // dùng address_id thật của hoá đơn để invalidate đúng cache báo cáo.
            await recordInvoicePayment(
                paymentInvoice.address_id || selectedAddress?.id, paymentInvoice.id,
                amount, paymentMethod, profile?.name, paidAt, cashPhase,
            )
            await Promise.all([reloadHistory(), refreshTodayExpenses?.()])
            setPaymentInvoice(null)
            showToast('Đã ghi nhận thanh toán', 'success')
        } catch (err) { showError(err, 'Ghi nhận thanh toán') }
        finally { setSaving(false) }
    }

    async function handleCancelRestock(entry) {
        const qty = entry?.metadata?.qty || 0
        const isAdjust = !!entry?.metadata?.adjustment
        const label = ingredientLabel(ingredientKey)
        const qtyStr = `${qty > 0 ? '+' : ''}${qty} ${unit}`
        // Reverting a +454 restock removes 454; reverting a −454 adjustment adds 454 back.
        const revertStr = `${qty > 0 ? '−' : '+'}${Math.abs(qty)} ${unit}`
        const head = isAdjust
            ? `Hủy hiệu chỉnh ${qtyStr} ${label}?`
            : `Hủy phiếu nhập ${qtyStr} ${label}?`
        const detail = isAdjust
            ? `Tồn kho sẽ thay đổi ${revertStr} để hoàn lại hiện trạng.`
            : `Tồn kho ${revertStr}, hoàn tiền đã trả, và tính lại giá vốn.`
        if (!await confirm({ title: head, detail, danger: true, confirmLabel: 'Hủy phiếu' })) return
        setSaving(true)
        try {
            // Kho tổng nhóm: Nhật ký có thể hiện phiếu ghi nhận ở địa chỉ KHÁC (đang xem chỉ là 1
            // thành viên) — phải hủy đúng theo address_id thật của phiếu, không phải địa chỉ đang xem.
            await cancelRestock(entry.address_id || selectedAddress?.id, entry.id, profile?.name)
            await Promise.all([reloadHistory(), reloadStock(), refreshProducts?.(), refreshTodayExpenses?.()])
            showToast(isAdjust ? 'Đã hủy hiệu chỉnh tồn' : 'Đã hủy phiếu nhập kho', 'success')
        } catch (err) { showError(err, isAdjust ? 'Hủy hiệu chỉnh tồn' : 'Hủy phiếu nhập kho') }
        finally { setSaving(false) }
    }

    async function handleEditRestock(entry, form) {
        setSaving(true)
        const originalHistory = [...history]
        const originalStockData = stockData ? { ...stockData } : null

        const purchaseDate = form.purchaseDate
            || new Date(`${dateStringVN()}T12:00:00+07:00`).toISOString()
        const qtyNum = Number(form.qty)
        const subtotalNum = Number(form.subtotal)
        const discountNum = Number(form.discount)
        const extraCostNum = Number(form.extraCost)
        const paidNum = Number(form.paid)
        const amountDue = Math.max(0, subtotalNum - discountNum + extraCostNum)
        const paidAmount = Math.min(paidNum, amountDue)

        // Optimistic history update
        const updatedHistory = history.map(h => {
            if (h.id === entry.id) {
                return {
                    ...h,
                    amount: amountDue,
                    discount_amount: discountNum,
                    extra_cost: extraCostNum,
                    payment_method: form.paymentMethod,
                    created_at: purchaseDate,
                    metadata: {
                        ...h.metadata,
                        qty: qtyNum,
                        subtotal: subtotalNum,
                        cash_phase: form.cashPhase,
                        after_stock: (h.metadata?.before_stock || 0) + qtyNum,
                    },
                    payments: paidAmount > 0 ? [{
                        amount: paidAmount,
                        payment_method: form.paymentMethod,
                        paid_at: purchaseDate,
                        cash_phase: form.cashPhase,
                        staff_name: profile?.name,
                    }] : []
                }
            }
            return h
        })

        const qtyDelta = qtyNum - (Number(entry.metadata?.qty) || 0)
        if (stockData && qtyDelta !== 0) {
            setStockData({
                ...stockData,
                current_stock: (stockData.current_stock || 0) + qtyDelta,
                warehouse_stock: (stockData.warehouse_stock || 0) + qtyDelta
            })
        }

        setHistory(updatedHistory)
        setEditingEntry(null)

        try {
            // Kho tổng nhóm: khớp lý do ở handleCancelRestock — sửa đúng theo address_id thật.
            await editIngredientRestock(entry.address_id || selectedAddress?.id, entry.id, {
                qty: qtyNum,
                subtotal: subtotalNum,
                discount: discountNum,
                extraCost: extraCostNum,
                paid: paidAmount,
                paymentMethod: form.paymentMethod,
                purchaseDate,
                cashPhase: form.cashPhase,
                staffName: profile?.name,
            })
            await Promise.all([reloadHistory(), reloadStock(), refreshProducts?.(), refreshTodayExpenses?.()])
            showToast('Đã sửa phiếu nhập kho', 'success')
        } catch (err) {
            setHistory(originalHistory)
            setStockData(originalStockData)
            showError(err, 'Sửa phiếu nhập kho')
        }
        finally { setSaving(false) }
    }

    async function handleDelete() {
        const label = ingredientLabel(ingredientKey)
        if (!await confirm({ title: `Xóa nguyên liệu "${label}"?`, detail: 'Sẽ gỡ khỏi tất cả công thức liên quan.', danger: true, confirmLabel: 'Xóa' })) return
        try {
            await deleteIngredientCost(ingredientKey, selectedAddress?.id)
            refreshProducts?.()
            navigate('/ingredients')
        } catch (err) { showError(err, 'Xóa nguyên liệu') }
    }

    const titleLabel = ingredientLabel(ingredientKey)
    // Có quy đổi → giá theo đơn vị đóng gói (dễ đối chiếu với hóa đơn NCC); không thì
    // theo đơn vị gốc.
    const costSubtitle = packSize && packUnit
        ? `1 ${packUnit} = ${formatVND(cost * packSize)}`
        : `1 ${unit} = ${formatVND(cost)}`

    // Onboarding phase 6 (CUỐI CÙNG, "Cài đặt nguyên liệu") — hint lần lượt 4 field trên đúng
    // ingredient "Cà phê", sau khi phase 5 (công thức) đã xong. nextIngredientSetupField trả về
    // field ĐẦU TIÊN chưa xong theo đúng thứ tự hiện trên UI — xem onboardingHint.js.
    const recipeProgress = useOnboardingProgress('recipeProgress', { isGuest, addressId: selectedAddress?.id })
    const isCoffee = isGuest && findCoffeeIngredient(ingredientConfigs)?.ingredient === ingredientKey
    const setupField = isCoffee && isRecipeProgressDone(recipeProgress)
        ? nextIngredientSetupField(config, stockData?.warehouse_stock_set)
        : null
    const hintWarehouse = setupField === 'warehouse'
    const hintPack = setupField === 'pack'
    const hintMinStock = setupField === 'minStock'
    const hintTare = setupField === 'tare'

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title={titleLabel}
                subtitle={costSubtitle}
                onBack={() => navigate('/ingredients', { state: location.state })}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRestock={canEdit ? () => setRestockOpen(true) : null}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-48 bg-bg space-y-4">
                {viewMode === 'details' ? (
                    <>
                        <IngredientDetailsTab
                            nameLabel={titleLabel}
                            unit={unit}
                            category={category}
                            packSize={packSize}
                            packUnit={packUnit}
                            minStock={minStock}
                            tareWeight={tareWeight}
                            countInAudit={countInAudit}
                            onToggleAudit={saveCountInAudit}
                            hintPack={hintPack}
                            hintMinStock={hintMinStock}
                            hintTare={hintTare}
                            canEdit={canEdit}
                            saving={saving}
                            onSaveName={saveName}
                            onSaveUnit={saveUnit}
                            onSaveMinStock={saveMinStock}
                            onSaveTareWeight={saveTareWeight}
                            onChangeCategory={saveCategory}
                            onConfigurePack={() => setPackModalOpen(true)}
                        />
                        <IngredientStockPanel
                            unit={unit}
                            packSize={packSize}
                            packUnit={packUnit}
                            warehouseStock={stockData?.warehouse_stock ?? null}
                            warehouseGroupNote={warehouseGroupNote}
                            hintWarehouse={hintWarehouse}
                            dailyContext={dailyContext}
                            canEdit={canEdit}
                            onSaveWarehouse={saveWarehouse}
                        />
                        <IngredientCounterPanel
                            unit={unit}
                            packSize={packSize}
                            packUnit={packUnit}
                            tareWeight={tareWeight}
                            counterStock={stockData?.counter_stock ?? null}
                            currentStock={currentStock}
                            siblingCounterStocks={siblingCounterStocks}
                            canEdit={canEdit}
                            onSaveCounter={saveCounter}
                        />
                        <DeleteIngredientButton canEdit={canEdit} onDelete={handleDelete} />
                    </>
                ) : (
                    <IngredientHistoryTab
                        loading={loading}
                        summary={summary}
                        history={history}
                        unit={unit}
                        packSize={packSize}
                        packUnit={packUnit}
                        monthLabel={monthLabel}
                        monthOffset={monthOffset}
                        onMonthChange={setMonthOffset}
                        onOpenPayment={canEdit ? setPaymentInvoice : null}
                        onCancelRestock={canEdit ? handleCancelRestock : null}
                        onEditRestock={canEdit ? setEditingEntry : null}
                        addressNameById={groupAddressIds.length > 1 ? addressNameById : null}
                    />
                )}
            </main>

            {paymentInvoice && (
                <InvoicePaymentSheet
                    invoice={paymentInvoice}
                    saving={saving}
                    onClose={() => setPaymentInvoice(null)}
                    onConfirm={handleRecordPayment}
                />
            )}

            {packModalOpen && (
                <PackConfigModal
                    open={true}
                    onClose={() => setPackModalOpen(false)}
                    ingredientLabel={titleLabel}
                    baseUnit={unit}
                    currentPackSize={packSize}
                    currentPackUnit={packUnit}
                    onSave={async ({ packSize: ps, packUnit: pu }) => {
                        await savePackConfig({ packSize: ps, packUnit: pu })
                        setPackModalOpen(false)
                    }}
                />
            )}

            {restockOpen && (
                <RestockModal
                    ingredient={ingredientKey}
                    unit={unit}
                    packSize={packSize}
                    packUnit={packUnit}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestockOpen(false)}
                    onConfirm={handleRestock}
                />
            )}

            {editingEntry && (
                <RestockModal
                    ingredient={ingredientKey}
                    unit={unit}
                    packSize={packSize}
                    packUnit={packUnit}
                    cashClosedToday={false}
                    mode="edit"
                    initial={{
                        qty: editingEntry.metadata?.qty ?? 0,
                        subtotal: editingEntry.metadata?.subtotal ?? editingEntry.amount ?? 0,
                        discount: editingEntry.discount_amount ?? 0,
                        extraCost: editingEntry.extra_cost ?? 0,
                        paid: (editingEntry.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
                        paymentMethod: editingEntry.payment_method || 'cash',
                        cashPhase: editingEntry.metadata?.cash_phase || 'post_close',
                        purchaseDate: dateStringVN(new Date(editingEntry.created_at)),
                        purchaseTime: timeStringVN(new Date(editingEntry.created_at)),
                    }}
                    onConfirm={(form) => handleEditRestock(editingEntry, form)}
                    onClose={() => setEditingEntry(null)}
                />
            )}

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
