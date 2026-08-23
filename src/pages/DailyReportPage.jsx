import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { formatVNDInput, parseVNDInput } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart, splitExpenses } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext, fetchLastWeekSameDayOrderItems, processIngredientRestock, fetchOpenTables, invalidateDailyContext, editIngredientRestock, fetchIngredientRestockHistory } from '../services/orderService'
import { fetchCashClosedToday, buildCashPayload } from '../services/reportService'
import { useShiftClosingSave } from '../hooks/useShiftClosingSave'
import { useShiftInventoryState } from '../hooks/useShiftInventoryState'
import { useDailyReportData } from '../hooks/useDailyReportData'
import { onTabReturn } from '../utils/tabVisibility'
import { calculateEstimatedConsumption, calculateConsumptionBreakdown, splitCogsByCategory, calculateLossValue, buildRecipeIngredientSet, buildIngredientToProduct, averageIngredientMaps, r1 } from '../utils/inventory'
import { ingredientLabel, getIngredientUnit, lookupByLabel } from '../utils/ingredients'
import { findCoffeeIngredient, findIngredientByLabel } from '../utils/onboardingHint'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, isCashFlowProgressDone, isInventoryProgressDone } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { isRecipeStepActive } from '../components/common/onboarding/steps/recipeStep'
import { dateStringVN, timeStringVN, isSameDayVN, dateShortVN, dateFullVN } from '../utils/dateVN'
import { useDateScope } from '../hooks/useDateScope'
import { goToMenuStep } from '../utils/menuSequence'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import SalesCard from '../components/DailyReportPage/SalesCard'
import DayPerformanceChart from '../components/DailyReportPage/DayPerformanceChart'
import CashFlowCard from '../components/DailyReportPage/CashFlowCard'
import ExpenseEditorModal from '../components/DailyReportPage/ExpenseEditorModal'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import { fetchExpenseCategories } from '../services/expenseService'
import PastInventoryEditor from '../components/DailyReportPage/PastInventoryEditor'
import InventoryReportCard from '../components/DailyReportPage/InventoryReportCard'
import MissingCupSuspicionCard from '../components/DailyReportPage/MissingCupSuspicionCard'
import { useMissingCupSuspicion } from '../hooks/useMissingCupSuspicion'
import ShiftPrepCard from '../components/DailyReportPage/ShiftPrepCard'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import RangeLossCard from '../components/DailyReportPage/RangeLossCard'
import SupportModal from '../components/common/SupportModal'
import { Truck, Package, Loader2 } from 'lucide-react'
import ReportViewFilter, { VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY } from '../components/DailyReportPage/ReportViewFilter'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import { useEntitlement } from '../hooks/useEntitlement'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../contexts/ConfirmContext'
import { shiftFinalizedKey, cashClosedKey } from '../constants/storageKeys'

// "Soạn cho hôm nay" coi là đã làm khi Nhập thêm (restock) khác 0 — rỗng/0 = chưa soạn.
const isPrepFilled = (v) => v !== undefined && v !== null && v !== '' && Number(v) !== 0

// Mốc lịch sử cho dự báo Soạn/Chuẩn bị — 3 tuần gần nhất cùng thứ, trung bình hoá (xem
// averageIngredientMaps) thay vì chỉ đúng 1 tuần trước để đỡ nhạy với 1 ngày bất thường.
const HISTORY_OFFSETS_TODAY = [7, 14, 21]     // cùng thứ HÔM NAY
const HISTORY_OFFSETS_TOMORROW = [6, 13, 20]  // cùng thứ NGÀY MAI

export default function DailyReportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits, ingredientConfigs, refreshProducts } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, refreshTodayExpenses } = useHistory()
    const { isStaff, profile, isGuest } = useAuth()
    const { hasAccess, loading: entitlementLoading, enabled: monetizationEnabled } = useEntitlement()
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    // ── All hooks unconditional (Rules of Hooks) ──────────────────────────────
    const initialView = [VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY].includes(location.state?.initialView)
        ? location.state.initialView : VIEW_CASHFLOW
    const [view, setView] = useState(initialView)
    // Mỗi view là 1 "trang" riêng → đổi view thì cuộn lại đầu (cùng 1 <main> nên scroll bị dính).
    const mainRef = useRef(null)
    useEffect(() => { mainRef.current?.scrollTo(0, 0) }, [view])
    // Footer (Dòng tiền/Tồn kho/Lợi nhuận) chiếm chỗ thật ở đáy màn hình — báo chiều cao thật
    // cho onboarding guide (fixed, không tự né layout) để nó tự đẩy lên tránh đè.
    const footerRef = useRef(null)
    const { setBottomOffset, requestRefresh: requestOnboardingRefresh } = useOnboardingVisibility()
    useEffect(() => {
        const el = footerRef.current
        if (!el) return
        const update = () => setBottomOffset(el.getBoundingClientRect().height)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => { ro.disconnect(); setBottomOffset(0) }
    }, [setBottomOffset])
    const [showSupportModal, setShowSupportModal] = useState(false)
    const { selectedAddress } = useAddress()
    const initialDate = location.state?.initialDate || null

    // Date selection (scope/offset/customRange + every transition handler) lives in
    // the shared hook so /daily-report and /history stay in lock-step. Seeded from
    // nav state so a week/month/custom window survives the Nhật ký ↔ Báo cáo switch.
    const date = useDateScope(location.state)
    const {
        scope, offset, customRange,
        dayInputValue, canGoForwardDay, canGoForwardPeriod, navState: dateNavState,
        goPrevDay, goNextDay, goOffsetPrev, goOffsetNext,
        applyRange, shiftRange, canShiftRangeForward, applyPreset, goToDate,
    } = date


    // Deep-link: open on a specific past date passed via nav state (e.g. from a
    // "xem ngày X" link). Runs once; the hook clamps future dates to today.
    useEffect(() => {
        if (initialDate && initialDate !== dateStringVN(new Date())) goToDate(initialDate)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialDate])

    // All server-data state (shift closing, yesterday comparison, range data,
    // todayISO midnight rollover) lives in useDailyReportData. setShiftClosing
    // is exposed so save handlers can patch it inline after a write.
    const {
        todayISO,
        isTodayScope,
        rangeStart, rangeEnd,
        shiftClosing, setShiftClosing,
        yesterdayClosing,
        apiOrders,
        apiExpenses, setApiExpenses,
        apiPayments,
        todayPayments, setTodayPayments,
        apiShiftClosings,
        prevShiftClosings,
        isAsyncReady,
        refetch: refetchReport,
    } = useDailyReportData({
        addressId: selectedAddress?.id,
        scope, offset, customRange,
        onError: showError,
    })

    // Inline cash/transfer editor (today scope only). Pre-fills from shiftClosing when
    // it loads; cashDirty is derived from input vs. persisted so reverting the change
    // makes the Lưu button disappear again.
    const [cashInput, setCashInput] = useState('')
    const [transferInput, setTransferInput] = useState('')
    const { save: saveShiftClosing, isSaving: isSavingShift } = useShiftClosingSave(selectedAddress?.id)

    // Onboarding phase 3 "Báo cáo dòng tiền" + phase 4 "Báo cáo tồn kho" progress — xem
    // cashReportStep.jsx/inventoryStep.jsx. Cờ chỉ set true (không revert) nên không tái xuất
    // hiện khi dữ liệu hôm sau reset. cash/transfer set trong handleSaveCashflow (đòi hỏi bấm
    // "Lưu"); coffee set ngay khi gõ (không cần lưu) — xem khối render-time-adjust bên dưới.
    const [initialOnboardingState] = useState(() =>
        isGuest && selectedAddress?.id ? readOnboardingState(selectedAddress.id) : DEFAULT_ONBOARDING_STATE
    )
    const [cashFlowProgress, setCashFlowProgress] = useState(initialOnboardingState.cashFlowProgress)
    const [inventoryProgress, setInventoryProgress] = useState(initialOnboardingState.inventoryProgress)
    useOnboardingProgressPersist('cashFlowProgress', cashFlowProgress, { isGuest, addressId: selectedAddress?.id, requestOnboardingRefresh })
    useOnboardingProgressPersist('inventoryProgress', inventoryProgress, { isGuest, addressId: selectedAddress?.id, requestOnboardingRefresh })

    // Cảnh báo khi tick/bỏ-qua của MÁY NÀY vừa bị máy khác ghi đè (race giữa 2 lượt merge
    // gần như đồng thời trên cùng nguyên liệu) — xem onFieldConflict trong useShiftInventoryState.
    const onInventoryFieldConflict = useCallback((ingredient) => {
        showToast(`${ingredientLabel(ingredient)}: vừa được cập nhật từ máy khác, kiểm tra lại`, 'warning')
    }, [showToast])

    // Số thực thu ĐÃ LƯU của lần render gần nhất — onRemoteCash cần đọc đồng bộ để biết ô nào
    // người dùng đang gõ dở. Gán ở dưới, ngay chỗ tính persistedCash (sau khi shiftClosing về).
    const persistedCashRef = useRef({ cash: 0, transfer: 0 })

    // Máy kia vừa lưu thực thu → nhận nguyên dòng qua kênh realtime của kiểm kê (không tốn
    // request). Nạp lại CHỈ ô người này chưa đụng — cùng luật per-field dirty với kiểm kê, để
    // số đang gõ dở không bị giật mất.
    const onRemoteCash = useCallback((row) => {
        setShiftClosing(prev => ({ ...prev, ...row }))
        const adopt = (setInput, remote, wasPersisted) => setInput(prev => (
            (parseVNDInput(prev) || 0) !== wasPersisted ? prev : (remote ? formatVNDInput(remote) : '')
        ))
        adopt(setCashInput, row.actual_cash, persistedCashRef.current.cash)
        adopt(setTransferInput, row.actual_transfer, persistedCashRef.current.transfer)
    }, [setShiftClosing])

    // Inventory editor (today scope only). All input state + warehouse fetch live in
    // the hook so DailyReportPage stays focused on render orchestration. todayISO
    // drives existingClosing refetch on midnight rollover.
    // onRemoteCash chỉ truyền ở scope Hôm nay: xem ngày cũ mà nuốt event của hôm nay sẽ
    // ghi đè shiftClosing của ngày đang xem.
    // seed: useDailyReportData đã fetch đúng cặp shift_closing/yesterday_closing của NGÀY ĐANG
    // XEM rồi — cho cả "Hôm nay" LẪN 1 ngày quá khứ cụ thể (scope === 'day'), chỉ range tuần/
    // tháng mới không có cặp này (fetch mảng nhiều phiếu thay vì 1 cặp). Truyền xuống để hook
    // khỏi tự fetch trùng (và ở scope quá khứ, khỏi fetch NHẦM phiếu hôm nay).
    const isDayScope = scope === 'day'
    const inventorySeed = useMemo(
        () => ({ isDayScope, seedReady: isDayScope && isAsyncReady, todayClosing: shiftClosing, yesterdayClosing }),
        [isDayScope, isAsyncReady, shiftClosing, yesterdayClosing]
    )
    const inventory = useShiftInventoryState(selectedAddress?.id, selectedAddress?.ingredient_sort_order, todayISO, onInventoryFieldConflict, isTodayScope ? onRemoteCash : undefined, inventorySeed)

    // Same-day-last-week order items — feeds the refill forecast ("Bổ sung mai")
    // inside InventoryReportCard. Today scope only; cached per address+day.
    // Mỗi phần tử = 1 tuần lịch sử (items thô); trung bình hoá ở averageIngredientMaps bên
    // dưới để dự báo đỡ nhạy với 1 ngày bất thường (nghỉ lễ, vắng khách đột xuất) của đúng 1 tuần.
    const [lastWeekItemsWeeks, setLastWeekItemsWeeks] = useState([])        // today−7/14/21: dự báo hôm nay (Soạn)
    const [nextDowItemsWeeks, setNextDowItemsWeeks] = useState([]) // today−6/13/20: dự báo mai (Chuẩn bị)

    // "Soạn cho hôm nay" KHÔNG còn tick state riêng: checkbox suy ra từ Nhập thêm
    // (restock) và tick chỉ là lối tắt set/clear restock. restock đã sync Realtime nên
    // multi-device tự đồng bộ. Xem prepCheckedDerived / togglePrepRestock dưới prepTodayList.

    // "Chuẩn bị tồn kho" giờ actionable: bấm nút + ở mỗi dòng để mở phiếu Nhập kho cho
    // NVL/bao bì tương ứng (tái dùng RestockModal của /ingredients). "Đã chuẩn bị" suy ra
    // từ tồn kho đạt target (món tự rớt khỏi list sau khi nhập), không còn tick thủ công.
    // Không gate chốt ca. cashClosedToday refetch khi mở modal để phân loại dòng tiền đúng.
    const [restockIngredient, setRestockIngredient] = useState(null)
    const [restockSuggestedQty, setRestockSuggestedQty] = useState(null)
    const [cashClosedToday, setCashClosedToday] = useState(false)
    useEffect(() => {
        if (!restockIngredient) return
        let alive = true
        fetchCashClosedToday(selectedAddress?.id).then(v => { if (alive) setCashClosedToday(!!v) })
        // Reload tồn ngay khi mở modal → thấy số kho mới nhất trước khi mua, thu hẹp cửa sổ
        // mua trùng giữa nhiều máy (tồn không sync realtime).
        inventory.reloadStocks?.()
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restockIngredient, selectedAddress?.id])

    // Soạn tick/skip tự lưu (không cần bấm "Lưu báo cáo" riêng). Debounce gom nhiều
    // tick liên tiếp thành 1 lần lưu — tránh đụng guard isSaving (lưu chồng bị bỏ) và
    // tránh remount storm. handleSaveInvRef trỏ bản handleSaveInventory mới nhất nên
    // timer luôn chạy đúng state hiện tại. autoSavePending ẩn FAB trong lúc chờ để user
    // không bấm "Lưu" thủ công (kèm confirm) đè lên auto-lưu.
    const handleSaveInvRef = useRef(null)
    const autoSaveTimerRef = useRef(null)
    const [autoSavePending, setAutoSavePending] = useState(false)
    const triggerAutoSave = useCallback(() => {
        setAutoSavePending(true)
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = setTimeout(async () => {
            try { await handleSaveInvRef.current?.({ silent: true }) }
            finally { setAutoSavePending(false) }
        }, 450)
    }, [])
    useEffect(() => () => clearTimeout(autoSaveTimerRef.current), [])
    // Kiểm kê (Đầu/Cuối kỳ) KHÔNG còn tự lưu mỗi keystroke: trước đây autosave đẩy ngay số
    // Cuối kỳ vừa gõ lên DB, mà get_ingredient_stocks_v2 carry-forward remaining mới nhất ⇒
    // Đầu kỳ bị ghi đè thành Cuối kỳ y chang. Giờ chỉ sync khi bấm "Lưu báo cáo" (FAB) →
    // pushInventory → merge RPC → máy kia hội tụ qua postgres_changes. (Soạn tick/skip vẫn
    // dùng triggerAutoSave bên dưới.)
    //
    // "Bỏ qua" từng món Soạn — trạng thái "đã xem, không cần lấy" để vẫn hoàn tất ca mà không
    // phải nhập hàng thừa (vd dự báo thừa 1 cái). Luôn hủy bỏ qua được (bấm lại) khi thật sự
    // cần nhập. Bỏ qua ⇄ nhập thêm loại trừ nhau. Đi qua inventory.skipped (đồng bộ Realtime
    // đa thiết bị qua merge RPC — xem useShiftInventoryState), KHÔNG còn localStorage.
    const toggleSkip = useCallback((ingredient) => {
        const willSkip = !inventory.skipped[ingredient]
        inventory.onSkipToggle(ingredient, willSkip)
        // Bỏ qua khi đang có restock đã nhập → xóa (loại trừ nhau).
        if (willSkip && isPrepFilled(inventory.restockInputs[ingredient])) {
            inventory.onRestockChange(ingredient, '')
        }
        triggerAutoSave()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inventory.skipped, inventory.onSkipToggle, inventory.restockInputs, inventory.onRestockChange, triggerAutoSave])

    // Expense categories — feed dynamic rows into FinanceCards. Refetched per
    // address; new tags added in /history are picked up on next mount or after
    // reportCache invalidation.
    const [expenseCategories, setExpenseCategories] = useState([])
    useEffect(() => {
        if (!selectedAddress) return
        fetchExpenseCategories(selectedAddress.id).then(setExpenseCategories)
    }, [selectedAddress])

    useEffect(() => {
        if (!isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Pre-fill cash/transfer inputs from the existing shift_closing (if any).
    // Guard with closed_at === today VN: fetchDailyReportContext occasionally
    // returns yesterday's shift_closing as `shift_closing` (server tz / RPC
    // boundary issue), which would leave yesterday's cash + transfer values
    // sticky after midnight. If closed_at isn't today, treat as no row → blank.
    const isTodaysClosing = shiftClosing?.closed_at
        && dateStringVN(new Date(shiftClosing.closed_at)) === todayISO
    const persistedCash = isTodaysClosing && shiftClosing.actual_cash != null
        ? Number(shiftClosing.actual_cash) : 0
    const persistedTransfer = isTodaysClosing && shiftClosing.actual_transfer != null
        ? Number(shiftClosing.actual_transfer) : 0
    persistedCashRef.current = { cash: persistedCash, transfer: persistedTransfer }
    // Ô nào đang lệch bản đã lưu — một chỗ tính cho cả nút "Lưu thực thu" (cashDirty),
    // confirm rời trang, và payload lúc ghi. hasExistingRow = true ở đây chỉ để lấy phép so
    // từng ô: nhánh INSERT luôn trả payload đầy đủ nên không suy ra dirty được.
    const cashChanges = useMemo(() => buildCashPayload(
        { actual_cash: persistedCash, actual_transfer: persistedTransfer, cash_closed_at: shiftClosing?.cash_closed_at },
        { actual_cash: parseVNDInput(cashInput) || 0, actual_transfer: parseVNDInput(transferInput) || 0 },
        true,
    ), [persistedCash, persistedTransfer, shiftClosing?.cash_closed_at, cashInput, transferInput])
    const cashDirty = !!cashChanges
    // Prefill: 0 → để TRỐNG chứ không điền "0". Điền lại "0" làm ô Chuyển khoản mất viền
    // đứt + ăn màu chữ "đã nhập", trông như đã đếm xong. 0 và trống tính tiền y hệt nhau
    // nên để trống là an toàn.
    // Chỉ seed khi ĐỔI PHIẾU (load lần đầu / sang ngày mới / đổi scope) — cố ý KHÔNG nghe
    // actual_cash/actual_transfer: máy kia lưu thực thu làm 2 cột đó đổi, effect này mà chạy
    // sẽ xoá trắng số máy này đang gõ dở. Cập nhật từ xa đi qua onRemoteCash (merge từng ô).
    useEffect(() => {
        if (!isTodayScope) return
        setCashInput(isTodaysClosing && shiftClosing.actual_cash ? formatVNDInput(shiftClosing.actual_cash) : '')
        setTransferInput(isTodaysClosing && shiftClosing.actual_transfer ? formatVNDInput(shiftClosing.actual_transfer) : '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTodayScope, isTodaysClosing, todayISO, shiftClosing?.id, shiftClosing?.closed_at])

    // Lưới an toàn cho realtime: rớt gói = mất event vĩnh viễn (điểm yếu cố hữu của kênh).
    // Quay lại tab thì kéo phiếu chốt một lần rồi áp qua ĐÚNG đường merge per-field ở trên,
    // rẻ hơn nhiều so với hiển thị sai số thực thu suốt cả ca.
    //
    // onTabReturn (không phải mỗi lần 'visible'): mỗi cú ở đây là xoá sạch reportCache của
    // địa chỉ cộng một RPC báo cáo — chuyển app qua lại 2 giây không đáng.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress?.id) return
        return onTabReturn(() => {
            invalidateDailyContext(selectedAddress.id)
            fetchDailyReportContext(selectedAddress.id)
                .then(d => {
                    const row = d?.shift_closing
                    // RPC thỉnh thoảng trả phiếu HÔM QUA (biên tz) — bỏ qua, không thì số
                    // hôm qua nhảy vào ô thực thu hôm nay.
                    if (row && (!row.closed_at || dateStringVN(new Date(row.closed_at)) === todayISO)) onRemoteCash(row)
                })
                .catch(() => { /* lưới an toàn hỏng thì im lặng — realtime vẫn là đường chính */ })
        })
    }, [isTodayScope, selectedAddress?.id, todayISO, onRemoteCash])

    // Onboarding phase 4 "Kiểm kê tồn kho": trigger khi user bấm Lưu kiểm kê (không phải lúc
    // gõ Cuối kỳ) — xem handleSaveInventory. Match theo LABEL (không hardcode key) vì shop
    // có thể đổi tên nguyên liệu.
    const coffeeIngredient = useMemo(() => (
        isGuest ? findCoffeeIngredient(inventory.ingredientsList) : null
    ), [isGuest, inventory.ingredientsList])
    const cacaoIngredient = useMemo(() => (
        isGuest ? findIngredientByLabel(inventory.ingredientsList, 'cacao') : null
    ), [isGuest, inventory.ingredientsList])
    const coffeeInputValue = coffeeIngredient ? inventory.inventoryInputs[coffeeIngredient.ingredient] : undefined
    const cacaoInputValue = cacaoIngredient ? inventory.inventoryInputs[cacaoIngredient.ingredient] : undefined

    // Hint spotlight cho phase 3/4 — xem CashFlowCard/InventoryReportCard/ReportViewFilter.
    const showOnboardingHints = isGuest && !!selectedAddress?.id
    const hintCash = showOnboardingHints && !cashFlowProgress.cash
    const hintTransfer = showOnboardingHints && !cashFlowProgress.transfer
    const cashFlowDone = isCashFlowProgressDone(cashFlowProgress)
    const inventoryDone = isInventoryProgressDone(inventoryProgress)
    const hintInventoryTab = showOnboardingHints && cashFlowDone && !inventoryDone
    // Cà phê trước, Cacao sau — cùng thứ tự với 2 dòng checklist (inventoryStep.jsx).
    const hintInventoryIngredient = hintInventoryTab
        ? (!inventoryProgress.coffee ? coffeeIngredient?.ingredient : cacaoIngredient?.ingredient) ?? null
        : null

    // Phase 5 "Điều chỉnh công thức" không còn nút riêng trong guide — hint thẳng vào mũi tên
    // "tiến" ở header, đi xuyên page tới /recipes qua menuSequence.js (xem recipeStep.jsx).
    // recipeProgress do RecipeIngredientPage.jsx ghi — đọc lại từ initialOnboardingState (đã
    // đọc localStorage 1 lần ở trên cho cashFlowProgress/inventoryProgress rồi, khỏi đọc thêm).
    const hintGoToRecipes = showOnboardingHints && isRecipeStepActive(inventoryDone, initialOnboardingState.recipeProgress)

    // Base chốt-ca: persisted shift_closing có cash + transfer VÀ mọi NVL đã đếm Cuối kỳ.
    // Điều kiện "đã hoàn tất" đầy đủ (gồm 'đã soạn cho hôm nay') ghép thêm bên dưới sau
    // prepTodayList, vì allPrepDone phụ thuộc prepTodayList — xem isShiftFinalized.
    const cashAndCountDone = useMemo(() => {
        if (!isTodaysClosing) return false
        if (shiftClosing.actual_cash == null || shiftClosing.actual_transfer == null) return false
        const report = shiftClosing.inventory_report
        if (!Array.isArray(report) || report.length === 0) return false
        const list = inventory.ingredientsList || []
        if (list.length === 0) return false
        const remainingByIng = {}
        for (const row of report) remainingByIng[row.ingredient] = row.remaining
        return list.every(ing => remainingByIng[ing.ingredient] != null)
    }, [isTodaysClosing, shiftClosing?.actual_cash, shiftClosing?.actual_transfer, shiftClosing?.inventory_report, inventory.ingredientsList])

    // Week/month scopes show the per-day/per-week bar chart instead of the hourly line.
    // "Range" = khoảng NHIỀU NGÀY. Biểu đồ đường cộng dồn theo GIỜ chỉ có nghĩa cho 1
    // ngày (dòng tiền trong ngày); week/month/custom-nhiều-ngày phải dùng biểu đồ cột.
    // Trước đây bỏ sót custom range nhiều ngày → vẫn hiện line chart sai.
    const isRangeScope = scope === 'week' || scope === 'month'
        || (scope === 'custom' && !isSameDayVN(rangeStart, rangeEnd))

    // Chi phí đang mở modal sửa (bấm 1 dòng trong panel Thực chi) — null = đóng.
    const [editingExpense, setEditingExpense] = useState(null)

    // Phiếu nhập kho (Mua nguyên liệu/bao bì) đang mở modal sửa — bấm 1 dòng đi chợ
    // trong panel Thực chi. { entry, addressId, ingredient } | null = đóng. Entry được
    // fetch lại đầy đủ (không dùng payment gộp của CashFlowCard) vì cần amount/discount/
    // extra_cost/payments gốc của cả hoá đơn, không chỉ phần trả trong kỳ báo cáo đang xem.
    const [editingRestock, setEditingRestock] = useState(null)
    // Token chống race: bấm nhanh 2 dòng khác nhau trước khi fetch trước xong → chỉ áp
    // kết quả của lượt bấm MỚI NHẤT, không để lượt cũ resolve trễ ghi đè modal đang mở.
    const restockFetchTokenRef = useRef(0)
    const handleEditRestockPayment = async (payment) => {
        const ingredient = payment?.invoice_metadata?.ingredient
        const expenseId = payment?.expense_id
        if (!ingredient || !expenseId) return
        const addressId = payment.address_id || selectedAddress?.id
        const token = ++restockFetchTokenRef.current
        try {
            const history = await fetchIngredientRestockHistory([addressId], ingredient, new Date(0).toISOString(), new Date().toISOString())
            if (restockFetchTokenRef.current !== token) return
            const entry = history.find(h => h.id === expenseId)
            if (entry) setEditingRestock({ entry, addressId, ingredient })
            else showError(Object.assign(new Error('Không tìm thấy phiếu nhập kho'), { expected: true }), 'Mở phiếu nhập kho')
        } catch (err) { showError(err, 'Tải phiếu nhập kho') }
    }
    const handleSaveRestockEdit = async (form) => {
        const { entry, addressId } = editingRestock
        // Đóng modal ngay (optimistic, khớp pattern IngredientDetailPage.handleEditRestock) —
        // lỗi mạng vẫn báo qua toast, không cần giữ modal mở để user retry.
        setEditingRestock(null)
        try {
            await editIngredientRestock(addressId, entry.id, {
                qty: Number(form.qty),
                subtotal: Number(form.subtotal),
                discount: Number(form.discount),
                extraCost: Number(form.extraCost),
                paid: Number(form.paid),
                paymentMethod: form.paymentMethod,
                cashPhase: form.cashPhase,
                purchaseDate: form.purchaseDate,
                staffName: profile?.name,
            })
            await Promise.all([
                refetchReport(),
                inventory.reloadStocks?.(), inventory.reloadIngredients?.(), refreshProducts?.(), refreshTodayExpenses?.(),
            ])
            showToast('Đã lưu phiếu nhập kho', 'success')
        } catch (err) { showError(err, 'Sửa phiếu nhập kho') }
    }

    // Sau khi sửa/xoá: scope hôm nay do POSContext tự patch todayExpenses; scope quá
    // khứ đọc từ RPC báo cáo nên phải patch tay (updates = null ⇒ đã xoá).
    const patchReportExpense = (id, updates) => {
        if (isTodayScope) return
        setApiExpenses(prev => updates
            ? prev.map(e => e.id === id ? { ...e, ...updates } : e)
            : prev.filter(e => e.id !== id))
    }

    // Computed display data
    const displayOrders = isTodayScope ? todayOrders : apiOrders
    const displayExpenses = isTodayScope ? todayExpenses : apiExpenses
    // Payments của ngày scope hiện tại — driver chính của cashflow refill (paid_at-based).
    const displayPayments = isTodayScope ? (todayPayments || []) : (apiPayments || [])

    const rangeLabel = useMemo(() => {
        if (scope === 'day') {
            return dateFullVN(rangeStart)
        }
        if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
            const sStr = customRange.startISO.split('-')
            const eStr = customRange.endISO.split('-')
            return `${sStr[2]}/${sStr[1]} – ${eStr[2]}/${eStr[1]}`
        }
        return `${dateShortVN(rangeStart)} – ${dateShortVN(rangeEnd)}`
    }, [scope, rangeStart, rangeEnd, customRange])

    const isReady = !isLoadingHistory && isAsyncReady

    // O(1) product lookup — rebuilt only when products list changes
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

    // Extra maps — rebuilt only when productExtras changes
    const extraMaps = useMemo(() => buildExtraMaps(productExtras), [productExtras])

    // All heavy stats: only reruns when orders/recipes/products change, NOT on UI state changes
    const { totalRevenue, totalDiscount, totalCOGS, productStats, soldProducts, lineChartData, offlineToday } = useMemo(() => {
        const pending = isTodayScope ? getPendingOrders() : []
        const offlineToday = pending.filter(o => isSameDayVN(new Date(o.createdAt), new Date()))

        const agg = aggregateOrderStats({
            orders: [...displayOrders, ...offlineToday],
            productMap,
            extraPriceMap: extraMaps.priceMap,
            extraNameMap: extraMaps.nameMap,
            recipes, extraIngredients, ingredientCosts,
        })

        return {
            totalRevenue: agg.totalRevenue,
            totalDiscount: agg.totalDiscount,
            totalCOGS: agg.totalCOGS,
            productStats: agg.productStats,
            soldProducts: agg.soldProducts,
            lineChartData: buildHourlyLineChart(agg),
            offlineToday,
        }
    }, [displayOrders, productMap, extraMaps, recipes, extraIngredients, ingredientCosts, isTodayScope])

    // aggregateOrderStats ở trên đã đếm qty từng món trên ĐÚNG tập order này — cộng
    // lại từ productStats thay vì quét orders × items lần thứ hai (2 vòng lặp chuẩn hoá
    // field khác nhau là chỗ dễ lệch). Món count_as_cup=false không tính là ly.
    const totalCups = useMemo(
        () => Object.entries(productStats).reduce(
            (n, [pid, st]) => productMap.get(pid)?.count_as_cup === false ? n : n + st.qty, 0),
        [productStats, productMap],
    )

    const { dailyExpense, refillFreeForm } = useMemo(
        () => splitExpenses(displayExpenses),
        [displayExpenses]
    )
    // Chi phí gắn nhãn nhóm "Ngoài kinh doanh" — KHÔNG vào lợi nhuận (tiền ra ngoài
    // hoạt động KD). Phải trừ khỏi P&L. Bỏ qua đúng theo luật của buildCategoryBreakdown:
    // NVL refill (is_refill & !free_form) + adjustment; free-form refill (sau ca) VẪN xét
    // để khớp 2 nơi nếu phiếu sau ca được gắn nhãn ngoài KD.
    const nonOperatingExpense = useMemo(() => {
        const nonOpIds = new Set(
            (expenseCategories || []).filter(c => c.group_section === 'non_operating').map(c => c.id)
        )
        if (nonOpIds.size === 0) return 0
        let sum = 0
        for (const e of displayExpenses || []) {
            if ((e.is_refill && !e.metadata?.free_form) || e.metadata?.adjustment) continue
            if (e.category_id && nonOpIds.has(e.category_id)) sum += e.amount || 0
        }
        return sum
    }, [displayExpenses, expenseCategories])
    // Vận hành tổng = trong ca + free-form sau ca (sau ca vẫn là vận hành, không phải NVL).
    // Thực chi: legacy is_fixed=true rows ĐÃ được splitExpenses cộng vào dailyExpense.
    // Trừ chi phí ngoài KD khỏi P&L; chi phí tồn kho thì GIỮ (là chi phí thật, ngoài COGS).
    const operationalExpense = dailyExpense + refillFreeForm - nonOperatingExpense

    // ── COGS category breakdown + hao hụt ────────────────────────────────────
    // Map ingredient → category (null when migration 20260523 not deployed yet —
    // splitCogsByCategory treats null as 'main' so the page still renders).
    const categoryByIngredient = useMemo(() => {
        const map = new Map()
        for (const c of ingredientConfigs || []) map.set(c.ingredient, c.category || null)
        return map
    }, [ingredientConfigs])

    const cogsByCategory = useMemo(
        () => splitCogsByCategory(
            [...displayOrders, ...offlineToday],
            recipes, extraIngredients, ingredientCosts, categoryByIngredient
        ),
        [displayOrders, offlineToday, recipes, extraIngredients, ingredientCosts, categoryByIngredient]
    )

    const lossInfo = useMemo(() => {
        // Daily scope: today's single closing + yesterday as the opening source.
        // Range scope: all closings in the period + prev-period closings.
        // (isDayScope = scope === 'day', khai báo ở trên cùng file — dùng chung với inventorySeed.)
        // Hôm nay: chỉ dùng shiftClosing khi closed_at ĐÚNG là hôm nay — qua nửa đêm server
        // có thể còn trả phiếu hôm qua (ranh giới TZ/RPC); không chặn thì "Hao hụt / hủy" giữ
        // số cũ của hôm qua. Ngày quá khứ (offset<0): dùng phiếu đã fetch của ngày đó.
        const usableClosing = !isDayScope ? null
            : (shiftClosing && (!isTodayScope || isTodaysClosing)) ? shiftClosing : null
        const closings = isDayScope
            ? (usableClosing ? [usableClosing] : [])
            : (apiShiftClosings || [])
        if (closings.length === 0) return { lossValue: 0, nonRecipeUsageLines: [] }

        // Bucket orders by VN date string so calculateLossValue can look up
        // per-day consumption (same dayStr key the RangeLossCard uses).
        const itemsByDay = {}
        const pushItem = (dayStr, productId, qty, extras) => {
            if (!itemsByDay[dayStr]) itemsByDay[dayStr] = []
            itemsByDay[dayStr].push({ productId, qty, extras })
        }
        const sourceOrders = isDayScope ? [...displayOrders, ...offlineToday] : (apiOrders || [])
        for (const o of sourceOrders) {
            if (o.deleted_at) continue
            const dayStr = dateStringVN(new Date(o.created_at || o.createdAt))
            const items = o.order_items || o.cart || o.orderItems || []
            for (const i of items) {
                pushItem(
                    dayStr,
                    i.product_id || i.productId,
                    i.quantity || i.qty || 1,
                    i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
                )
            }
        }
        const dailyConsumption = {}
        for (const [dayStr, items] of Object.entries(itemsByDay)) {
            dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients)
        }

        const prevClosings = isDayScope
            ? (yesterdayClosing ? [yesterdayClosing] : [])
            : (prevShiftClosings || [])
        // Làm tròn về VND nguyên (hao hụt = qty lẻ × giá vốn nên hay ra .5) → row + tổng
        // giá vốn + lợi nhuận đều dùng số nguyên nhất quán, không còn hiển thị "...,5đ".
        const { loss, consumption } = calculateLossValue({
            shiftClosings: closings,
            prevShiftClosings: prevClosings,
            dailyConsumption,
            ingredientConfigs,
            recipeIngredients: buildRecipeIngredientSet(recipes, extraIngredients),
        })
        // Bao bì/vật tư không công thức: tiêu hao của chúng tách riêng, ghi đúng tên
        // (Ống hút, Bịch chữ T...) trong COGS thay vì gộp vào "Hao hụt / hủy".
        const nonRecipeUsageLines = Object.entries(consumption)
            .map(([ingredient, value]) => ({ ingredient, label: ingredientLabel(ingredient), value: Math.round(value) }))
            .filter(l => l.value > 0)
            .sort((a, b) => b.value - a.value)
        return { lossValue: Math.round(loss), nonRecipeUsageLines }
    }, [isDayScope, isTodayScope, isTodaysClosing, shiftClosing, yesterdayClosing, apiShiftClosings, prevShiftClosings, apiOrders, displayOrders, offlineToday, recipes, extraIngredients, ingredientConfigs])

    const { lossValue, nonRecipeUsageLines } = lossInfo
    const nonRecipeUsageTotal = nonRecipeUsageLines.reduce((s, l) => s + l.value, 0)

    // P&L = Revenue - COGS - Hao hụt - Tiêu hao bao bì không-công-thức - chi phí thực chi.
    // NVL refill không trừ ở đây (đã nằm trong COGS/tiêu hao qua kiểm kê).
    const netProfit = totalRevenue - totalCOGS - lossValue - nonRecipeUsageTotal - operationalExpense

    // Sync cash flow calculations for both daily view and range view (handling unclosed shifts by falling back to expected order totals)
    const calculateSyncedCashFlow = (isDay, singleClosing, rangeClosings, rangeOrders, rangeOffline = []) => {
        if (isDay) {
            if (singleClosing) {
                return {
                    cash: singleClosing.actual_cash || 0,
                    transfer: singleClosing.actual_transfer || 0
                }
            }
            const orders = [...rangeOrders, ...rangeOffline].filter(o => !o.deleted_at)
            const cash = orders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
            const transfer = orders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
            return { cash, transfer }
        }

        const closingMap = new Map()
            ; (rangeClosings || []).forEach(s => {
                const dateStr = dateStringVN(new Date(s.closed_at || s.created_at))
                if (!closingMap.has(dateStr)) {
                    closingMap.set(dateStr, { cash: 0, transfer: 0 })
                }
                const val = closingMap.get(dateStr)
                val.cash += s.actual_cash || 0
                val.transfer += s.actual_transfer || 0
            })

        const ordersByDate = new Map()
        const allOrders = [...rangeOrders, ...rangeOffline].filter(o => !o.deleted_at)
        allOrders.forEach(o => {
            const dateStr = dateStringVN(new Date(o.created_at || o.createdAt))
            if (!ordersByDate.has(dateStr)) {
                ordersByDate.set(dateStr, [])
            }
            ordersByDate.get(dateStr).push(o)
        })

        const allDates = new Set([...closingMap.keys(), ...ordersByDate.keys()])

        let totalCash = 0
        let totalTransfer = 0

        allDates.forEach(dateStr => {
            if (closingMap.has(dateStr)) {
                const closing = closingMap.get(dateStr)
                totalCash += closing.cash
                totalTransfer += closing.transfer
            } else {
                const orders = ordersByDate.get(dateStr) || []
                const cash = orders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
                const transfer = orders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
                totalCash += cash
                totalTransfer += transfer
            }
        })

        return { cash: totalCash, transfer: totalTransfer }
    }

    // calculateSyncedCashFlow returns { cash, transfer } — alias on destructure to keep
    // the rest of the page calling them actualCash/actualTransfer.
    const { cash: actualCash, transfer: actualTransfer } = useMemo(() => {
        return calculateSyncedCashFlow(scope === 'day', shiftClosing, apiShiftClosings, displayOrders, offlineToday)
    }, [scope, shiftClosing, apiShiftClosings, displayOrders, offlineToday])

    // Inventory audit support: estimated consumption per ingredient + cups-equivalent
    // product map + per-product breakdown for expand-on-tap.
    const todayOrderItems = useMemo(() => {
        if (!isTodayScope) return []
        const items = []
        todayOrders.filter(o => !o.deleted_at && !o.deletedAt).forEach(o => {
            (o.order_items || []).forEach(i => items.push({
                productId: i.product_id || i.productId,
                qty: i.quantity || i.qty || 1,
                extras: i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
            }))
        })
        offlineToday.forEach(o => {
            (o.cart || o.orderItems || []).forEach(i => items.push({
                productId: i.productId,
                qty: i.quantity || 1,
                extras: i.extras || []
            }))
        })
        return items
    }, [isTodayScope, todayOrders, offlineToday])

    const usedMap = useMemo(
        () => calculateEstimatedConsumption(todayOrderItems, recipes, extraIngredients),
        [todayOrderItems, recipes, extraIngredients]
    )

    // Fetch same-weekday orders của 3 tuần gần nhất (today scope only), 2 chuỗi mốc:
    // today−{7,14,21} (cùng thứ HÔM NAY → dự báo Soạn) và today−{6,13,20} (cùng thứ NGÀY MAI
    // → dự báo Chuẩn bị). Trung bình 3 tuần thay vì chỉ 1 tuần trước để đỡ nhạy với 1 ngày
    // bất thường (nghỉ lễ, vắng khách đột xuất). Service cache theo address+offset+day nên
    // rẻ khi re-mount.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress) { setLastWeekItemsWeeks([]); setNextDowItemsWeeks([]); return }
        let alive = true
        Promise.all(HISTORY_OFFSETS_TODAY.map(d => fetchLastWeekSameDayOrderItems(selectedAddress.id, d)))
            .then(weeks => { if (alive) setLastWeekItemsWeeks(weeks.map(w => w || [])) })
            .catch(() => { if (alive) setLastWeekItemsWeeks([]) })
        Promise.all(HISTORY_OFFSETS_TOMORROW.map(d => fetchLastWeekSameDayOrderItems(selectedAddress.id, d)))
            .then(weeks => { if (alive) setNextDowItemsWeeks(weeks.map(w => w || [])) })
            .catch(() => { if (alive) setNextDowItemsWeeks([]) })
        return () => { alive = false }
    }, [isTodayScope, selectedAddress])

    const toUsedMap = useCallback((items) => calculateEstimatedConsumption(
        items.map(i => ({ productId: i.product_id, qty: i.quantity, extras: (i.extra_ids || []).map(id => ({ id })) })),
        recipes, extraIngredients,
    ), [recipes, extraIngredients])
    // Trung bình 3 tuần cùng thứ (xem HISTORY_OFFSETS_TODAY/TOMORROW ở đầu file).
    const lastWeekUsedMap = useMemo(
        () => averageIngredientMaps(lastWeekItemsWeeks.map(toUsedMap)),
        [lastWeekItemsWeeks, toUsedMap],
    ) // hôm nay
    const nextDowUsedMap = useMemo(
        () => averageIngredientMaps(nextDowItemsWeeks.map(toUsedMap)),
        [nextDowItemsWeeks, toUsedMap],
    ) // ngày mai

    // Dự báo = max(tiêu thụ hôm nay tới giờ, cùng thứ tuần trước). Truyền map tuần-trước theo
    // card: Soạn dùng lastWeekUsedMap (today−7, cùng thứ hôm nay); Chuẩn bị dùng nextDowUsedMap
    // (today−6, cùng thứ ngày mai).
    const forecastFor = (ingredient, lastWeekMap) =>
        Math.max(r1(lookupByLabel(ingredient, usedMap)), r1(lookupByLabel(ingredient, lastWeekMap)))

    // Item chung cho 2 card checklist: { ingredient, have, need, needPacks, unit, packUnit }.
    //   have = tồn hiện có ("Còn"); need = target − have ("Cần"); needPacks = quy đổi ra bịch.
    //   target = mức cần đạt: card Soạn = forecast; card Kho = max(forecast, min_stock).
    const toPrepItem = (ing, have, target) => {
        const need = r1(target - have)
        if (need <= 0) return null
        const packSize = Number(ing.pack_size) || 0
        const needPacks = packSize > 0 ? Math.ceil(need / packSize) : 0
        return {
            ingredient: ing.ingredient,
            have,
            need,
            needPacks,
            unit: ing.unit,
            packUnit: ing.pack_unit,
            // Lượng đổ vào Nhập thêm khi tick "đã soạn" = số quy đổi nguyên bịch
            // (số bịch × quy cách). Không có quy cách bịch thì dùng đúng "Cần".
            fillQty: needPacks > 0 ? r1(needPacks * packSize) : need,
        }
    }

    // "Soạn cho hôm nay" — sáng: đưa NVL ra QUẦY đủ cho dự báo bán hôm nay.
    // have = tồn quầy ĐẦU ca (opening); need = forecast − opening. Dự báo =
    // max(tiêu thụ hôm nay, cùng kỳ tuần trước). KHÔNG dùng min_stock (đó là ngưỡng kho).
    const prepTodayList = useMemo(() => {
        const out = []
        for (const ing of inventory.ingredientsList || []) {
            const oRaw = inventory.openingInputs[ing.ingredient]
            const openingGross = r1(oRaw !== undefined && oRaw !== '' ? oRaw : (inventory.openingStock[ing.ingredient] ?? 0))
            // Đầu kỳ = số cân hộp (gồm bì) → matcha THẬT để bán = trừ bì, kẹp 0. Bì tự khử
            // trong Hao hụt (đầu+cuối cùng gross) nên chỉ trừ ở đây — chỗ cần lượng thật.
            const tare = r1(ing.tare_weight)
            const opening = Math.max(0, r1(openingGross - tare))
            const item = toPrepItem(ing, opening, forecastFor(ing.ingredient, lastWeekUsedMap))
            if (item) {
                // Kho tổng hiện có (warehouse_stock thực tế, KHÔNG phải số đầu ca) để rút ra
                // quầy. Lookup theo key trực tiếp; null nếu NVL không theo dõi kho.
                const wh = (inventory.warehouseStocks || {})[ing.ingredient]
                item.warehouse = wh != null ? r1(wh) : null
                item.tare = tare // >0 → card hiện "bì X + <thật>"
                out.push(item)
            }
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inventory.ingredientsList, inventory.openingInputs, inventory.openingStock, inventory.warehouseStocks, usedMap, lastWeekUsedMap])

    // Tick "Soạn cho hôm nay" ↔ Nhập thêm (restock) — liên kết 2 chiều, restock là
    // nguồn sự thật duy nhất (đã sync Realtime → multi-device tự đồng bộ):
    //   • checkbox suy ra từ restock (≠ 0 ⇒ đã soạn);
    //   • tick = đổ số quy đổi nguyên bịch vào restock; untick = clear.
    // Fill khi tick = số quy đổi nguyên bịch, nhưng KẸP theo kho thực có — không lấy nhiều
    // hơn kho đang có → không bao giờ "Vượt kho tổng" / chặn Lưu, số fill khớp với "Kho".
    // Kho null (NVL không theo dõi kho) → giữ nguyên fillQty.
    const prepFillMap = useMemo(
        () => Object.fromEntries(prepTodayList.map(it => [
            it.ingredient,
            it.warehouse != null ? Math.min(it.fillQty, it.warehouse) : it.fillQty,
        ])),
        [prepTodayList],
    )
    const prepCheckedDerived = useMemo(() => {
        const m = {}
        for (const it of prepTodayList) m[it.ingredient] = isPrepFilled(inventory.restockInputs[it.ingredient])
        return m
    }, [prepTodayList, inventory.restockInputs])
    const togglePrepRestock = useCallback((ingredient) => {
        const filled = isPrepFilled(inventory.restockInputs[ingredient])
        const fill = prepFillMap[ingredient]
        // tick: đổ lượng đã kẹp theo kho; kho = 0 (fill ≤ 0) → không soạn được, bỏ qua.
        const next = filled ? '' : (fill > 0 ? String(fill) : '')
        if (!filled && next === '') return
        inventory.onRestockChange(ingredient, next)
        // nhập thêm ⇄ bỏ qua loại trừ nhau: vừa nhập thì hủy "bỏ qua".
        if (!filled && fill > 0 && inventory.skipped[ingredient]) inventory.onSkipToggle(ingredient, false)
        triggerAutoSave() // soạn tick/untick tự lưu, không cần bấm "Lưu báo cáo"
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inventory.restockInputs, inventory.onRestockChange, prepFillMap, inventory.skipped, inventory.onSkipToggle, triggerAutoSave])

    // "Chuẩn bị tồn kho" — cho mai: đủ hàng để mai SOẠN RA BÁN không? Liên kết 3 card:
    // mai bán từ TỔNG tồn = kho tổng + tồn quầy cuối ca (số ② Hao hụt vừa đếm). Thiếu thì mua.
    //   have = tổng tồn = (kho tổng − restock) + tồn quầy cuối ca.
    //   target = max(forecast, min_stock) — mua để đạt mức cao hơn giữa "đủ bán mai" và
    //            "sàn tồn tối thiểu" của NVL (đồng bộ với min_stock cấu hình ở /ingredients).
    //   need = target − tổng tồn.
    //   Lưu ý: effectiveWarehouseStocks là kho TRƯỚC khi trừ restock của ca này (xem
    //   useShiftInventoryState), nên phải trừ restock để khỏi đếm 2 lần phần đã rút ra quầy.
    //   Chưa đếm Cuối kỳ → ước lượng quầy theo Lý thuyết (Đầu kỳ + Nhập thêm − Sử dụng).
    //
    // Log minh bạch: tổng đã "Nhập kho" (mua qua RestockModal, is_refill trên expenses) hôm
    // nay cho từng NVL — hiển thị kèm dòng "Chuẩn bị ngày mai" để thấy đã mua bao nhiêu, dù
    // số đó đã cộng vào `warehouse`/`total` ở trên rồi (đây chỉ là hiển thị thêm, không đổi
    // công thức tính need).
    const todayBoughtMap = useMemo(() => {
        const m = {}
        for (const e of todayExpenses || []) {
            if (!e.is_refill || e.metadata?.cancelled) continue
            const ing = e.metadata?.ingredient
            const qty = Number(e.metadata?.qty) || 0
            if (!ing || !qty) continue
            m[ing] = (m[ing] || 0) + qty
        }
        Object.keys(m).forEach(k => { m[k] = r1(m[k]) })
        return m
    }, [todayExpenses])

    const warehousePrepList = useMemo(() => {
        const out = []
        for (const ing of inventory.ingredientsList || []) {
            const warehouse = Math.max(0, r1(lookupByLabel(ing.ingredient, inventory.effectiveWarehouseStocks || {})))
            const restock = r1(inventory.restockInputs[ing.ingredient])
            const counted = inventory.inventoryInputs[ing.ingredient]
            let counter
            if (counted !== undefined && counted !== '') {
                counter = r1(counted)
            } else {
                const oRaw = inventory.openingInputs[ing.ingredient]
                const opening = r1(oRaw !== undefined && oRaw !== '' ? oRaw : (inventory.openingStock[ing.ingredient] ?? 0))
                const used = r1(lookupByLabel(ing.ingredient, usedMap))
                counter = Math.max(0, r1(opening + restock - used))
            }
            // counter là số cân hộp (gồm bì) → lượng THẬT tại quầy = trừ bì, kẹp 0.
            // Kho tổng (bịch, không hộp) không có bì. Tổng tồn thật = kho + quầy thật.
            const tare = r1(ing.tare_weight)
            const counterReal = Math.max(0, r1(counter - tare))
            const total = Math.max(0, r1(warehouse - restock + counterReal))
            const target = Math.max(forecastFor(ing.ingredient, nextDowUsedMap), r1(ing.min_stock || 0))
            const item = toPrepItem(ing, total, target)
            if (item) {
                // Tách tồn để dễ kiểm kê: kho riêng (đã trừ phần rút ra quầy) + tồn quầy thật.
                // need vẫn tính từ TỔNG tồn ở toPrepItem; have đổi thành tồn quầy để hiển thị.
                item.warehouse = Math.max(0, r1(warehouse - restock))
                item.have = counterReal
                item.boughtToday = lookupByLabel(ing.ingredient, todayBoughtMap)
                out.push(item)
            }
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inventory.ingredientsList, inventory.effectiveWarehouseStocks, inventory.restockInputs, inventory.inventoryInputs, inventory.openingInputs, inventory.openingStock, usedMap, nextDowUsedMap, todayBoughtMap])

    // Chốt ca đầy đủ = cash + counted + đã soạn cho hôm nay + đã chuẩn bị tồn kho cho mai.
    // List rỗng (đủ tồn, không cần làm gì) ⇒ coi như đã xong phần đó.
    // Mỗi món coi là xong khi đã nhập thêm HOẶC đã bỏ qua ("đã xem, không cần lấy").
    const allPrepDone = prepTodayList.length === 0 || prepTodayList.every(it => isPrepFilled(inventory.restockInputs[it.ingredient]) || inventory.skipped[it.ingredient])
    // "Chuẩn bị tồn kho" tính là xong khi danh sách mua RỖNG — tức đã nhập kho đủ target cho
    // mai (hoặc kho vốn đã đủ). Không còn tick thủ công nên đây là điều kiện trung thực.
    const allWarehousePrepDone = warehousePrepList.length === 0
    const isShiftFinalized = cashAndCountDone && allPrepDone && allWarehousePrepDone

    // Latch: một khi ca đã hoàn tất trong ngày thì KHÓA lại — forecast nhích lên do đơn
    // muộn sẽ không "mở lại" ca nữa. Cờ lưu localStorage theo địa chỉ+ngày (đúng key
    // HistoryPage đọc để phân loại "Sau ca"). Sang ngày mới → key mới → tự reset.
    const finalizedKey = isTodayScope && selectedAddress?.id ? shiftFinalizedKey(selectedAddress.id, todayISO) : null
    const [finalizedLatched, setFinalizedLatched] = useState(() => !!(finalizedKey && localStorage.getItem(finalizedKey)))
    const [seenFinalizedKey, setSeenFinalizedKey] = useState(finalizedKey)
    if (finalizedKey !== seenFinalizedKey) {
        setSeenFinalizedKey(finalizedKey)
        setFinalizedLatched(!!(finalizedKey && localStorage.getItem(finalizedKey)))
    }
    const shiftDone = isShiftFinalized || finalizedLatched

    // 3 card Tồn kho: mặc định mở card của BƯỚC hiện tại trong flow, nhưng KHÔNG khóa
    // accordion — user có thể mở nhiều card cùng lúc. openCards[id] = đang mở.
    //   chưa soạn xong → 'prep'; soạn xong, chưa kiểm xong → 'audit'; kiểm xong → 'warehouse'.
    const allCounted = (inventory.ingredientsList?.length || 0) > 0 &&
        inventory.ingredientsList.every(ing => {
            const v = inventory.inventoryInputs[ing.ingredient]
            return v !== undefined && v !== ''
        })
    const activeStage = !allPrepDone ? 'prep' : !allCounted ? 'audit' : 'warehouse'
    const [openCards, setOpenCards] = useState({})
    // autoStage = card do flow tự mở (con trỏ bước hiện tại). Tách khỏi các card user tự bấm:
    // khi sang bước mới, ĐÓNG card auto của bước cũ + MỞ card bước mới, nhưng card user tự mở
    // thì giữ nguyên → vừa auto theo flow, vừa cho mở nhiều card thủ công (không khóa accordion).
    // stageReady: chờ inventoryInputs load xong, nếu không activeStage lật qua 'audit' giả lúc
    // load → auto mở nhầm rồi để lại card thừa.
    const [autoStage, setAutoStage] = useState(null)
    const stageReady = (inventory.ingredientsList?.length || 0) > 0 && !inventory.isLoadingIngredients
    // Hoãn khi đang gõ (isDirty) — vd nhập Cuối kỳ làm allCounted lật — để khỏi mở/đóng card
    // gây mất focus.
    if (stageReady && activeStage !== autoStage && !inventory.isDirty) {
        setOpenCards(s => {
            const next = { ...s }
            if (autoStage) delete next[autoStage]
            next[activeStage] = true
            return next
        })
        setAutoStage(activeStage)
    }
    const toggleCard = (id) => setOpenCards(s => ({ ...s, [id]: !s[id] }))

    // Đạt điều kiện hoàn tất LẦN ĐẦU → ghi cờ + khóa, KHÔNG tự gỡ (đơn muộn không mở lại ca).
    // HistoryPage đọc cờ này để phân loại chi phí phát sinh sau là "Sau ca".
    useEffect(() => {
        if (!finalizedKey || finalizedLatched || !isShiftFinalized) return
        localStorage.setItem(finalizedKey, Date.now().toString())
        setFinalizedLatched(true)
    }, [isShiftFinalized, finalizedKey, finalizedLatched])

    // Sync cờ chốt ca tiền → localStorage để HistoryPage nhận diện đã chốt két.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress) return
        const key = cashClosedKey(selectedAddress.id, todayISO)
        const isCashClosed = isTodaysClosing && shiftClosing?.cash_closed_at != null
        if (isCashClosed) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, Date.now().toString())
        } else {
            localStorage.removeItem(key)
        }
    }, [isTodaysClosing, shiftClosing?.cash_closed_at, isTodayScope, selectedAddress, todayISO])

    const consumptionBreakdown = useMemo(
        () => calculateConsumptionBreakdown(todayOrderItems, recipes, extraIngredients, products, productExtras),
        [todayOrderItems, recipes, extraIngredients, products, productExtras]
    )

    // Dominant product per ingredient — drives "Tương đương N ly <product>" on the
    // "≈ N ly <món>" cạnh mỗi dòng hao hụt — xem buildIngredientToProduct.
    const ingredientToProduct = useMemo(
        () => buildIngredientToProduct({ orderItems: todayOrderItems, recipes, products }),
        [recipes, products, todayOrderItems],
    )

    // PROTOTYPE — nghi vấn "pha bán nhưng chưa bấm bill" (MissingCupSuspicionCard).
    // Chỉ chạy khi xem HÔM NAY, ở tab có card, và không phải staff — lý do gate nằm
    // trong useMissingCupSuspicion.
    const missingCupCandidates = useMissingCupSuspicion({
        enabled: isTodayScope && !isStaff && (view === VIEW_ALL || view === VIEW_INVENTORY),
        addressId: selectedAddress?.id,
        ingredientsList: inventory.ingredientsList,
        inventoryInputs: inventory.inventoryInputs,
        restockInputs: inventory.restockInputs,
        openingInputs: inventory.openingInputs,
        openingStock: inventory.openingStock,
        usedMap, recipes, extraIngredients, products,
    })

    // Stable ingredient→unit map so InventoryReportCard's memoized rows don't all
    // re-render on every keystroke (was rebuilt inline each render).
    const inventoryRowUnits = useMemo(
        () => Object.fromEntries(inventory.ingredientsList.map(i => [i.ingredient, i.unit])),
        [inventory.ingredientsList]
    )

    // Sum today's orders (online + offline) for the system_total_revenue snapshot we send
    // when creating a new shift_closing. Mirrors /shift-closing's calculation.
    const systemTotalRevenue = useMemo(() => {
        if (!isTodayScope) return 0
        let sum = 0
        for (const o of todayOrders) if (!o.deleted_at && !o.deletedAt) sum += o.total || 0
        for (const o of offlineToday) if (!o.deleted_at && !o.deletedAt) sum += o.total || 0
        return sum
    }, [isTodayScope, todayOrders, offlineToday])

    // Sửa Cuối kỳ ngày cũ (PastInventoryEditor) chưa lưu — lift lên để guard rời trang.
    const [pastInvDirty, setPastInvDirty] = useState({ dirty: false, lines: [] })
    const handlePastInvDirty = useCallback((dirty, lines) => setPastInvDirty({ dirty, lines }), [])

    // Có thay đổi chưa lưu ở khu Tồn kho / Thực thu (today scope) → cảnh báo trước khi rời,
    // chống mất tick/soạn (chỉ bền sau khi Lưu, không còn localStorage).
    const hasUnsaved = isTodayScope
        ? (inventory.isDirty || cashDirty)
        : (scope === 'day' && pastInvDirty.dirty)
    useEffect(() => {
        if (!hasUnsaved) return
        const handler = (e) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [hasUnsaved])
    // Bọc các thao tác rời trang (back / đổi tab) — xác nhận nếu còn thay đổi chưa lưu.
    // Liệt kê cụ thể field nào sắp mất (tối đa 5 dòng) để confirm rõ nghĩa, không mơ hồ.
    const guardLeave = async (proceed) => {
        if (hasUnsaved) {
            const cashLines = []
            if (cashChanges?.actual_cash !== undefined)
                cashLines.push(`Thực thu · Tiền mặt: ${formatVNDInput(persistedCash)} → ${formatVNDInput(cashChanges.actual_cash)}`)
            if (cashChanges?.actual_transfer !== undefined)
                cashLines.push(`Thực thu · Chuyển khoản: ${formatVNDInput(persistedTransfer)} → ${formatVNDInput(cashChanges.actual_transfer)}`)
            const lines = isTodayScope ? [...inventory.dirtySummary, ...cashLines] : pastInvDirty.lines
            const list = lines.slice(0, 5).map(l => `• ${l}`).join('\n')
            const more = lines.length > 5 ? `\nvà ${lines.length - 5} mục khác…` : ''
            const detail = lines.length
                ? `${list}${more}\n\nRời trang và bỏ các thay đổi?`
                : 'Rời trang và bỏ các thay đổi?'
            if (!await confirm({ title: 'Còn thay đổi chưa lưu trong báo cáo.', detail, danger: true, confirmLabel: 'Rời trang' })) return
        }
        proceed()
    }

    const handleSaveInventory = async ({ silent = false } = {}) => {
        if (!selectedAddress) return
        if (silent && !inventory.isDirty) return // auto-lưu: không có gì đổi thì thôi
        if (inventory.restockOverflowIngredients.length > 0) {
            // Auto-lưu không bật alert (để FAB hiện cho user tự lưu & thấy cảnh báo).
            if (!silent) window.alert(`Không thể lưu: ${inventory.restockOverflowIngredients.length} nguyên liệu có "Lấy ra" vượt quá kho tổng. Vào /ingredients → + Nhập kho trước, hoặc giảm số "Lấy ra".`)
            return
        }
        // Chỉ confirm khi lưu THỦ CÔNG có CHUYỂN KHO (restock đổi) — auto-lưu soạn bỏ qua.
        if (!silent && inventory.restockDirty
            && !await confirm({ title: inventory.existingClosing?.id ? 'Cập nhật báo cáo (có chuyển kho ra quầy)?' : 'Lưu báo cáo (có chuyển kho ra quầy)?' })) return

        try {
            // Đẩy NHẸ: chỉ field đã đổi, merge race-free server-side. Hook tự dời baseline +
            // fold thay đổi của máy kia (từ row trả về). Không refetch ở đường này.
            const row = await inventory.pushInventory(profile?.id, systemTotalRevenue)
            if (!row) return // không có gì đổi (hoặc đang có push khác chạy) → isDirty giữ để thử lại
            if (silent) return // auto-lưu: im lặng, không refetch (kho/Giá trị tươi lại ở lần mở/đổi tab)
            showToast('Đã lưu báo cáo tồn kho', 'success')
            // Onboarding phase 4 — tick sau khi bấm Lưu (không phải lúc gõ Cuối kỳ), chỉ khi
            // giá trị vẫn còn tại thời điểm lưu thành công.
            if (isGuest) {
                if (coffeeInputValue !== undefined && coffeeInputValue !== '' && !inventoryProgress.coffee) {
                    setInventoryProgress(prev => ({ ...prev, coffee: true }))
                }
                if (cacaoInputValue !== undefined && cacaoInputValue !== '' && !inventoryProgress.cacao) {
                    setInventoryProgress(prev => ({ ...prev, cacao: true }))
                }
            }
            requestOnboardingRefresh()
            // Lưu THỦ CÔNG (thường kèm chuyển kho): refresh kho tổng + context để Giá trị/tồn đầu tươi.
            const [fresh] = await Promise.all([
                fetchDailyReportContext(selectedAddress.id),
                inventory.reloadStocks(),
            ])
            setShiftClosing(fresh?.shift_closing || row)
            if (fresh?.shift_closing) inventory.setExistingClosing(fresh.shift_closing)
        } catch (err) {
            if (!silent) showError(err, 'Lưu báo cáo tồn kho')
        }
    }
    // Ref tới bản handleSaveInventory mới nhất để timer auto-lưu gọi đúng state hiện tại.
    handleSaveInvRef.current = handleSaveInventory

    // Sửa "Tồn kho" (remaining) cuối ca của 1 NGÀY QUÁ KHỨ — fix khi kết ca nhập sai làm
    // hao hụt/lợi nhuận ngày đó sai. Ghi thẳng inventory_report vào đúng phiếu của ngày đó
    // (UPDATE theo id, KHÔNG qua merge RPC vì merge khoá cứng phiếu hôm nay). Tồn được tính
    // lúc đọc nên setShiftClosing là audit + lossValue + lợi nhuận tự tính lại; đầu kỳ ngày
    // kế cascade theo openingMap. Không đụng kho tổng (chỉ sửa remaining, không sửa restock).
    const handleSavePastInventory = async (newReport) => {
        if (!selectedAddress || !shiftClosing?.id) return false
        if (!await confirm({ title: 'Cập nhật tồn cuối ca của ngày này?', detail: 'Hao hụt và lợi nhuận của ngày sẽ được tính lại.' })) return false
        try {
            const saved = await saveShiftClosing(
                { address_id: selectedAddress.id, inventory_report: newReport },
                { existingId: shiftClosing.id },
            )
            setShiftClosing(saved || { ...shiftClosing, inventory_report: newReport })
            showToast('Đã cập nhật tồn cuối ca', 'success')
            return true
        } catch (err) {
            showError(err, 'Cập nhật tồn cuối ca')
            return false
        }
    }

    // isSavingShift (cờ của hook) chỉ true trong lúc GHI, nhả ngay khi save() xong — nhưng
    // nút chỉ ẩn khi cashDirty=false, mà cashDirty phụ thuộc shiftClosing chỉ cập nhật SAU
    // refetch. Cờ riêng này giữ nút disabled suốt cả refetch → không có khe double-click.
    const [savingCashflow, setSavingCashflow] = useState(false)

    // Bàn phím ảo trên điện thoại KHÔNG đẩy `position: fixed` lên — nó chỉ co
    // visualViewport, nên FAB "Lưu thực thu" nằm lọt dưới bàn phím ngay sau khi
    // chủ quán gõ xong số. Nhấc FAB lên đúng phần bị che.
    // Trần: trình duyệt không có visualViewport (rất cũ) thì giữ nguyên hành vi cũ.
    const [kbInset, setKbInset] = useState(0)
    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const update = () => setKbInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
        vv.addEventListener('resize', update)
        vv.addEventListener('scroll', update)
        return () => {
            vv.removeEventListener('resize', update)
            vv.removeEventListener('scroll', update)
        }
    }, [])

    const handleSaveCashflow = async () => {
        if (!selectedAddress || savingCashflow) return
        // Địa chỉ có bàn ngồi: mỗi đợt gọi món ghi 1 đơn ngay, nên bàn chưa tính tiền =
        // tiền đã nằm trong doanh thu hệ thống mà chưa nằm trong két. Cảnh báo ở lần chốt
        // đầu (sửa lại số sau đó thì thôi) — không chặn, vì có bàn ngồi thật qua giờ chốt.
        if (selectedAddress.dine_in && !shiftClosing?.cash_closed_at) {
            // Cảnh báo là phụ — hỏng ở đây (mạng, cột chưa có) không được chặn chốt ca.
            const openNow = await fetchOpenTables(selectedAddress.id).catch(() => [])
            if (openNow.length > 0) {
                const ok = await confirm({
                    title: `Còn ${openNow.length} bàn chưa tính tiền`,
                    detail: `${openNow.map(t => t.name).join(', ')} — ${formatVNDInput(openNow.reduce((s, t) => s + t.total, 0))}đ đã tính vào doanh thu nhưng chưa thu của khách.`,
                    confirmLabel: 'Vẫn chốt',
                })
                if (!ok) return
            }
        }
        // CHỈ ô đã sửa (xem buildCashPayload): máy kia đang đếm ô còn lại thì số của họ không
        // bị bản cũ trong state máy này đè lên. Đường UPDATE dùng lại đúng cashChanges đã
        // tính cho nút Lưu; chỉ phiếu MỚI mới phải dựng payload đầy đủ.
        const cashPayload = shiftClosing?.id ? cashChanges : buildCashPayload(
            null,
            { actual_cash: parseVNDInput(cashInput) || 0, actual_transfer: parseVNDInput(transferInput) || 0 },
            false,
        )
        if (!cashPayload) return   // không ô nào đổi → không gửi request nào
        setSavingCashflow(true)
        const payload = {
            address_id: selectedAddress.id,
            closed_by: profile?.id || null,
            system_total_revenue: systemTotalRevenue,
            ...cashPayload,
        }
        try {
            const saved = await saveShiftClosing(payload, {
                // isTodaysClosing, KHÔNG phải chỉ có id: get_daily_report_context thỉnh
                // thoảng trả phiếu HÔM QUA (biên tz — xem chỗ tính persistedCash). Lúc đó ô
                // Thực thu hiện trống (đúng), nhưng ghi theo id này là UPDATE tiền hôm nay
                // đè lên phiếu hôm qua: hôm qua sai số, hôm nay vẫn trống. Bỏ id ⇒ đi đường
                // INSERT, và insertShiftClosing đã tự lành khi đụng unique index cùng ngày.
                existingId: isTodaysClosing ? shiftClosing?.id : undefined,
            })
            // save() trả null khi bị bỏ qua do đang lưu việc khác → không báo thành công giả,
            // giữ cashDirty để user bấm lại.
            if (!saved) return
            showToast('Đã lưu thực thu', 'success')
            requestOnboardingRefresh()
            // Onboarding phase 3: cash/transfer done độc lập theo ô có gõ gì hay không lúc bấm
            // lưu — "trigger không theo thứ tự" (không đọc actual_cash/actual_transfer trong
            // payload: trống quy về 0 nên không phân biệt được "chưa nhập" vs "nhập 0").
            if (isGuest) {
                setCashFlowProgress(prev => ({
                    cash: prev.cash || cashInput.trim() !== '',
                    transfer: prev.transfer || transferInput.trim() !== '',
                }))
            }
            // Refetch shift_closing so display + pre-fill sync. invalidateDailyContext
            // inside the hook already cleared the cache, so the network is hit fresh.
            // Fallback về `saved` (row vừa ghi, có id) để giữ id phòng refetch trễ/null →
            // tránh INSERT phiếu trùng ở lần lưu kế.
            const fresh = await fetchDailyReportContext(selectedAddress.id)
            setShiftClosing(fresh?.shift_closing || saved)
        } catch (err) {
            showError(err, 'Lưu thực thu')
        } finally {
            setSavingCashflow(false)
        }
    }

    // Gate: 1 gói all-access mở CẢ 3 view báo cáo. View nào trong nhóm báo cáo
    // (Dòng tiền / Lợi nhuận / Tồn kho) mà address chưa có sub active → early-return
    // NGUYÊN trang đăng ký gói (chrome riêng, back về /pos). Cùng UI với /subscription.
    const needsAccess = view === VIEW_CASHFLOW || view === VIEW_INVENTORY || view === VIEW_PROFIT || view === VIEW_ALL
    if (monetizationEnabled && !entitlementLoading && needsAccess && !hasAccess) {
        return (
            <Navigate
                to="/subscription"
                replace
                state={{
                    preselectAddressId: selectedAddress?.id,
                    from: '/pos',
                }}
            />
        )
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <HistoryHeader
                rangeLabel={rangeLabel}
                scope={scope}
                onBack={() => guardLeave(() => goToMenuStep('report', -1, { navigate, backTo, scopeState: dateNavState, wizard: location.state?.wizard }))}
                onForward={() => goToMenuStep('report', +1, { navigate, backTo, scopeState: dateNavState, wizard: location.state?.wizard })}
                hintForward={hintGoToRecipes}
                activeTab="report"
                onTabSelect={(tab) => {
                    if (tab === 'report') return
                    guardLeave(() => navigate('/history', { replace: true, state: { from: backTo, tab, ...dateNavState } }))
                }}
                canGoForward={canGoForwardPeriod}
                onOffsetPrev={() => guardLeave(goOffsetPrev)}
                onOffsetNext={() => guardLeave(goOffsetNext)}
                rangeStartISO={rangeStart ? dateStringVN(rangeStart) : undefined}
                rangeEndISO={rangeEnd ? dateStringVN(rangeEnd) : undefined}
                dayInputValue={dayInputValue}
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={() => guardLeave(goPrevDay)}
                onNextDay={() => guardLeave(goNextDay)}
                customRange={customRange}
                onRangeChange={(r) => guardLeave(() => applyRange(r))}
                onShiftRange={(d) => guardLeave(() => shiftRange(d))}
                canShiftRangeForward={canShiftRangeForward}
                onPresetSelect={(p) => guardLeave(() => applyPreset(p))}
            />

            <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-6 pb-6 space-y-4 bg-bg">
                {!isReady ? (
                    <div className="flex flex-col gap-4 animate-pulse">
                        <div className="grid grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="bg-surface-light rounded-[24px] h-[72px]" />)}
                        </div>
                        <div className="bg-surface-light rounded-[24px] h-[62px]" />
                        <div className="grid grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="bg-surface-light rounded-[24px] h-[72px]" />)}
                            <div className="col-span-2 bg-surface-light rounded-[24px] h-[72px]" />
                        </div>
                        <div className="bg-surface-light rounded-[24px] h-52" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 animate-fade-in">
                        {(view === VIEW_ALL || view === VIEW_PROFIT) && !isStaff && (
                            <FinanceCards
                                totalRevenue={totalRevenue}
                                totalDiscount={totalDiscount}
                                totalCOGS={totalCOGS}
                                netProfit={netProfit}
                                expenses={displayExpenses}
                                expenseCategories={expenseCategories}
                                cogsByCategory={cogsByCategory}
                                lossValue={lossValue}
                                nonRecipeUsageLines={nonRecipeUsageLines}
                                onRecipesClick={() => guardLeave(() => navigate('/recipes', { state: { from: '/daily-report' } }))}
                            />
                        )}

                        {/* onEditExpense: bấm 1 dòng chi phí → mở modal sửa ngay tại chỗ,
                            không rời tab Báo cáo (xem ExpenseEditorModal ở cuối trang). */}
                        {(view === VIEW_ALL || view === VIEW_CASHFLOW) && (
                            <CashFlowCard
                                actualCash={actualCash}
                                actualTransfer={actualTransfer}
                                dailyExpense={dailyExpense}
                                refillFreeForm={refillFreeForm}
                                expenses={displayExpenses}
                                payments={displayPayments}
                                expenseCategories={expenseCategories}
                                editable={isTodayScope}
                                cashInput={cashInput}
                                transferInput={transferInput}
                                onCashChange={(v) => setCashInput(formatVNDInput(v))}
                                onTransferChange={(v) => setTransferInput(formatVNDInput(v))}
                                isSaving={isSavingShift}
                                hintCash={hintCash}
                                hintTransfer={hintTransfer}
                                onEditExpense={setEditingExpense}
                                onEditRestockPayment={handleEditRestockPayment}
                            >
                                <div className="flex flex-col gap-4">
                                    <SalesCard
                                        totalCups={totalCups}
                                        products={products}
                                        soldProducts={soldProducts}
                                        totalRevenue={totalRevenue}
                                        productStats={productStats}
                                        lineChartData={lineChartData}
                                        showChart={!isRangeScope}
                                    />
                                    {isRangeScope && (
                                        <DayPerformanceChart
                                            orders={displayOrders}
                                            range={scope}
                                            start={rangeStart}
                                            products={products}
                                        />
                                    )}
                                </div>
                            </CashFlowCard>
                        )}

                        {(view === VIEW_ALL || view === VIEW_INVENTORY) && (
                            <>
                                {view === VIEW_ALL && (
                                    <div className="flex items-center gap-3 py-1 my-1 px-4">
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Tồn kho</span>
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                    </div>
                                )}

                                {/* Today: editable inventory report — hao hụt + refill ("Bổ sung mai") merged per row. */}
                                {/* Past date: cùng editor, read-only khi không có quyền/không có phiếu. */}
                                {isTodayScope ? (
                                    <div className="flex flex-col gap-3">
                                        {/* Pill chỉ hiện "Đang lưu" (spinner) trong lúc GHI (isSavingShift) — tắt
                                            đúng lúc toast "Đã lưu" hiện. Trạng thái khác không cần pill. */}
                                        {isSavingShift && (
                                            <div className="flex justify-end -mb-1">
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border bg-primary/10 text-primary border-primary/30">
                                                    <Loader2 size={11} className="animate-spin" />
                                                    Đang lưu
                                                </span>
                                            </div>
                                        )}
                                        {/* Flow trong ngày: ① Soạn cho hôm nay → ② Hao hụt (cuối ca) → ③ Chuẩn bị tồn kho (cho mai) */}
                                        <ShiftPrepCard
                                            title="Chuẩn bị hôm nay"
                                            icon={<Truck size={15} className="text-primary shrink-0" />}
                                            packVerb="Lấy"
                                            haveLabel="Tồn quầy đầu ca"
                                            emptyTitle="Đủ hàng cho hôm nay!"
                                            emptyHint="Tồn quầy đầu ca đã đủ cho dự báo bán hôm nay."
                                            items={prepTodayList}
                                            checked={prepCheckedDerived}
                                            onToggle={togglePrepRestock}
                                            skipped={inventory.skipped}
                                            onSkip={toggleSkip}
                                            open={!!openCards.prep}
                                            onToggleOpen={() => toggleCard('prep')}
                                        />

                                        <InventoryReportCard
                                            ingredientsList={inventory.ingredientsList}
                                            isLoading={inventory.isLoadingIngredients}
                                            openingStock={inventory.openingStock}
                                            openingInputs={inventory.openingInputs}
                                            openingLocked={inventory.openingLocked}
                                            restockInputs={inventory.restockInputs}
                                            inventoryInputs={inventory.inventoryInputs}
                                            warehouseStocks={inventory.effectiveWarehouseStocks}
                                            ingredientUnits={inventoryRowUnits}
                                            usedMap={usedMap}
                                            consumptionBreakdown={consumptionBreakdown}
                                            ingredientToProduct={ingredientToProduct}
                                            isSubmitting={isSavingShift}
                                            baselineInputs={inventory.baselineSnapshot}
                                            baselineVersion={inventory.baselineVersion}
                                            onOpeningChange={inventory.onOpeningChange}
                                            onRestockChange={inventory.onRestockChange}
                                            onInventoryChange={inventory.onInventoryChange}
                                            open={!!openCards.audit}
                                            onToggleOpen={() => toggleCard('audit')}
                                            hintIngredient={hintInventoryIngredient}
                                        />

                                        {!isStaff && <MissingCupSuspicionCard candidates={missingCupCandidates} />}

                                        <ShiftPrepCard
                                            title="Bổ sung tồn kho"
                                            icon={<Package size={15} className="text-primary shrink-0" />}
                                            packVerb="Mua"
                                            haveLabel="Tồn quầy cuối ca"
                                            emptyTitle="Kho tổng đủ cho mai!"
                                            emptyHint="Không cần đi chợ đắp thêm cho ngày mai."
                                            items={warehousePrepList}
                                            onRestock={(ing, needPacks) => { setRestockIngredient(ing); setRestockSuggestedQty(needPacks > 0 ? needPacks : null) }}
                                            open={!!openCards.warehouse}
                                            onToggleOpen={() => toggleCard('warehouse')}
                                        />

                                        {shiftDone && (
                                            <div className="flex items-center justify-center gap-2 bg-success/10 border border-success/30 px-3 py-2 rounded-[10px] text-success">
                                                <span className="text-[12px] font-bold uppercase tracking-wide">✓ Đã hoàn tất ca hôm nay</span>
                                            </div>
                                        )}
                                    </div>
                                ) : scope === 'day' ? (
                                    // Ngày cũ: CHÍNH editor của hôm nay. Chủ/quản lý + có phiếu chốt (có id
                                    // để UPDATE) → truyền onSave, sửa được Cuối kỳ để fix kết ca sai. Staff
                                    // hoặc ngày không có phiếu → onSave={null} = editor tự khoá read-only.
                                    <PastInventoryEditor
                                        shiftClosing={shiftClosing}
                                        yesterdayClosing={yesterdayClosing}
                                        dayOrders={displayOrders}
                                        recipes={recipes}
                                        extraIngredients={extraIngredients}
                                        products={products}
                                        productExtras={productExtras}
                                        ingredientUnits={ingredientUnits}
                                        ingredientsList={inventory.ingredientsList}
                                        isLoading={inventory.isLoadingIngredients}
                                        isSaving={isSavingShift}
                                        onSave={!isStaff && shiftClosing?.id ? handleSavePastInventory : null}
                                        onDirtyChange={handlePastInvDirty}
                                    />
                                ) : (
                                    // Range scopes (week/month/custom): aggregate loss across all
                                    // closings in the period — mirrors what /range-report shows.
                                    // Hao hụt thuộc module 'inventory' → đã mở khoá khi tới được đây.
                                    <RangeLossCard
                                        orders={apiOrders}
                                        shiftClosings={apiShiftClosings}
                                        prevShiftClosings={prevShiftClosings}
                                        recipes={recipes}
                                        extraIngredients={extraIngredients}
                                        ingredientUnits={ingredientUnits}
                                    />
                                )}
                            </>
                        )}

                        <div className="flex flex-col items-center justify-center p-3">
                            <button
                                onClick={() => setShowSupportModal(true)}
                                className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-surface-light border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 cursor-pointer"
                            >
                                <span className="text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap mt-[1px] text-primary">
                                    Bạn cần hỗ trợ / có góp ý?
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </main>

            {/* FABs: Lưu thực thu + Lưu báo cáo — both floating bottom-right with the same
                CTA style (bg-primary + text-black), each auto-hidden until its section is dirty.
                Stacked when both appear (view = all + both dirty). */}
            {isTodayScope && (
                (((view === VIEW_ALL || view === VIEW_CASHFLOW) && cashDirty) ||
                    ((view === VIEW_ALL || view === VIEW_INVENTORY) && inventory.isDirty && !autoSavePending)) && (
                    <div
                        className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-40"
                        style={kbInset ? { transform: `translateY(-${kbInset}px)` } : undefined}
                    >
                        {/* Bàn phím mở thì thanh nav dưới cũng bị che luôn → không cần chừa 72px nữa. */}
                        <div className={`flex flex-col items-end gap-2 px-4 pointer-events-auto ${kbInset ? 'mb-3' : 'mb-[72px]'}`}>
                            {(view === VIEW_ALL || view === VIEW_CASHFLOW) && cashDirty && (
                                <button
                                    onClick={handleSaveCashflow}
                                    disabled={isSavingShift || savingCashflow}
                                    className="bg-primary text-black rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {(isSavingShift || savingCashflow) ? 'Đang lưu...' : 'Lưu thực thu'}
                                </button>
                            )}
                            {(view === VIEW_ALL || view === VIEW_INVENTORY) && inventory.isDirty && !autoSavePending && (
                                <button
                                    onClick={() => handleSaveInventory()}
                                    disabled={isSavingShift}
                                    className="bg-primary text-black rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isSavingShift ? 'Đang lưu...' : 'Lưu báo cáo'}
                                </button>
                            )}
                        </div>
                    </div>
                )
            )}

            {/* Footer = report view switcher (Dòng tiền / Tồn kho / Lợi nhuận).
                Replaces the old scope bar; scope is now driven entirely by the
                header date control + its presets. */}
            <div ref={footerRef} className="shrink-0 bg-surface/80 backdrop-blur-md border-t border-border/40 px-4 py-2.5 pb-[max(env(safe-area-inset-bottom),10px)]">
                <ReportViewFilter value={view} onChange={setView} isStaff={isStaff} hintView={hintInventoryTab ? VIEW_INVENTORY : null} />
            </div>
            <Toast toast={toast} />

            {editingExpense && (
                <ExpenseEditorModal
                    expense={editingExpense}
                    addressId={selectedAddress?.id}
                    onSaved={patchReportExpense}
                    onClose={() => setEditingExpense(null)}
                />
            )}

            {/* Sửa phiếu nhập kho (bấm 1 dòng "Mua nguyên liệu/bao bì" trong panel Thực chi) —
                tái dùng RestockModal của /ingredients, xem handleEditRestockPayment. */}
            {editingRestock && (() => {
                const { entry, ingredient } = editingRestock
                const cfg = (inventory.ingredientsList || []).find(i => i.ingredient === ingredient)
                return (
                    <RestockModal
                        ingredient={ingredient}
                        unit={getIngredientUnit(ingredient, ingredientUnits[ingredient])}
                        packSize={cfg?.pack_size}
                        packUnit={cfg?.pack_unit}
                        cashClosedToday={false}
                        mode="edit"
                        initial={{
                            qty: entry.metadata?.qty ?? 0,
                            subtotal: entry.metadata?.subtotal ?? entry.amount ?? 0,
                            discount: entry.discount_amount ?? 0,
                            extraCost: entry.extra_cost ?? 0,
                            paid: (entry.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
                            paymentMethod: entry.payment_method || 'cash',
                            cashPhase: entry.metadata?.cash_phase || 'post_close',
                            purchaseDate: dateStringVN(new Date(entry.created_at)),
                            purchaseTime: timeStringVN(new Date(entry.created_at)),
                        }}
                        onConfirm={handleSaveRestockEdit}
                        onClose={() => setEditingRestock(null)}
                    />
                )
            })()}

            {/* Nhập kho từ card "Chuẩn bị tồn kho" — tái dùng RestockModal của /ingredients. */}
            {restockIngredient && (() => {
                const cfg = (inventory.ingredientsList || []).find(i => i.ingredient === restockIngredient)
                return (
                    <RestockModal
                        ingredient={restockIngredient}
                        unit={getIngredientUnit(restockIngredient, ingredientUnits[restockIngredient])}
                        packSize={cfg?.pack_size}
                        packUnit={cfg?.pack_unit}
                        initialQty={restockSuggestedQty}
                        cashClosedToday={cashClosedToday}
                        onClose={() => setRestockIngredient(null)}
                        onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) => {
                            const wh = (inventory.warehouseStocks || {})[ing]
                            const snapshot = wh != null ? { beforeStock: wh } : {}
                            const result = await processIngredientRestock(selectedAddress?.id, ing, qty, profile?.name, {
                                subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                                ...snapshot,
                            })
                            // Nhập kho tạo payment (paid_at) → dòng tiền refill đọc từ todayPayments,
                            // không phải expenses. refreshTodayExpenses chỉ làm tươi expenses, nên kéo
                            // luôn context mới để cashflow cập nhật ngay. KHÔNG setShiftClosing ở đây —
                            // restock không đổi actual_cash/transfer, set lại sẽ xoá ô tiền đang gõ.
                            const [, , , , fresh] = await Promise.all([
                                inventory.reloadStocks?.(), inventory.reloadIngredients?.(), refreshProducts?.(), refreshTodayExpenses?.(),
                                fetchDailyReportContext(selectedAddress.id),
                            ])
                            setTodayPayments(fresh?.target_payments || [])
                            showToast('Đã nhập kho', 'success')
                            return result
                        }}
                    />
                )
            })()}

            {/* Support Modal */}
            <SupportModal
                open={showSupportModal}
                onClose={() => setShowSupportModal(false)}
            />
        </div>
    )
}
