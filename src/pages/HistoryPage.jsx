import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateProductCost, parseVNDInput, formatVNDInput } from '../utils'
import { getPendingOrders, removePendingOrder } from '../hooks/useOfflineSync'
import { dateStringVN } from '../utils/dateVN'
import { calcRangeWithLabel } from '../utils/rangeCalc'
import { goToMenuStep } from '../utils/menuSequence'
import { useDateScope } from '../hooks/useDateScope'
import { useHistoryRangeFetch } from '../hooks/useHistoryRangeFetch'
import { useFormatHistoryOrders } from '../hooks/useFormatHistoryOrders'
import { useAddress } from '../contexts/AddressContext'
import { useProducts } from '../contexts/ProductContext'
import { useCart } from '../contexts/CartContext'
import { useStats } from '../contexts/StatsContext'
import { useHistory } from '../contexts/HistoryContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useAuth } from '../contexts/AuthContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import { readOnboardingState, writeOnboardingState, DEFAULT_ONBOARDING_STATE, isInventoryProgressDone } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'
import { isRecipeStepActive } from '../components/common/onboarding/steps/recipeStep'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import OrdersList from '../components/HistoryPage/OrdersList'
import ExpensePanel from '../components/HistoryPage/ExpensePanel'
import AddExpenseModal from '../components/HistoryPage/AddExpenseModal'
import { shiftFinalizedKey, cashClosedKey } from '../constants/storageKeys'
import { Plus } from 'lucide-react'
import { fetchExpenseCategories, insertExpenseCategory, updateExpenseCategory, deleteExpenseCategory, fetchExpensesByCategory, fetchExpenseCategoryCounts, restoreExpenseCategory } from '../services/expenseService'
import Toast from '../components/POSPage/Toast'

// Use dateStringVN so YYYY-MM-DD always reflects Vietnam local date,
// regardless of where the browser runs.
const getLocalISO = (date = new Date()) => dateStringVN(date)

export default function HistoryPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { selectedAddress } = useAddress()
    const confirm = useConfirm()
    const { products, recipes, ingredientCosts, extraIngredients, refreshProducts } = useProducts()
    const {
        todayOrders, todayExpenses, isLoadingHistory, justArrivedIds,
        handleDeleteOrder, handleUpdateOrderDiscount, handleAddExpense, handleUpdateExpense, handleDeleteExpense, handleLoadHistory,
    } = useHistory()
    const { retrySync } = useStats()
    const { toast, showToast } = useCart()
    const { isGuest } = useAuth()
    const { requestRefresh: requestOnboardingRefresh } = useOnboardingVisibility()

    useEffect(() => {
        if (!isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Onboarding "Tạo đơn" step's 3rd requirement — "Xem nhật ký" — only counts once both
    // drinks are already done (see orderStep.jsx); visiting /history before that doesn't
    // tick it, so the order matters, not just "has this page ever been opened".
    useEffect(() => {
        if (!isGuest || !selectedAddress?.id) return
        const { orderProgress } = readOnboardingState(selectedAddress.id)
        if (orderProgress.cafeSua && orderProgress.cacaoCaPheLon && orderProgress.matcha && !orderProgress.viewedHistory) {
            writeOnboardingState(selectedAddress.id, { orderProgress: { ...orderProgress, viewedHistory: true } })
            requestOnboardingRefresh()
        }
    }, [isGuest, selectedAddress?.id, requestOnboardingRefresh])

    // ─── Navigation state ─────────────────────────────────────────────
    const initialTab = location.state?.tab === 'expense' ? 'expense' : 'orders'
    const expensesToView = location.state?.expensesToView  // read-only past date list
    const isReadOnly = location.state?.isReadOnly || false
    const backTo = location.state?.from || '/pos'

    // ─── UI state ─────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState(initialTab)
    const [showAddModal, setShowAddModal] = useState(false)

    // Onboarding phase 2 "Nhật ký" — tick theo tab /history user tự bấm qua (Thu nhập/Chi
    // phí/Báo cáo, xem HistoryTabsBar.jsx + journalStep.jsx). "Xem thu nhập" chỉ cần tick 1
    // lần lúc khởi tạo state (là tab mặc định, không đổi lại sau đó); "Xem chi phí" theo dõi
    // lại mỗi render vì user có thể bấm qua tab đó bất cứ lúc nào (render-time-adjust, cùng
    // pattern với useOrderOnboardingProgress.js). Persist dùng chung
    // useOnboardingProgressPersist với orderProgress.
    const [journalProgress, setJournalProgress] = useState(() => {
        const stored = isGuest && selectedAddress?.id ? readOnboardingState(selectedAddress.id).journalProgress : DEFAULT_ONBOARDING_STATE.journalProgress
        return initialTab === 'orders' && !stored.viewedIncome ? { ...stored, viewedIncome: true } : stored
    })
    if (isGuest && activeTab === 'expense' && !journalProgress.viewedExpense) {
        setJournalProgress(prev => ({ ...prev, viewedExpense: true }))
    }
    useOnboardingProgressPersist('journalProgress', journalProgress, { isGuest, addressId: selectedAddress?.id, requestOnboardingRefresh })
    // Hint tuần tự: Chi phí trước, Báo cáo sau khi Chi phí đã xong.
    const journalHintTab = !isGuest ? null
        : !journalProgress.viewedExpense ? 'expense'
            : !journalProgress.viewedReport ? 'report'
                : null

    // Phase 5 "Điều chỉnh công thức" không còn nút riêng trong guide — hint thẳng vào mũi tên
    // "tiến" ở header (như DailyReportPage.jsx), cho user quay lại /history rồi đi tiếp tới
    // /recipes qua menuSequence.js. inventoryProgress/recipeProgress không thuộc trang này —
    // đọc read-only qua useOnboardingProgress (xem recipeStep.jsx).
    const inventoryProgress = useOnboardingProgress('inventoryProgress', { isGuest, addressId: selectedAddress?.id })
    const recipeProgress = useOnboardingProgress('recipeProgress', { isGuest, addressId: selectedAddress?.id })
    const hintGoToRecipes = isGuest && isRecipeStepActive(isInventoryProgressDone(inventoryProgress), recipeProgress)

    // Date selection (scope/offset/customRange + handlers) lives in the shared
    // hook so /history and /daily-report stay in lock-step. Seeded from nav state
    // so a window survives the Nhật ký ↔ Báo cáo tab switch.
    const date = useDateScope(location.state)
    const {
        scope, offset, customRange,
        todayISO, dayInputValue, canGoForwardDay, canGoForwardPeriod, navState: dateNavState,
        goPrevDay, goNextDay, goOffsetPrev, goOffsetNext,
        applyRange, shiftRange, canShiftRangeForward, applyPreset,
    } = date

    // ─── Orders state ─────────────────────────────────────────────────
    const [deletingId, setDeletingId] = useState(null)
    const [pendingOrders, setPendingOrders] = useState(() => getPendingOrders())
    const [isSyncing, setIsSyncing] = useState(false)

    // ─── Expense state ────────────────────────────────────────────────

    // ─── Add-expense form state ───────────────────────────────────────
    // `expenseCategory` here = top tab. 'expense' → Vận hành (operating tags),
    // 'fixed' → Quản lý & khác (overhead tags). The legacy 'fixed' key is kept
    // to avoid touching scattered handlers; semantically it now drives only
    // group_section, not the fixed_costs template flow (which is deprecated).
    const [expenseCategory, setExpenseCategory] = useState('expense')
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [expenseDate, setExpenseDate] = useState(() => getLocalISO()) // ngày chi, default hôm nay
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [selectedCategoryId, setSelectedCategoryId] = useState(null)
    const [expenseCategories, setExpenseCategories] = useState([])
    const [isAfterShift, setIsAfterShift] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState('cash')
    // null = đang TẠO mới; có object = đang SỬA chi phí đó (modal prefill từ thẻ).
    const [editingExpense, setEditingExpense] = useState(null)

    // Fetch tags on mount + whenever the modal opens (cache-backed). Card list
    // also needs categories to resolve the tag chip on each ExpenseCard, so we
    // can't gate solely on modal open.
    useEffect(() => {
        if (!selectedAddress?.id) return
        fetchExpenseCategories(selectedAddress.id).then(setExpenseCategories)
    }, [selectedAddress?.id, showAddModal])

    // Auto-pick a default category khi mở modal mà CHƯA có nhãn nào chọn. KHÔNG
    // re-pick theo nhóm legacy nữa: việc đổi Phân loại (group) + chọn nhãn đầu của
    // nhóm mới do dropdown trong AddExpenseModal đảm nhiệm. Effect cũ map về
    // operating/overhead làm nhãn nhóm Tồn kho / Ngoài kinh doanh bị ghi đè ngược.
    useEffect(() => {
        if (!showAddModal || expenseCategories.length === 0) return
        const current = expenseCategories.find(c => c.id === selectedCategoryId)
        if (current) return // đã có nhãn hợp lệ (bất kể nhóm) → giữ nguyên
        const fallback =
            expenseCategories.find(c => c.is_default && c.group_section === 'operating' && c.name === 'Chi phí khác')
            || expenseCategories.find(c => c.group_section === 'operating')
            || expenseCategories[0]
            || null
        setSelectedCategoryId(fallback?.id || null)
    }, [showAddModal, expenseCategories, selectedCategoryId])

    // Reset form when modal closes; seed isAfterShift from current finalized state.
    // KHÔNG đụng khi đang SỬA — openEditExpense đã prefill từ thẻ chi phí.
    useEffect(() => {
        if (!showAddModal) {
            setCostName('')
            setCostAmount('')
            setExpenseCategory('expense')
            setSelectedCategoryId(null)
            setExpenseDate(getLocalISO())
            setIsAfterShift(false)
            setPaymentMethod('cash')
            setEditingExpense(null)
        } else if (!editingExpense) {
            // Default toggle to "Sau chốt ca" when shift or cash is already closed
            const today = getLocalISO()
            const finalized = selectedAddress?.id && (
                !!localStorage.getItem(shiftFinalizedKey(selectedAddress.id, today)) ||
                !!localStorage.getItem(cashClosedKey(selectedAddress.id, today))
            )
            setIsAfterShift(!!finalized)
        }
    }, [showAddModal, selectedAddress?.id]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreateCategory = useCallback(async ({ name, group_section }) => {
        if (!selectedAddress?.id) return null
        const created = await insertExpenseCategory(selectedAddress.id, { name, group_section })
        setExpenseCategories(prev => [...prev, created])
        return created
    }, [selectedAddress?.id])

    const handleUpdateCategory = useCallback(async (id, updates) => {
        const updated = await updateExpenseCategory(id, updates)
        setExpenseCategories(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
        return updated
    }, [])

    // Soft-delete an EMPTY label (no expenses attached). The sheet lists a label's
    // expenses first — a label still holding expenses must have each row moved to
    // another label before this runs, so we never silently dump rows into "Chi phí khác".
    const handleDeleteCategoryTag = useCallback(async (id) => {
        await deleteExpenseCategory(id)
        setExpenseCategories(prev => prev.filter(c => c.id !== id))
    }, [])

    const handleListCategoryExpenses = useCallback(
        (id) => fetchExpensesByCategory(selectedAddress?.id, id),
        [selectedAddress?.id]
    )

    const handleCountCategories = useCallback(
        () => fetchExpenseCategoryCounts(selectedAddress?.id),
        [selectedAddress?.id]
    )

    // Hoàn tác xoá nhãn: bật lại is_active + đưa lại vào danh sách. Việc trả các
    // chi phí về nhãn cũ do sheet lo (gọi onMoveExpense ngược).
    const handleRestoreCategory = useCallback(async (category) => {
        await restoreExpenseCategory(category.id)
        setExpenseCategories(prev => prev.some(c => c.id === category.id) ? prev : [...prev, category])
    }, [])

    // ─── Range fetch ──────────────────────────────────────────────────
    const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
        const { start, end, label } = calcRangeWithLabel(scope, offset, customRange)
        return { rangeStart: start, rangeEnd: end, rangeLabel: label }
    }, [scope, offset, customRange])

    const isTodayScope = scope === 'day' && offset === 0

    // ─── Range data fetchers ──────────────────────────────────────────
    const { rangeExpenses, rangeOrders, isLoadingRange, isLoadingRangeOrders, patchExpense: patchRangeExpense } = useHistoryRangeFetch({
        addressId: selectedAddress?.id,
        rangeStart, rangeEnd,
        isTodayScope, isReadOnly,
    })

    // Move ONE expense to another label (re-tag). Patches both the today list
    // (via POS handler) and the range list so the moved card shows its new tag
    // immediately; report cards refetch on their own via cache invalidation.
    const handleMoveExpense = useCallback(async (expenseId, toId) => {
        await handleUpdateExpense(expenseId, { category_id: toId })
        if (!isTodayScope && patchRangeExpense) patchRangeExpense(expenseId, { category_id: toId })
    }, [handleUpdateExpense, isTodayScope, patchRangeExpense])

    // ─── Offline order sync ───────────────────────────────────────────
    const refreshPending = useCallback(() => setPendingOrders(getPendingOrders()), [])

    const handleDeleteOffline = useCallback(async (createdAt) => {
        if (!await confirm({ title: 'Xóa đơn offline này khỏi máy?', danger: true, confirmLabel: 'Xóa' })) return
        removePendingOrder(createdAt)
        refreshPending()
    }, [refreshPending, confirm])

    const handleRetrySync = useCallback(async () => {
        if (!retrySync) return
        setIsSyncing(true)
        try { await retrySync() }
        finally { setIsSyncing(false); refreshPending() }
    }, [retrySync, refreshPending])

    // ─── Orders data ──────────────────────────────────────────────────
    // Stable callback so downstream useMemos don't bust on every render.
    // snapshotUnitCost > 0 means the cost was frozen on the DB row at sale time —
    // honor it instead of recomputing from current recipes/prices.
    const getItemCost = useCallback((productId, extras, snapshotUnitCost) => {
        if (snapshotUnitCost > 0) return snapshotUnitCost
        return calculateProductCost(productId, extras || [], recipes, extraIngredients, ingredientCosts)
    }, [recipes, extraIngredients, ingredientCosts])

    const baseOrders = isTodayScope ? (todayOrders || []) : rangeOrders

    // PERF: index products by id once (was: products?.find() inside every order's item map).
    const productById = useMemo(() => {
        const m = new Map()
        for (const p of products || []) m.set(p.id, p)
        return m
    }, [products])

    const { allOrders } = useFormatHistoryOrders({
        baseOrders, pendingOrders, productById, getItemCost, isTodayScope,
    })

    const productCountMap = useMemo(() => new Map((products || []).map(p => [p.id, p.count_as_cup !== false])), [products])

    const totalCups = useMemo(() => allOrders.reduce((sum, o) => {
        if (o.isExpense || !o.items || o.deletedAt) return sum
        return sum + o.items.reduce((itemSum, item) => {
            if (item.productId && productCountMap.get(item.productId) === false) return itemSum
            return itemSum + (item.quantity || 0)
        }, 0)
    }, 0), [allOrders, productCountMap])

    const runningTotals = useMemo(() => {
        const map = new Map()
        let cumulative = 0
        for (let i = allOrders.length - 1; i >= 0; i--) {
            const order = allOrders[i]
            if (!order.deletedAt) cumulative += order.total
            map.set(order.id, cumulative)
        }
        return map
    }, [allOrders])

    // runningTotals is cumulative newest-first, so allOrders[0]'s value is the grand total.
    const totalRevenue = runningTotals.get(allOrders[0]?.id) || 0

    // ─── Expense data ─────────────────────────────────────────────────
    const baseExpenses = useMemo(() => {
        if (expensesToView) return expensesToView
        if (isTodayScope) return todayExpenses || []
        return rangeExpenses
    }, [expensesToView, isTodayScope, todayExpenses, rangeExpenses])

    // Expense list shown in /history excludes NVL refills — biến động kho mỗi
    // nguyên liệu sống ở /ingredient/:id. NVL vẫn xuất hiện trong dòng tiền
    // (CashFlowCard) vì là cash-out thật, chỉ không trừ lại trong P&L.
    // Free-form refills (chi linh tinh sau ca) vẫn là expense thường → giữ lại.
    const expensesForList = useMemo(
        () => baseExpenses
            .filter(e => !e.is_refill || e.metadata?.free_form)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
        [baseExpenses]
    )

    const isLoadingExpenses = isReadOnly ? false : (isTodayScope ? isLoadingHistory : isLoadingRange)

    // ─── Action handlers ──────────────────────────────────────────────
    // "Thực chi" only: mọi chi phí đều là expense thực được ghi nhận tại
    // thời điểm chi tiêu. Tab chỉ quyết định group_section qua tag (operating
    // vs overhead) — không còn fixed_costs template / auto-inject.
    // Mở modal ở chế độ SỬA — prefill mọi field từ thẻ chi phí.
    const openEditExpense = useCallback((expense) => {
        setEditingExpense(expense)
        setCostName(expense.name || '')
        setCostAmount(formatVNDInput(String(expense.amount ?? '')))
        setExpenseDate(getLocalISO(new Date(expense.created_at)))
        setIsAfterShift(!!expense.metadata?.free_form)
        setPaymentMethod(expense.payment_method || 'cash')
        setSelectedCategoryId(expense.category_id || null)
        setShowAddModal(true)
    }, [])

    const submitExpense = async () => {
        const amount = parseVNDInput(costAmount)
        if (amount <= 0 || !costName.trim()) return
        setIsSubmitting(true)
        try {
            const tagId = selectedCategoryId || null
            const today = getLocalISO()
            // Phase: "Sau chốt ca" lưu is_refill=true + metadata.free_form; "Trong ca" thì không.
            const isRefill = !!isAfterShift
            const metadata = isAfterShift ? { free_form: true } : {}

            if (editingExpense) {
                // SỬA: chỉ đổi created_at khi NGÀY khác ngày gốc (giữ giờ gốc nếu cùng ngày).
                const sameDay = getLocalISO(new Date(editingExpense.created_at)) === expenseDate
                const createdAt = sameDay
                    ? editingExpense.created_at
                    : new Date(`${expenseDate}T12:00:00+07:00`).toISOString()
                await handleUpdateExpense(editingExpense.id, {
                    name: costName.trim(), amount, payment_method: paymentMethod,
                    category_id: tagId, created_at: createdAt, is_refill: isRefill, metadata,
                })
                if (!isTodayScope && patchRangeExpense) {
                    patchRangeExpense(editingExpense.id, {
                        name: costName.trim(), amount, payment_method: paymentMethod,
                        category_id: tagId, created_at: createdAt, is_refill: isRefill, metadata,
                    })
                }
                setShowAddModal(false)
                return
            }

            // TẠO mới — backdate: anchor noon VN; null = today → server NOW() giữ giờ thật.
            const isBackdated = expenseDate && expenseDate !== today
            const createdAt = isBackdated ? new Date(`${expenseDate}T12:00:00+07:00`).toISOString() : null
            await handleAddExpense(costName.trim(), amount, isRefill, paymentMethod, metadata, false, tagId, createdAt)
            setShowAddModal(false)
        } catch { /* lỗi đã được context surface qua toast */ }
        finally { setIsSubmitting(false) }
    }

    // Xoá từ trong modal sửa.
    const deleteEditingExpense = async () => {
        if (!editingExpense) return
        if (!await confirm({ title: `Xóa chi phí "${editingExpense.name}"?`, detail: 'Hành động này không thể hoàn tác!', danger: true, confirmLabel: 'Xóa' })) return
        await deleteExpense(editingExpense.id, editingExpense.amount)
        setShowAddModal(false)
    }

    const deleteExpense = async (id, amount) => {
        // If the deleted expense was a refill bound to an ingredient, the server-side
        // stock formula (warehouse_stock = Σ refill − Σ restock) will recompute on next
        // fetch — trigger refreshProducts so unit cost / ingredient list stay in sync.
        const target = baseExpenses.find(e => e.id === id)
        const wasInventoryRefill = !!(target?.is_refill && target?.metadata?.ingredient)
        await handleDeleteExpense(id, amount)
        if (wasInventoryRefill) await refreshProducts?.()
    }

    const handleReportNav = () => {
        // Phase 2 "Nhật ký" hoàn tất khi user tự bấm sang tab Báo cáo (điều hướng đi luôn nên
        // không có activeTab==='report' để bắt qua effect như 2 tab kia — ghi thẳng ở đây).
        if (isGuest && selectedAddress?.id && !journalProgress.viewedReport) {
            const next = { ...journalProgress, viewedReport: true }
            writeOnboardingState(selectedAddress.id, { journalProgress: next })
            requestOnboardingRefresh()
        }
        // Tab-switch within the Nhật-ký/Báo-cáo dashboard: use replace so the back button
        // returns to the entry point (e.g. /addresses) instead of cycling through tab toggles.
        // dateNavState ({ scope, offset, customRange }) carries the full window so
        // /daily-report opens on the same selection instead of resetting to "hôm nay".
        navigate('/daily-report', { replace: true, state: { from: backTo, ...dateNavState } })
    }

    // ─── Render ───────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            <HistoryHeader
                rangeLabel={rangeLabel}
                totalCups={totalCups}
                scope={scope}
                isReadOnly={isReadOnly}
                canGoForward={canGoForwardPeriod}
                onBack={() => goToMenuStep(activeTab, -1, { navigate, backTo, setActiveTab, goReport: handleReportNav, wizard: location.state?.wizard })}
                onForward={() => goToMenuStep(activeTab, +1, { navigate, backTo, setActiveTab, goReport: handleReportNav, wizard: location.state?.wizard })}
                hintForward={hintGoToRecipes}
                activeTab={activeTab}
                hintTab={journalHintTab}
                onTabSelect={(tab) => {
                    if (tab === 'report') handleReportNav()
                    else setActiveTab(tab)
                }}
                onOffsetPrev={goOffsetPrev}
                onOffsetNext={goOffsetNext}
                rangeStartISO={rangeStart ? getLocalISO(rangeStart) : undefined}
                rangeEndISO={rangeEnd ? getLocalISO(rangeEnd) : undefined}
                dayInputValue={dayInputValue}
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={goPrevDay}
                onNextDay={goNextDay}
                customRange={customRange}
                onRangeChange={applyRange}
                onShiftRange={shiftRange}
                canShiftRangeForward={canShiftRangeForward}
                onPresetSelect={applyPreset}
            />

            {activeTab === 'orders' && (
                <OrdersList
                    orders={allOrders}
                    totalCups={totalCups}
                    totalRevenue={totalRevenue}
                    runningTotals={runningTotals}
                    isLoading={isTodayScope ? isLoadingHistory : isLoadingRangeOrders}
                    isTodayScope={isTodayScope}
                    justArrivedIds={isTodayScope ? justArrivedIds : null}
                    pendingOrders={pendingOrders}
                    isSyncing={isSyncing}
                    onRetrySync={handleRetrySync}
                    onDeleteOffline={handleDeleteOffline}
                    onDeleteOrder={handleDeleteOrder}
                    onUpdateDiscount={handleUpdateOrderDiscount}
                    deletingId={deletingId}
                    setDeletingId={setDeletingId}
                    dineIn={!!selectedAddress?.dine_in}
                />
            )}

            {activeTab === 'expense' && (
                <ExpensePanel
                    isReadOnly={isReadOnly}
                    isLoading={isLoadingExpenses}
                    expenses={expensesForList}
                    expenseCategories={expenseCategories}
                    onEditExpense={openEditExpense}
                />
            )}

            {/* FAB: Add expense — floating bottom-right, matching the /recipes & /ingredients
                FAB position (the date-picker footer is gone, so it sits flush to the bottom). */}
            {activeTab === 'expense' && !isReadOnly && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    <div className="flex justify-end px-4 pb-[max(env(safe-area-inset-bottom),16px)] pointer-events-auto">
                        <button
                            onClick={() => setShowAddModal(true)}
                            aria-label="Thêm chi phí"
                            className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center justify-center text-[13px] font-bold uppercase tracking-wider text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
            )}

            {showAddModal && (
                <AddExpenseModal
                    isEditing={!!editingExpense}
                    onDelete={deleteEditingExpense}
                    expenseCategory={expenseCategory}
                    costName={costName}
                    costAmount={costAmount}
                    isSubmitting={isSubmitting}
                    isAfterShift={isAfterShift}
                    onAfterShiftChange={setIsAfterShift}
                    expenseCategories={expenseCategories}
                    selectedCategoryId={selectedCategoryId}
                    onCategoryIdChange={setSelectedCategoryId}
                    onCreateCategory={handleCreateCategory}
                    onUpdateCategory={handleUpdateCategory}
                    onDeleteCategory={handleDeleteCategoryTag}
                    onListCategoryExpenses={handleListCategoryExpenses}
                    onMoveExpense={handleMoveExpense}
                    onCountCategories={handleCountCategories}
                    onRestoreCategory={handleRestoreCategory}
                    showToast={showToast}
                    onClose={() => setShowAddModal(false)}
                    onSubmit={submitExpense}
                    onCategoryChange={setExpenseCategory}
                    onNameChange={setCostName}
                    onAmountChange={setCostAmount}
                    expenseDate={expenseDate}
                    onDateChange={setExpenseDate}
                    paymentMethod={paymentMethod}
                    onPaymentMethodChange={setPaymentMethod}
                />
            )}

            {/* Toast nâng lên trên modal/sheet (z-[100]) để nút Hoàn tác bấm được.
                Wrapper inset-0 pointer-events-none cho click xuyên qua, chỉ toast nhận click. */}
            <div className="fixed inset-0 z-[200] pointer-events-none">
                <div className="pointer-events-auto">
                    <Toast toast={toast} />
                </div>
            </div>
        </div>
    )
}
