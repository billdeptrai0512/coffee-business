import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchTodayStats, submitOrder, fetchTodayOrders, deleteOrder, updateOrderDiscount, fetchTodayExpenses, insertExpense, updateExpense, deleteExpense, fetchRecentOrders, invalidateDailyContext, fetchOpenTables, closeTable, reopenTable, markOrderServed, mergeTableLines, tableLineName, moveTableRounds as moveTableRoundsService } from '../services/orderService'
import { upsertSession } from '../services/authService'
import { useOfflineSync, addPendingOrder, addPendingTableClose, removePendingTableClose } from '../hooks/useOfflineSync'
import { useOrdersPoll } from '../hooks/useOrdersPoll'
import { dateStringVN } from '../utils/dateVN'
import { calculateProductCost, computeDiscount, discountToPercent, cartLineSubtotal, NO_DISCOUNT } from '../utils'
import { useProducts } from './ProductContext'
import { useAddress } from './AddressContext'
import { useAuth } from './AuthContext'
import { Outlet, useLocation } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { CartContext } from './CartContext'
import { StatsContext } from './StatsContext'
import { HistoryContext } from './HistoryContext'

// Mất mạng vs lỗi thật: chỉ lỗi mạng mới được xếp hàng chờ, lỗi thật phải nổi lên cho
// người dùng thấy. Supabase-js ném TypeError của fetch nên phải soi message.
const isNetworkError = (err) => !navigator.onLine || /fetch|network|NetworkError/i.test(err?.message || '')

// Dòng Nhật ký và dòng hoá đơn bàn cùng một quy ước ("2 Cà phê (Ít đá)"), nên cùng dùng
// tableLineName + mergeTableLines của orderService — ba bản chép tay của cùng một quy ước
// là ba chỗ để nó lệch nhau. Ở ngoài component: buildLastOrderFrom* phải "static" thì các
// hook dùng chúng mới không phải khai thêm dependency.
const journalLines = (lines) => lines.map(l => `${l.qty > 1 ? l.qty + ' ' : ''}${l.name}`)

function mergeFetchedOrders(prev, fetchedOrders) {
    // The optimistic row's id IS the real orders.id (client-generated in
    // doSubmit, sent straight to the RPC) — a fetched row with the same id
    // is the confirmed copy of that exact row, no heuristic matching needed.
    const fetchedIds = new Set(fetchedOrders.map(o => o.id))
    const stillPending = prev.filter(o => o._optimistic && !fetchedIds.has(o.id))
    return [...stillPending, ...fetchedOrders]
}

export function POSProvider() {
    const { products, recipes, ingredientCosts, extraIngredients, productExtras } = useProducts()
    const { selectedAddress } = useAddress()
    const { profile, isGuest, hasSession } = useAuth()
    const addressId = selectedAddress?.id
    // POSProvider bọc chung /pos, /history, /daily-report, /recipes, /ingredients (App.jsx) —
    // nhưng revenue/cupsSold/recentOrders/openTables chỉ mỗi /pos render. Trước đây 2 effect
    // dưới (thống kê hôm nay + mở bàn) chạy ngay khi addressId có, bất kể trang nào đang mở:
    // vào thẳng /history qua "Lối tắt" ở /addresses (không qua /pos) vẫn kéo fetchTodayStats +
    // fetchRecentOrders + fetchOpenTables (join nặng, dine-in) chạy song song với 3 request
    // /history thật sự cần → tranh connection cho không. Gate theo pathname==='/pos', chỉ fetch
    // 1 LẦN cho mỗi addressId (không refetch mỗi lần quay lại /pos — poll/realtime lo phần cập
    // nhật tiếp theo).
    const { pathname } = useLocation()
    const isPosPage = pathname === '/pos'

    // Mirrors for the cart handlers below (useCallback'd with empty/near-empty deps
    // so ProductCard's React.memo actually bails out on untouched cards — otherwise
    // MenuGrid re-renders EVERY product card on every single tap). Same "ref mirror"
    // idiom as cartRef/revenueRef above, just for state these handlers need to read
    // without becoming unstable every render.
    const activeCartItemIdRef = useRef(null)
    const enabledStickyExtraIdsRef = useRef([])
    // Chế độ bàn ngồi lại (addresses.dine_in): chạm món = THÊM vào giỏ thay vì chốt
    // đơn trước đó. Ref vì handleAddItem useCallback deps gần-rỗng (xem comment trên).
    const dineIn = !!selectedAddress?.dine_in
    const dineInRef = useRef(dineIn)
    dineInRef.current = dineIn

    // ---- Persisted State ----
    const loadLocalJSON = (key, fallback) => {
        try { const val = localStorage.getItem(key); return val ? JSON.parse(val) : fallback }
        catch { return fallback }
    }

    // Giỏ và nhãn bàn thuộc về ĐÚNG MỘT chi nhánh, nhưng localStorage không ghi điều đó.
    // Đổi chi nhánh qua màn /addresses làm POSProvider unmount rồi mount lại hẳn, nên
    // effect "đổi địa chỉ = bỏ giỏ" bên dưới KHÔNG chạy (bản mới sinh ra đã thấy địa chỉ
    // mới ngay từ đầu) — giỏ/bàn của quán cũ sống sang quán mới và cú gửi tiếp theo ghi
    // nguyên đợt đó vào SAI address_id. Đường 1-chạm không lộ ra vì unmount flush đã chốt
    // hết trước khi rời màn; ở dineIn flush cố ý no-op nên nó lộ. Đóng dấu chi nhánh vào
    // localStorage và chỉ nạp lại khi trùng.
    // Hàm, không phải const: chỉ hai initializer bên dưới cần nó và chúng chỉ chạy lúc
    // mount — để thành const là đọc localStorage lại sau mỗi cú chạm món.
    const persistedForThisAddress = () => !addressId || localStorage.getItem(STORAGE_KEYS.CART_ADDRESS) === addressId

    const [cart, setCart] = useState(() => persistedForThisAddress() ? loadLocalJSON(STORAGE_KEYS.CART, []) : [])
    // Initialized to cart (not []) so a held item restored from localStorage on
    // mount is visible to handleAddItem/commitHeld immediately — otherwise there's
    // a window before the [cart] sync effect below runs where a fast tap reads a
    // stale empty ref and silently drops the restored held item.
    const cartRef = useRef(cart)
    const [activeCartItemId, setActiveCartItemId] = useState(null)
    // Bàn của đợt ĐANG dựng (chỉ dùng khi dineIn). '' = chưa chọn / đơn mang đi.
    // Persist như giỏ để đi qua /history hay reload rồi quay lại vẫn còn; gửi
    // xong thì handleConfirm trả về '' (xem ở đó).
    const [tableName, setTableName] = useState(() => persistedForThisAddress() ? (localStorage.getItem(STORAGE_KEYS.TABLE) || '') : '')
    useEffect(() => { localStorage.setItem(STORAGE_KEYS.TABLE, tableName) }, [tableName])
    // Ref vì handleAddItem đọc ở nhánh flush tự động (deps gần-rỗng, xem comment dineInRef) —
    // không có ref thì flush đó luôn thấy tableName rỗng dù state đang giữ tên bàn thật.
    const tableNameRef = useRef(tableName)
    tableNameRef.current = tableName
    // Các bàn còn khách, gộp từ DB (fetchOpenTables). Nguồn cho lưới chọn bàn và cho
    // số tổng cộng của bàn ở CheckoutBar.
    const [openTables, setOpenTables] = useState([])
    // Bản sao đọc-đồng-bộ cho refreshTables: fetch hỏng thì trả lại danh sách ĐANG có
    // thay vì rỗng, để người gọi không tưởng là bàn đã hết khách.
    const openTablesRef = useRef([])
    openTablesRef.current = openTables
    const [enabledStickyExtraIds, setEnabledStickyExtraIds] = useState([])
    const [revenue, setRevenue] = useState(() => Number(localStorage.getItem(STORAGE_KEYS.REVENUE)) || 0)
    const [totalCost, setTotalCost] = useState(() => Number(localStorage.getItem(STORAGE_KEYS.TOTAL_COST)) || 0)
    const [cupsSold, setCupsSold] = useState(() => Number(localStorage.getItem(STORAGE_KEYS.CUPS)) || 0)
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const { toast, showToast, showError } = useToast()

    // ---- History State ----
    const [todayOrders, setTodayOrders] = useState([])
    // Bản sao đọc-đồng-bộ cho vòng poll đồng bộ (nó sống trong effect, đọc state trực
    // tiếp là đọc mãi bản của lần mount đầu tiên).
    const todayOrdersRef = useRef([])
    todayOrdersRef.current = todayOrders
    const historyFetchedRef = useRef({ addressId: null, at: 0 }) // last successful handleLoadHistory fetch
    const [todayExpenses, setTodayExpenses] = useState([])
    const [isLoadingHistory, setIsLoadingHistory] = useState(false)
    // Order ids that just arrived from ANOTHER device (set by the sync poll below),
    // so /history can glow those rows briefly — otherwise a synced-in row looks
    // identical to one that's been sitting there all along.
    const [justArrivedIds, setJustArrivedIds] = useState(() => new Set())
    const justArrivedTimerRef = useRef(null)
    // Last few orders, newest first (max 3) — shown in the header "Nhật ký" card.
    const [recentOrders, setRecentOrders] = useState([])
    // createdAt of the row that should play the slide-in. Set only on a local
    // commit so the realtime DB echo (which refetches with a different server
    // timestamp → different key → remount) can't replay the animation.
    const [enterKey, setEnterKey] = useState(null)

    // Giỏ là state toàn cục, không gắn với địa chỉ nào. Đường 1-chạm không lộ ra vì
    // unmount flush đã chốt món đang giữ TRƯỚC khi địa chỉ đổi. Ở dineIn thì flush
    // no-op → cả bàn đang mở sống sót sang chi nhánh mới, và nếu chi nhánh đó tắt
    // dineIn thì cú chạm đầu tiên ghi nguyên bàn đó sang SAI địa chỉ.
    // Đổi chi nhánh = bỏ giỏ. Bỏ qua lần đầu (prev null) để giỏ khôi phục từ
    // localStorage lúc cold-start không bị xoá oan.

    // Dọn sạch giỏ. Ref trước state: cartRef là guard đồng bộ cho double-tap, phải rỗng
    // ngay trong cùng cú chạm chứ không đợi render sau. Ghi localStorage thẳng vì mấy chỗ
    // gọi hàm này (rời màn, chốt đơn) có thể unmount trước khi daemon debounce kịp chạy.
    // Khai ở đây (không phải cạnh các handler giỏ bên dưới) vì effect ngay sau cần nó
    // trong dep list — dep list chạy lúc render, tham chiếu hàm khai sau là ReferenceError.
    const clearCart = useCallback(() => {
        cartRef.current = []
        setCart([])
        activeCartItemIdRef.current = null
        setActiveCartItemId(null)
        localStorage.setItem(STORAGE_KEYS.CART, '[]')
    }, [])

    const prevAddressIdRef = useRef(addressId)
    useEffect(() => {
        const prev = prevAddressIdRef.current
        prevAddressIdRef.current = addressId
        if (!prev || !addressId || prev === addressId) return
        if (cartRef.current.length > 0) showToast('Đã bỏ giỏ hàng của chi nhánh trước', 'warning')
        clearCart()
        setTableName('')
        setOpenTables([])
        // Ghi thẳng, không đợi effect persist: đổi chi nhánh có thể kéo theo unmount nên
        // effect chưa chắc kịp chạy. Đóng dấu luôn chi nhánh mới để bản mount sau không
        // nạp lại giỏ/bàn vừa bị bỏ.
        localStorage.setItem(STORAGE_KEYS.TABLE, '')
        localStorage.setItem(STORAGE_KEYS.CART_ADDRESS, addressId)
    }, [addressId, showToast, clearCart])

    // ---- Bàn đang mở ----
    // Gọi lúc mở lưới bàn và sau khi đóng bàn. Không cắm vào realtime: đợt gửi
    // từ chính máy này đã cộng lạc quan ngay bên dưới (doSubmit), còn máy khác thì
    // lần mở lưới kế tiếp là khớp lại — rẻ hơn nhiều so với một kênh nữa.
    // Trả về luôn danh sách vừa lấy: chỗ tính tiền cần con số MỚI NHẤT ngay trong cùng
    // lượt bấm, không đợi state của vòng render sau.
    const refreshTables = useCallback(() => {
        if (!addressId) return Promise.resolve([])
        return fetchOpenTables(addressId)
            .then(list => { setOpenTables(list); return list })
            // Lỗi fetch KHÔNG phải là "bàn hết khách" — giữ nguyên lưới đang có. Nuốt
            // lỗi rồi setOpenTables([]) là xoá trắng bàn của khách đang ngồi.
            .catch(err => { console.error('refreshTables:', err); return openTablesRef.current })
    }, [addressId])

    // "Đã tải" reset mỗi khi ĐỔI địa chỉ (đứng riêng, không gộp deps vào effect dưới) — quay
    // lại /pos cho CÙNG địa chỉ thì khỏi load lại (poll lo phần cập nhật tiếp theo), nhưng đổi
    // sang địa chỉ khác rồi quay về địa chỉ cũ vẫn phải tải lại (dữ liệu có thể đã đổi lúc vắng).
    const tablesLoadedRef = useRef(false)
    useEffect(() => { tablesLoadedRef.current = false }, [addressId])
    useEffect(() => {
        if (!dineIn || !isPosPage || tablesLoadedRef.current) return
        tablesLoadedRef.current = true
        refreshTables()
    }, [dineIn, isPosPage, refreshTables])

    // Ra món: lật cờ NGAY trong state rồi mới gọi server, lỗi thì lật lại. Chờ PATCH
    // xong rồi refreshTables (một lượt join order_items, đo được ~1s) là nhân viên bấm
    // xong đứng nhìn nút không đổi màu. Không fetch lại sau khi PATCH thành công: thứ
    // duy nhất đổi là đúng cái cờ vừa lật.
    const toggleServed = useCallback(async (round) => {
        const next = round.servedAt ? null : new Date().toISOString()
        const apply = (v) => setOpenTables(prev => prev.map(t => ({
            ...t,
            rounds: t.rounds.map(r => (r.id === round.id ? { ...r, servedAt: v } : r)),
        })))
        apply(next)
        try {
            await markOrderServed(round.id, next)
        } catch (err) {
            apply(round.servedAt)
            showError(err, 'Đánh dấu ra món')
        }
    }, [showError])

    // Tính tiền = đóng bàn. Tiền đã vào doanh thu từng đợt nên ở đây không cộng trừ gì,
    // chỉ đóng dấu "lượt khách này xong". Nhận cả object bàn (không phải mỗi tên) để
    // hoàn tác dựng lại được thẻ mà không cần fetch — quan trọng khi đang mất mạng.
    const handleCloseTable = useCallback(async (table) => {
        const name = table?.name
        if (!addressId || !name) return
        const closedAt = new Date().toISOString()
        const drop = () => {
            setOpenTables(prev => prev.filter(t => t.name !== name))
            setTableName(prev => (prev === name ? '' : prev))
        }
        const restore = () => setOpenTables(prev => (prev.some(t => t.name === name) ? prev : [...prev, table]))

        try {
            await closeTable(addressId, name, closedAt)
            drop()
            // Không có hoàn tác thì bấm nhầm là phải vào DB mới cứu được bàn.
            showToast(`Đã tính tiền ${name}`, 'success', {
                label: 'Hoàn tác',
                onClick: () => reopenTable(addressId, name, closedAt)
                    .then(() => { restore(); refreshTables(); showToast(`Đã mở lại ${name}`, 'info') })
                    .catch(err => showError(err, 'Mở lại bàn')),
            })
        } catch (err) {
            if (isNetworkError(err)) {
                // Khách đang đứng trả tiền, mất mạng không được phép chặn. Xếp hàng như đơn.
                addPendingTableClose(addressId, name, closedAt)
                drop()
                showToast(`Đã tính tiền ${name} — chờ mạng để đồng bộ`, 'warning', {
                    label: 'Hoàn tác',
                    onClick: () => { removePendingTableClose(closedAt); restore(); showToast(`Đã mở lại ${name}`, 'info') },
                })
            } else {
                showError(err, 'Tính tiền bàn')
            }
        }
    }, [addressId, refreshTables, showToast, showError])

    // Gộp (chuyển hết đợt của bàn) / tách (chuyển một đợt) đều gọi hàm này — chỉ khác
    // orderIds truyền vào. Áp lạc quan NGAY vào openTables (như handleCloseTable/
    // toggleServed) rồi mới gọi mạng — đợi round-trip xong mới vẽ lại là lý do bấm xong
    // đứng khựng một nhịp mới thấy đợt nhảy bàn. Đợt tự mang nguyên total/lines/orderNo
    // của nó (xem comment orderNo ở TableDetailModal), chỉ đổi NHÓM nó thuộc về, nên dựng
    // lại state từ dữ liệu đang có mà không cần hỏi lại server.
    const moveTableRounds = useCallback(async (orderIds, targetTableName) => {
        const idSet = new Set(orderIds)
        // targetTableName === null là ý định rõ ràng "chuyển thành mang đi" (đích không có
        // tên) — khác với chuỗi rỗng/chưa gõ gì, vẫn phải chặn. "Mang đi" chẳng qua là bàn
        // có name = null trong openTables (xem fetchOpenTables), nên logic dưới đây so sánh
        // t.name === name generic, không cần rẽ nhánh riêng cho null.
        const name = targetTableName === null ? null : targetTableName?.trim()
        if (!addressId || !idSet.size || (name !== null && !name)) return
        const linesOf = (rounds) => rounds.reduce((ls, r) => mergeTableLines(ls, r.lines), [])

        const prevTables = openTablesRef.current
        const moved = []
        // Bàn nào có đợt bị lấy đi thì dựng lại (rounds/total/lines mới); bàn hết đợt bị
        // lọc bỏ luôn (bàn nguồn 1 đợt duy nhất khi gộp/tách hết). Không đụng object cũ —
        // rollback (khi network lỗi) cần prevTables còn nguyên vẹn.
        const withoutMoved = prevTables
            .map(t => {
                const stay = t.rounds.filter(r => !idSet.has(r.id))
                if (stay.length === t.rounds.length) return t
                moved.push(...t.rounds.filter(r => idSet.has(r.id)))
                return stay.length
                    ? { ...t, rounds: stay, total: stay.reduce((s, r) => s + r.total, 0), lines: linesOf(stay) }
                    : null
            })
            .filter(Boolean)

        // orderIds không khớp round nào đang có trong state (VD state vừa đổi ở máy khác) —
        // không có gì để áp lạc quan, cứ gọi mạng rồi refreshTables như đường cũ.
        if (!moved.length) {
            try { await moveTableRoundsService(addressId, orderIds, name); await refreshTables() }
            catch (err) { showError(err, 'Chuyển bàn') }
            return
        }

        const movedTotal = moved.reduce((s, r) => s + r.total, 0)
        const movedLines = linesOf(moved)
        const destIdx = withoutMoved.findIndex(t => t.name === name)
        const nextTables = destIdx === -1
            ? [...withoutMoved, { name, total: movedTotal, rounds: moved, openedAt: moved.reduce((min, r) => r.createdAt < min ? r.createdAt : min, moved[0].createdAt), lines: movedLines }]
            : withoutMoved.map((t, i) => i === destIdx
                ? { ...t, rounds: [...t.rounds, ...moved], total: t.total + movedTotal, lines: mergeTableLines(t.lines, movedLines) }
                : t)

        setOpenTables(nextTables)
        try {
            await moveTableRoundsService(addressId, orderIds, name)
        } catch (err) {
            setOpenTables(prevTables)
            showError(err, 'Chuyển bàn')
        }
    }, [addressId, refreshTables, showError])

    // ---- Offline sync ----
    const handleSyncComplete = useCallback(() => {
        if (!addressId) return
        fetchTodayStats(addressId).then(({ revenue, cups }) => { setRevenue(revenue); setCupsSold(cups) })
        showToast('Đã đồng bộ đơn hàng offline!', 'success')
    }, [addressId, showToast])

    const { getPendingCount, retrySync } = useOfflineSync(handleSyncComplete)

    // ---- Load data when /pos first becomes active for this address ----
    // Chỉ /pos render thẻ doanh thu/ly + "đơn gần nhất" (recentOrders) — tải 1 lần khi /pos
    // active cho địa chỉ hiện tại, không refetch mỗi lần quay lại /pos (poll lo cập nhật tiếp
    // theo); nhưng ĐỔI địa chỉ thì phải tải lại — statsLoadedRef reset riêng theo addressId.
    const statsLoadedRef = useRef(false)
    useEffect(() => { statsLoadedRef.current = false }, [addressId])
    useEffect(() => {
        if (!addressId || !isPosPage || statsLoadedRef.current) return
        statsLoadedRef.current = true

        async function load() {
            try {
                const [{ revenue: rev, cups }, recent] = await Promise.all([
                    fetchTodayStats(addressId),
                    fetchRecentOrders(addressId, 3)
                ])
                setRecentOrders(recent.map(buildLastOrderFromDB))
                if (supabase) {
                    setRevenue(rev)
                    setCupsSold(cups)
                }
            } catch (error) {
                showError(error, 'Tải dữ liệu hôm nay')
            }
        }
        load()
    }, [addressId, isPosPage, showError])

    // ---- Online/offline status ----
    useEffect(() => {
        const onOnline = () => setIsOnline(true)
        const onOffline = () => setIsOnline(false)
        window.addEventListener('online', onOnline)
        window.addEventListener('offline', onOffline)
        return () => {
            window.removeEventListener('online', onOnline)
            window.removeEventListener('offline', onOffline)
        }
    }, [])

    // ---- Auto-Reset New Day ----
    useEffect(() => {
        const checkNewDay = () => {
            const storedDate = localStorage.getItem(STORAGE_KEYS.CURRENT_DATE)
            const todayStr = dateStringVN()
            if (storedDate && storedDate !== todayStr) {
                if (navigator.onLine && supabase && addressId) {
                    fetchTodayStats(addressId).then(({ revenue, cups }) => { setRevenue(revenue); setCupsSold(cups) })
                    setTotalCost(0)
                    showToast('Đã qua ngày mới, dữ liệu đã được làm mới!', 'info')
                } else {
                    setRevenue(0)
                    setCupsSold(0)
                    setTotalCost(0)
                }
                localStorage.setItem(STORAGE_KEYS.CURRENT_DATE, todayStr)
            } else if (!storedDate) {
                localStorage.setItem(STORAGE_KEYS.CURRENT_DATE, todayStr)
            }
        }

        window.addEventListener('focus', checkNewDay)
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') checkNewDay()
        }
        window.addEventListener('visibilitychange', handleVisibility)

        return () => {
            window.removeEventListener('focus', checkNewDay)
            window.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [addressId, showToast])

    // ---- Đồng bộ đơn giữa các máy ----
    // Poll thay cho kênh realtime cũ — lý do đầy đủ ở hooks/useOrdersPoll.js. Ở đây chỉ
    // còn việc áp kết quả vào state; hook lo nhịp, cổng màn hình và chuyện tab ẩn/hiện.
    useOrdersPoll({
        addressId,
        isGuest,
        localOrdersRef: todayOrdersRef,
        onChange: ({ newOrders, patched, moneyChanged, tableChanged }) => {
            if (newOrders.length) {
                setTodayOrders(prev => {
                    // Giữa lúc poll bay về, chính máy này có thể vừa chốt một đơn và đã
                    // chèn hàng lạc quan cùng id — lọc lại tại thời điểm áp, đừng nhân đôi.
                    // Không sắp xếp: HistoryPage sắp theo createdAt trước khi hiện.
                    const have = new Set(prev.map(o => o.id))
                    const add = newOrders.filter(o => !have.has(o.id))
                    return add.length ? [...add, ...prev] : prev
                })
                // Đơn từ máy khác trông y hệt đơn đã nằm đó từ nãy — cho /history phát sáng
                // mấy dòng này vài giây để người ở quầy thấy mà không phải dò cả danh sách.
                setJustArrivedIds(prev => new Set([...prev, ...newOrders.map(o => o.id)]))
                clearTimeout(justArrivedTimerRef.current)
                justArrivedTimerRef.current = setTimeout(() => setJustArrivedIds(new Set()), 3000)
                // Thẻ Nhật ký trên header /pos: dựng thẳng từ hàng vừa có, không tốn query.
                // Lọc đơn đã xoá cho khớp fetchRecentOrders — máy kia có thể vừa tạo vừa
                // xoá nhầm trong cùng một nhịp poll, thẻ không được hiện đơn đã bỏ.
                setRecentOrders(prev => [...newOrders.filter(o => !o.deleted_at).map(buildLastOrderFromDB), ...prev]
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .slice(0, 3))
            }
            if (patched.length) {
                const byId = new Map(patched.map(h => [h.id, h]))
                setTodayOrders(prev => prev.map(o => {
                    const head = byId.get(o.id)
                    // Ghi lại ĐỦ các cột đã so trong diffOrderHeads — thiếu cột nào là nhịp
                    // sau vẫn thấy lệch ở cột đó và lặp vô tận.
                    return head ? { ...o, ...head } : o
                }))
                // Sửa/xoá đơn là thao tác tay, hiếm — chịu một lượt fetch để thẻ Nhật ký kéo
                // đơn thứ 4 lên đúng chỗ đơn vừa bị xoá (giống hệt handleDeleteOrder tại chỗ).
                if (moneyChanged) fetchRecentOrders(addressId, 3).then(recent => setRecentOrders(recent.map(buildLastOrderFromDB)))
            }
            // Tổng ngày lấy lại từ server chứ không tự cộng ở client: chiết khấu và đơn bị
            // xoá làm phép cộng tay lệch dần, mà đây là con số tiền. Chỉ khi tiền thật sự
            // đổi — máy kia lật cờ "Ra món" thì lưới bàn vẽ lại là đủ.
            if (moneyChanged) fetchTodayStats(addressId).then(({ revenue: rev, cups }) => { setRevenue(rev); setCupsSold(cups) })
            // Chỉ khi thay đổi thật sự động tới bàn. Sửa chiết khấu một đơn MANG ĐI mà kéo
            // fetchOpenTables (join order_items + products từng bàn) là trả giá cho không.
            if (dineIn && tableChanged) refreshTables()
        },
        // Rời app lâu rồi quay lại. Vòng poll chỉ giỏi bắt từng đơn lẻ; cả quãng vắng thì
        // một lượt nạp đầy rẻ hơn (và ngắn hơn) một URL id=in.(...) ôm hết đơn đã lỡ.
        // Chi phí không nằm trong vòng poll nên cũng kéo ở đây.
        // handleLoadHistory nạp cả đơn lẫn chi phí trong một lượt Promise.all, nên ở đây
        // chỉ phải thêm tổng ngày.
        onResume: () => {
            handleLoadHistory()
            fetchTodayStats(addressId).then(({ revenue: rev, cups }) => { setRevenue(rev); setCupsSold(cups) })
        },
    })

    // ---- Heartbeat for active_sessions ----
    useEffect(() => {
        // !hasSession: addressId đến từ cache nên effect này chạy được trước khi có token —
        // policy active_sessions cũng gọi auth_owner_id như addresses/users, xem AuthContext.
        if (!addressId || !hasSession) return

        // Chỉ còn nuôi last_seen cho màn /addresses hiện "ai đang trong ca". Trước đây
        // interval chạy 30s để dò lại số máy cho cổng realtime (cổng đã bỏ, xem
        // useOrdersPoll.js); giờ 5 phút là đủ — last_seen chỉ cần nằm trong mốc cắt 10
        // phút mà fetchBranchesTodayStats/sessionsMap dùng để tính "ai đang online".
        //
        // Đọc userId từ localStorage (AddressContext ghi lúc upsert lần đầu) chứ không
        // import từ AuthContext: import chéo hai chiều giữa hai context là vòng lặp.
        const interval = setInterval(() => {
            const savedId = localStorage.getItem(STORAGE_KEYS.SELECTED_ADDRESS)
            if (savedId !== addressId) return
            const userId = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID)
            if (userId) upsertSession(userId, addressId)
        }, 5 * 60 * 1000)

        return () => clearInterval(interval)
    }, [addressId, hasSession])

    const revenueRef = useRef(revenue)
    const totalCostRef = useRef(totalCost)
    const cupsSoldRef = useRef(cupsSold)
    // Cleanup lúc unmount có dep rỗng nên không đọc được addressId của render cuối.
    const addressIdRef = useRef(addressId)
    addressIdRef.current = addressId

    useEffect(() => { revenueRef.current = revenue }, [revenue])
    useEffect(() => { totalCostRef.current = totalCost }, [totalCost])
    useEffect(() => { cupsSoldRef.current = cupsSold }, [cupsSold])
    // activeCartItemIdRef/enabledStickyExtraIdsRef are NOT synced via effect (unlike
    // the 3 above) — deliberately. A post-paint effect leaves a window where a 2nd
    // fast tap (extras bar) reads a stale ref before the 1st tap's effect has run,
    // silently dropping the 1st tap's toggle. Mutated synchronously at each setState
    // call site instead (see handleAddItem/cancelHeld/commitHeld/handleToggleStickyExtra
    // below) — same zero-gap idiom as cartRef above.

    // ---- Autosave Daemon ----
    // PERF: debounce 5 synchronous localStorage writes that were firing on every
    // keystroke/cart change. localStorage is sync I/O — on slower devices this caused
    // visible jank. 400ms debounce coalesces bursts (typing, rapid add-to-cart) into
    // a single write per quiet period.
    useEffect(() => {
        const t = setTimeout(() => {
            localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cart))
            if (addressId) localStorage.setItem(STORAGE_KEYS.CART_ADDRESS, addressId)
            localStorage.setItem(STORAGE_KEYS.REVENUE, revenue.toString())
            localStorage.setItem(STORAGE_KEYS.TOTAL_COST, totalCost.toString())
            localStorage.setItem(STORAGE_KEYS.CUPS, cupsSold.toString())
        }, 400)
        return () => clearTimeout(t)
    }, [cart, revenue, totalCost, cupsSold, addressId])

    // Save absolute latest states synchronously on unmount
    useEffect(() => {
        return () => {
            localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cartRef.current))
            if (addressIdRef.current) localStorage.setItem(STORAGE_KEYS.CART_ADDRESS, addressIdRef.current)
            localStorage.setItem(STORAGE_KEYS.REVENUE, revenueRef.current.toString())
            localStorage.setItem(STORAGE_KEYS.TOTAL_COST, totalCostRef.current.toString())
            localStorage.setItem(STORAGE_KEYS.CUPS, cupsSoldRef.current.toString())
        }
    }, [])

    // cartRef mirrors cart so commitHeld / handleAddItem can read the latest
    // held item (with extras) synchronously without going stale.
    useEffect(() => { cartRef.current = cart }, [cart])

    // ---- Last order helpers ----
    function buildLastOrderFromDB(order) {
        const lines = mergeTableLines([], (order.order_items || []).map(i => ({
            name: tableLineName(i.products?.name || '?', (i.options || '').split(', ')),
            qty: i.quantity,
        })))
        return { id: order.id, total: order.total, createdAt: order.created_at, items: journalLines(lines) }
    }

    function buildLastOrderFromCart(cartItems, total) {
        const lines = mergeTableLines([], cartItems.map(i => ({
            name: tableLineName(i.name, (i.extras || []).map(e => e.name)),
            qty: i.quantity,
        })))
        // id = stable unique React key. createdAt is ms-resolution, so two orders
        // committed in the same millisecond would collide as keys → dup-key render bug.
        return { id: crypto.randomUUID(), total, createdAt: new Date().toISOString(), items: journalLines(lines) }
    }

    // ---- Derived values ----
    const total = cart.reduce((sum, item) => {
        const extrasPrice = item.extras.reduce((extraSum, ex) => extraSum + ex.price, 0)
        return sum + (item.basePrice + extrasPrice) * item.quantity
    }, 0)

    const orderCount = cart.reduce((sum, item) => sum + item.quantity, 0)
    const hasOrder = cart.length > 0

    // Giảm giá sống trên từng dòng (item.discount, set qua % button ở CheckoutBar —
    // xem CartListModal). Tổng đơn chỉ là cộng dồn, không có khái niệm "giảm cả đơn"
    // riêng nữa.
    const discountAmount = cart.reduce((sum, item) => (
        sum + computeDiscount(cartLineSubtotal(item), item.discount || NO_DISCOUNT).discountAmount
    ), 0)
    const finalTotal = Math.max(0, total - discountAmount)

    // Live draft of the currently-held (not-yet-saved) item — shown as the top
    // line of the header journal so it appears the instant you tap, and extras
    // overwrite it in place (stable 'draft' key in Header → no remount/flash).
    const draftOrder = useMemo(() => cart.length ? { ...buildLastOrderFromCart(cart, total), cartItemId: cart[cart.length - 1].cartItemId } : null, [cart, total])

    // ---- Handlers ----

    // ponytail: fire-and-forget single-item submit, no isSubmitting gate
    // discountAmountArg/tableNameArg chỉ khác mặc định ở chế độ dineIn (handleConfirm).
    // Đường 1-chạm gọi doSubmit(cartItems) như cũ — chiết khấu vẫn sửa sau ở /history.
    function doSubmit(cartItems, discountAmountArg = 0, tableNameArg = null) {
        if (!cartItems || cartItems.length === 0) return

        const costPerItem = {}
        const cartCost = cartItems.reduce((sum, item) => {
            const c = calculateProductCost(item.productId, item.extras || [], recipes, extraIngredients, ingredientCosts)
            costPerItem[item.cartItemId] = c
            return sum + c * item.quantity
        }, 0)
        const itemTotal = cartItems.reduce((sum, item) => {
            const extrasPrice = item.extras.reduce((s, e) => s + e.price, 0)
            return sum + (item.basePrice + extrasPrice) * item.quantity
        }, 0)
        const countableQty = cartItems.reduce((sum, item) => {
            const prod = products?.find(p => p.id === item.productId)
            return prod?.count_as_cup === false ? sum : sum + item.quantity
        }, 0)
        // Số tiền thực thu = gộp trừ chiết khấu. Server tính lại y hệt
        // (bulk_create_orders: total = tổng dòng − discount_amount) nên optimistic
        // và hàng DB không lệch khi realtime echo về.
        const discountApplied = Math.min(Math.round(discountAmountArg) || 0, itemTotal)
        const netTotal = itemTotal - discountApplied

        // Optimistic UI
        setRevenue(prev => prev + netTotal)
        setTotalCost(prev => prev + cartCost)
        setCupsSold(prev => prev + countableQty)
        // The header "Nhật ký" card shows the last 3 orders (newest first, sliding
        // in) — that's the confirmation. No success toast (it conflicts with the
        // card + lags a tap). Keep the added row's identity to undo it on failure.
        const addedRow = buildLastOrderFromCart(cartItems, netTotal)
        setRecentOrders(prev => [addedRow, ...prev].slice(0, 3))
        setEnterKey(addedRow.createdAt)
        // id của hàng orders, sinh sẵn ở đây (xem nhánh online bên dưới) để đợt cộng
        // lạc quan cho bàn mang đúng id — modal chi tiết bàn xoá theo id này. Offline
        // chưa có id (addPendingOrder tự sinh lúc sync) → đợt đó chưa xoá được, modal
        // ẩn nút xoá cho tới khi có mạng.
        const online = navigator.onLine && !!supabase
        const orderId = online ? crypto.randomUUID() : null
        // Bàn cộng dồn ngay, cùng kiểu lạc quan như doanh thu ở trên — nhân viên phải
        // thấy tổng bàn nhảy lên trong cùng cú chạm, không đợi vòng fetch. Guard bằng
        // dineIn (không phải tableNameArg): đơn mang đi ở địa chỉ CÓ bàn cũng phải cộng
        // lạc quan vào bucket name=null — không thì thẻ "Mang đi" trong Chọn bàn chỉ cập
        // nhật sau khi mở lại modal (refreshTables), lệch tốc độ với thẻ bàn tên thật.
        // Địa chỉ tắt Bàn ngồi thì openTables chưa từng fetch (xem effect refreshTables ở
        // trên), cộng vào đó không ai đọc — bỏ qua cho khỏi phình state vô ích.
        if (dineInRef.current) setOpenTables(prev => {
            // Cùng dạng nhãn như fetchOpenTables (tên món kèm topping).
            const addLines = mergeTableLines([], cartItems.map(it => ({
                name: tableLineName(it.name, (it.extras || []).map(e => e.name)),
                qty: it.quantity,
            })))
            const addRound = {
                id: orderId, createdAt: addedRow.createdAt, total: netTotal, servedAt: null, lines: addLines,
                items: cartItems.map(it => ({
                    productId: it.productId, qty: it.quantity, extraIds: (it.extras || []).map(e => e.id).filter(Boolean),
                })),
            }
            const i = prev.findIndex(t => t.name === tableNameArg)
            if (i === -1) return [...prev, { name: tableNameArg, total: netTotal, rounds: [addRound], openedAt: addedRow.createdAt, lines: addLines }]
            const next = [...prev]
            next[i] = {
                ...next[i],
                total: next[i].total + netTotal,
                rounds: [...next[i].rounds, addRound],
                lines: mergeTableLines(next[i].lines, addLines),
            }
            return next
        })

        if (online) {
            // orderId (sinh ở trên) đi thẳng vào RPC làm orders.id thật — hàng lạc quan
            // và hàng DB dùng chung một danh tính ngay từ đầu, nên vòng poll đồng bộ nhận
            // ra đây là đơn nó đã có (không nhân đôi) mà không cần Set riêng nào.
            //
            // Optimistic /history row (raw fetchTodayOrders shape) so a just-submitted
            // order shows there instantly — e.g. to delete a mis-entry. _optimistic lets
            // handleLoadHistory keep it until a fetch confirms it (no extra query, no wait).
            const optimisticOrder = {
                _optimistic: true,
                id: orderId,
                total: netTotal,
                discount_amount: discountApplied,
                total_cost: Math.round(cartCost),
                created_at: addedRow.createdAt,
                staff_name: profile?.name || null,
                table_name: tableNameArg || null,
                deleted_at: null,
                deleted_by: null,
                payment_method: null,
                order_items: cartItems.map(item => ({
                    // Placeholder — hàng lạc quan này bị THAY NGUYÊN CẢ ĐƠN (không merge
                    // từng field) khi fetch thật về (mergeFetchedOrders theo order.id), nên
                    // id thật của order_items không cần khớp, chỉ cần có để khỏi crash nếu
                    // ai bấm sửa giảm giá đúng lúc đơn còn đang optimistic.
                    id: item.cartItemId,
                    quantity: item.quantity,
                    options: item.extras?.length ? item.extras.map(e => e.name).join(', ') : null,
                    product_id: item.productId,
                    unit_cost: Math.round(costPerItem[item.cartItemId] || 0),
                    extra_ids: item.extras?.map(e => e.id).filter(Boolean) || [],
                    discount_amount: computeDiscount(cartLineSubtotal(item), item.discount || NO_DISCOUNT).discountAmount,
                    products: { name: item.name },
                })),
            }
            setTodayOrders(prev => [optimisticOrder, ...prev])
            submitOrder(cartItems, netTotal, null, addressId, cartCost, costPerItem, profile?.name, discountApplied, orderId, tableNameArg)
                .catch(err => {
                    if (isNetworkError(err)) {
                        // Reuse orderId already sent to the RPC above — if the server actually
                        // committed it before the response was lost, the retry is a no-op
                        // (ON CONFLICT) instead of creating a duplicate order.
                        addPendingOrder(
                            cartItems.map(item => ({ ...item, unitCost: costPerItem[item.cartItemId] || 0, extraIds: item.extras.map(e => e.id).filter(Boolean) })),
                            netTotal, null, addressId, cartCost, profile?.name, discountApplied, orderId, tableNameArg
                        )
                        setTodayOrders(prev => prev.filter(o => o !== optimisticOrder)) // offline pending list shows it instead
                        showToast('Lỗi mạng – lưu offline', 'warning')
                    } else {
                        // dineIn: handleConfirm đã dọn giỏ trước khi gửi (guard chống double-tap),
                        // nên lỗi thật (không phải mạng — nhánh trên đã nuốt) sẽ làm MẤT nguyên
                        // cả bàn và nhân viên phải bấm lại từ đầu. Trả giỏ về để bấm Thanh toán lại.
                        if (dineInRef.current && cartRef.current.length === 0) {
                            cartRef.current = cartItems
                            setCart(cartItems)
                        }
                        setRevenue(prev => prev - netTotal)
                        setTotalCost(prev => Math.max(0, prev - cartCost))
                        setCupsSold(prev => Math.max(0, prev - countableQty))
                        setRecentOrders(prev => prev.filter(o => o !== addedRow)) // genuine failure → don't leave a phantom order in the journal
                        setTodayOrders(prev => prev.filter(o => o !== optimisticOrder))
                        if (dineInRef.current) refreshTables() // gỡ phần đã cộng lạc quan cho bàn
                        showError(err, 'Ghi đơn')
                    }
                })
        } else {
            addPendingOrder(
                cartItems.map(item => ({ ...item, unitCost: costPerItem[item.cartItemId] || 0, extraIds: item.extras.map(e => e.id) })),
                netTotal, null, addressId, cartCost, profile?.name, discountApplied, null, tableNameArg
            )
            showToast(`Lưu offline (${getPendingCount()} đơn chờ)`, 'warning')
        }
    }

    // Always-current ref to doSubmit (itself unstable — recreated every render,
    // closing over products/recipes/profile/addressId/etc) so the cart handlers
    // below can call it without depending on its identity. Assigned synchronously
    // during render — a browser event only fires after render+commit, so by the
    // time any handler runs, this already points at the latest doSubmit. No
    // behavior change from calling doSubmit directly; only decouples identity.
    const doSubmitRef = useRef(doSubmit)
    doSubmitRef.current = doSubmit

    // 1-tap model: each tap submits the previously-held item, then holds the
    // new one. Extras toggle on the held item until the next tap.
    // useCallback'd with a near-empty dep list (reads activeCartItemId/
    // enabledStickyExtraIds via their ref mirrors, doSubmit via doSubmitRef) so
    // the identity stays stable across taps — otherwise ProductCard's React.memo
    // never bails out, since onAdd/onCancel would be new every single tap.
    const handleAddItem = useCallback((product) => {
        // dineIn: KHÔNG chốt món trước — gom vào giỏ, chỉ handleConfirm mới ghi DB.
        // Kèm tableNameRef: nếu vừa tắt "Bàn ngồi" giữa lúc giỏ đang dựng dở cho một bàn cụ
        // thể, đợt lỡ dở đó vẫn phải gắn đúng bàn khi bị flush qua đường mang đi này, không
        // thì rơi thành đơn không tên (tableName chỉ tự về '' sau handleConfirm, không phải
        // lúc toggle chế độ).
        if (!dineInRef.current && cartRef.current.length > 0) doSubmitRef.current(cartRef.current, 0, tableNameRef.current || null)

        const cartItemId = crypto.randomUUID()
        const stickyExtras = (productExtras[product.id] || []).filter(e => e.is_sticky && enabledStickyExtraIdsRef.current.includes(e.id))
        const newItem = { cartItemId, productId: product.id, name: product.name, basePrice: product.price, quantity: 1, extras: [...stickyExtras] }
        // Update cartRef SYNCHRONOUSLY (not just via the [cart] effect) so a very
        // fast next tap reads this held item and submits it — otherwise the effect
        // lags one frame and the item can be overwritten unsubmitted (lost order).
        // ponytail: chạm lại cùng món = thêm DÒNG mới, không cộng quantity — mỗi dòng
        // mang extras riêng, gộp lại thì không sửa topping từng ly được nữa.
        const next = dineInRef.current ? [...cartRef.current, newItem] : [newItem]
        cartRef.current = next
        setCart(next)
        activeCartItemIdRef.current = cartItemId // sync, same reason as cartRef above
        setActiveCartItemId(cartItemId)
    }, [productExtras])

    // dineIn: xoá 1 dòng khỏi giỏ. Chỉ dùng nội bộ cho cancelHeld (nút X trên card) —
    // giỏ không có UI danh sách riêng, món đang dựng nhìn ở focus card + dòng draft Nhật ký.
    const handleRemoveCartItem = useCallback((cartItemId) => {
        const next = cartRef.current.filter(i => i.cartItemId !== cartItemId)
        cartRef.current = next
        setCart(next)
        if (activeCartItemIdRef.current === cartItemId) {
            activeCartItemIdRef.current = next[next.length - 1]?.cartItemId ?? null
            setActiveCartItemId(activeCartItemIdRef.current)
        }
    }, [])

    // dineIn: giảm giá riêng một dòng trong giỏ (mở từ CartListModal). Sống trên
    // chính cart item nên tự dọn khi dòng đó bị xoá/gửi đơn — không cần reset riêng.
    const setItemDiscount = useCallback((cartItemId, itemDiscount) => {
        const next = cartRef.current.map(i => i.cartItemId === cartItemId ? { ...i, discount: itemDiscount } : i)
        cartRef.current = next
        setCart(next)
    }, [])

    // Cancel the currently-held item without submitting (undo a mis-tap).
    // dineIn: mọi món có trong giỏ đều hiện X trên card (held = qty > 0), nên X phải
    // bớt 1 ly CỦA CHÍNH MÓN ĐÓ — xoá theo dòng đang active thì chạm X ở Trà Đá lại
    // xoá mất ly Cà phê. Xoá dòng mới nhất của món để khớp với thứ tự vừa thêm.
    const cancelHeld = useCallback((product) => {
        if (!dineInRef.current) {
            clearCart()
            return
        }
        const prev = cartRef.current
        const targetId = product
            ? [...prev].reverse().find(i => i.productId === product.id)?.cartItemId
            : activeCartItemIdRef.current ?? prev[prev.length - 1]?.cartItemId
        if (targetId) handleRemoveCartItem(targetId)
    }, [handleRemoveCartItem, clearCart])

    // dineIn: gửi giỏ hiện tại thành MỘT đơn (một đợt gọi món), kèm chiết khấu + nhãn bàn.
    // Gửi xong là xong đợt: bỏ chọn bàn, về trạng thái đơn mới. Bàn vẫn mở trong DB nên
    // khách gọi thêm thì mở lưới bàn chọn lại đúng bàn đó (thấy luôn tổng đang chạy).
    // Giữ bàn dính lại sau khi gửi là một mode ẩn — ly của khách bàn sau sẽ lặng lẽ chui
    // vào hoá đơn của bàn trước.
    // Guard đồng bộ trên cartRef (không phải state) để double-tap không ghi 2 đơn.
    const handleConfirm = useCallback((discountAmountArg = 0, tableNameArg = null) => {
        const items = cartRef.current
        if (items.length === 0) return
        clearCart()
        doSubmitRef.current(items, discountAmountArg, tableNameArg)
        setTableName('')
    }, [clearCart])

    // Submit the held item and clear — used by the ✓ button (confirm the LAST order
    // without holding a new one) and by the unmount flush when leaving the POS
    // screen. Without it the last held order would never reach the DB.
    const commitHeld = useCallback(() => {
        // dineIn: giỏ là bàn đang dựng — rời màn hình POS (unmount flush) hay bấm ✓
        // ở Nhật ký đều KHÔNG được tự chốt, nếu không xem /history rồi quay lại là
        // bàn tự thanh toán non. Chỉ handleConfirm mới ghi đơn. Giỏ đã persist ở
        // localStorage nên bỏ flush không mất dữ liệu.
        if (dineInRef.current) return
        const items = cartRef.current
        if (items.length === 0) return
        clearCart() // trước doSubmit: sync guard, double-press không được ghi 2 lần
        doSubmitRef.current(items)
    }, [clearCart])

    // Extras read/write cartRef.current synchronously (not setCart's prev) so the
    // held item's extras are never stale when the next tap submits it.
    const handleToggleStickyExtra = useCallback((extra) => {
        const isEnabledNow = enabledStickyExtraIdsRef.current.includes(extra.id)
        const nextStickyIds = isEnabledNow ? enabledStickyExtraIdsRef.current.filter(id => id !== extra.id) : [...enabledStickyExtraIdsRef.current, extra.id]
        enabledStickyExtraIdsRef.current = nextStickyIds // sync, same reason as cartRef above
        setEnabledStickyExtraIds(nextStickyIds)

        const prev = cartRef.current
        if (prev.length > 0) {
            let idx = prev.findIndex(item => item.cartItemId === activeCartItemIdRef.current)
            if (idx === -1) idx = prev.length - 1
            const target = prev[idx]
            let newExtras = [...target.extras]
            if (!isEnabledNow) {
                if (!newExtras.some(e => e.id === extra.id)) newExtras.push(extra)
            } else {
                newExtras = newExtras.filter(e => e.id !== extra.id)
            }
            const next = [...prev]
            next[idx] = { ...target, extras: newExtras }
            cartRef.current = next
            setCart(next)
        }
    }, [])

    const handleToggleExtra = useCallback((extra) => {
        const prev = cartRef.current
        if (prev.length === 0) return
        let idx = prev.findIndex(item => item.cartItemId === activeCartItemIdRef.current)
        if (idx === -1) idx = prev.length - 1
        const target = prev[idx]
        const hasExtra = target.extras.some(e => e.id === extra.id)
        const newExtras = hasExtra ? target.extras.filter(e => e.id !== extra.id) : [...target.extras, extra]
        const next = [...prev]
        next[idx] = { ...target, extras: newExtras }
        cartRef.current = next
        setCart(next)
    }, [])

    async function handleLoadHistory() {
        if (!addressId) return
        // Freshness guard: dedup truly-simultaneous re-invocations (React re-render
        // churn), not a substitute for a real refetch — đơn mới của máy khác đã đi
        // đường vòng poll (useOrdersPoll), nên vài giây là đủ.
        const last = historyFetchedRef.current
        if (last.addressId === addressId && Date.now() - last.at < 4000) return
        setIsLoadingHistory(true)
        try {
            const [orders, expenses] = await Promise.all([
                fetchTodayOrders(addressId),
                fetchTodayExpenses(addressId),
            ])
            historyFetchedRef.current = { addressId, at: Date.now() }
            // Merge, don't clobber: keep optimistic rows the fetch doesn't have yet (their
            // insert is still in flight) so a just-tapped order never vanishes. Once the
            // fetch includes an id, its real row wins and the optimistic copy is dropped —
            // no duplicates, no extra query, no waiting on the insert.
            setTodayOrders(prev => mergeFetchedOrders(prev, orders))
            setTodayExpenses(expenses)
        } catch (err) {
            showError(err, 'Tải lịch sử đơn hàng')
        } finally {
            setIsLoadingHistory(false)
        }
    }

    async function handleDeleteOrder(orderId) {
        try {
            await deleteOrder(orderId, profile?.name)
            setTodayOrders(prev => prev.map(o => o.id === orderId ? { ...o, deleted_at: new Date().toISOString(), deleted_by: profile?.name } : o))
            if (addressId) {
                // Không await: kết quả chỉ chảy vào doanh thu/ly trên header, không ai
                // đợi nó. Await ở đây là bắt người xoá nhìn màn hình đứng thêm một RTT
                // (rõ nhất ở nút Sửa đợt — giỏ chỉ hiện món sau khi RPC này về).
                fetchTodayStats(addressId).then(({ revenue: rev, cups }) => { setRevenue(rev); setCupsSold(cups) })
                // Keep the POS journal header in sync — without this a delete here
                // leaves the removed order showing on /pos until the next reload.
                fetchRecentOrders(addressId, 3).then(recent => setRecentOrders(recent.map(buildLastOrderFromDB)))
                invalidateDailyContext(addressId)
                // Tổng bàn cũng lệch sau khi xoá — gom về đây thay vì bắt từng nơi gọi nhớ tự
                // refresh (xoá đơn dine_in từ Nhật ký trước đây bỏ sót đúng chỗ này). Dựng lại
                // TỪ DATA ĐANG CÓ (như moveTableRounds) thay vì refreshTables() — trước đây gọi
                // thêm 1 lượt fetchOpenTables khiến xoá đợt/đơn LÂU HƠN HẲN so với tạo/gộp/tách/
                // ra món (đều patch state tại chỗ), thẻ "Mang đi"/bàn đứng yên vài trăm ms sau
                // khi bấm Xoá trong lúc những nút khác phản hồi tức thì.
                if (dineIn) setOpenTables(prev => prev
                    .map(t => {
                        const stay = t.rounds.filter(r => r.id !== orderId)
                        if (stay.length === t.rounds.length) return t
                        return stay.length
                            ? { ...t, rounds: stay, total: stay.reduce((s, r) => s + r.total, 0), lines: stay.reduce((ls, r) => mergeTableLines(ls, r.lines), []) }
                            : null
                    })
                    .filter(Boolean))
            }
            showToast('Đã xóa đơn hàng', 'success')
            return true
        } catch (err) {
            showError(err, 'Xóa đơn hàng')
            // Trả kết quả thay vì chỉ toast: sửa đợt (TableDetailModal) phải biết đợt cũ
            // đã xoá được chưa trước khi nạp giỏ, nếu không là nhân đôi đơn của khách.
            return false
        }
    }

    // dineIn: SỬA một đợt đã gọi = xoá đợt cũ rồi đổ nguyên món của nó ngược vào giỏ,
    // sửa xong bấm Tạo đơn là thành đợt mới. Không có đường sửa tại chỗ: đợt đã ghi là
    // tiền đã vào doanh thu, sửa từng dòng phải đụng lại order_items + total + giá vốn.
    //
    // Cả chuỗi nằm ở đây chứ không ở modal: nó động tới tiền và có thể hỏng giữa chừng,
    // mà modal thì tự đóng (onPick) ngay sau bước cuối — nửa chuỗi chạy trong một
    // component đang unmount là cách mất đơn của khách.
    async function reopenRoundIntoCart(round) {
        // Món bị xoá khỏi menu sau khi bán thì không dựng lại được (không còn giá) —
        // dừng trước khi xoá, thà không sửa được còn hơn nạp một giỏ thiếu món.
        const items = []
        for (const it of round.items) {
            const p = products.find(x => x.id === it.productId)
            if (!p) {
                showError(new Error('Đợt này có món đã xoá khỏi menu'), 'Sửa đợt')
                return false
            }
            items.push({
                cartItemId: crypto.randomUUID(),
                productId: p.id,
                name: p.name,
                basePrice: p.price,
                quantity: it.qty,
                extras: (productExtras[p.id] || []).filter(e => it.extraIds.includes(e.id)),
            })
        }
        // Xoá hỏng thì DỪNG: nạp giỏ lúc đợt cũ còn nguyên là nhân đôi đơn của khách.
        if (!await handleDeleteOrder(round.id)) return false

        // Chiết khấu sống trên từng dòng (round.items[].discountAmount, xem fetchOpenTables)
        // khi có — gán ĐÚNG vào dòng đã bị giảm, không dồn cục vào dòng cuối nữa. Đợt CŨ
        // (tạo trước khi order_items có discount theo dòng) toàn 0 ở đây dù orders.discount_amount
        // > 0 → fallback dồn cả cục vào dòng cuối như cách cũ, không thì mất giảm giá khi sửa
        // đợt cũ. Chỉ lưu số đ đã giảm, không lưu %/đ đã CHỌN lúc áp (như OrdersList.jsx) — seed
        // lại theo % suy ngược qua discountToPercent, không mặc định "đ" gây hiểu lầm. `exact`
        // false (số tiền lẻ, không tròn %) thì giữ "đ" — xem comment ở discountToPercent.
        const itemDiscountSum = round.items.reduce((sum, it) => sum + (it.discountAmount || 0), 0)
        if (itemDiscountSum > 0) {
            round.items.forEach((it, idx) => {
                if (it.discountAmount > 0) {
                    const { pct, exact } = discountToPercent(cartLineSubtotal(items[idx]), it.discountAmount)
                    items[idx].discount = exact ? { type: 'percent', value: pct } : { type: 'amount', value: it.discountAmount }
                }
            })
        } else if (round.discountAmount > 0 && items.length > 0) {
            const { pct, exact } = discountToPercent(round.total + round.discountAmount, round.discountAmount)
            items[items.length - 1].discount = exact ? { type: 'percent', value: pct } : { type: 'amount', value: round.discountAmount }
        }

        // CỘNG vào giỏ chứ không thay: nhân viên có thể đang cầm mấy ly chưa gửi.
        const next = [...cartRef.current, ...items]
        cartRef.current = next
        setCart(next)
        // Không món nào "đang dựng": đợt nạp vào là món đã chốt, extras của nó không
        // được đổi theo cú chạm topping tiếp theo.
        activeCartItemIdRef.current = null
        setActiveCartItemId(null)
        showToast('Đợt cũ đã vào giỏ — sửa xong bấm Tạo đơn', 'info')
        return true
    }

    // Re-apply / edit a discount on an existing order. `total` is the new charged
    // amount (already computed from subtotal − discount by the caller). itemDiscounts
    // (optional) là mảng {id, discount_amount} sửa giảm giá riêng từng dòng cùng lúc
    // (xem OrdersList). Updates the local raw row + recomputes stats + the POS
    // journal header (total changed).
    async function handleUpdateOrderDiscount(orderId, total, discountAmount, itemDiscounts = []) {
        try {
            await updateOrderDiscount(orderId, total, discountAmount, itemDiscounts)
            const byId = new Map(itemDiscounts.map(d => [d.id, d.discount_amount]))
            setTodayOrders(prev => prev.map(o => o.id !== orderId ? o : {
                ...o, total, discount_amount: discountAmount,
                order_items: (o.order_items || []).map(i => byId.has(i.id) ? { ...i, discount_amount: byId.get(i.id) } : i),
            }))
            if (addressId) {
                const { revenue: rev, cups } = await fetchTodayStats(addressId)
                setRevenue(rev)
                setCupsSold(cups)
                fetchRecentOrders(addressId, 3).then(recent => setRecentOrders(recent.map(buildLastOrderFromDB)))
                invalidateDailyContext(addressId)
            }
            showToast('Đã cập nhật giảm giá', 'success')
        } catch (err) {
            showError(err, 'Cập nhật giảm giá')
        }
    }

    async function handleAddExpense(name, amount, isRefill = false, paymentMethod = 'cash', metadata = {}, isFixed = false, categoryId = null, createdAt = null) {
        if (!addressId) return
        try {
            const expense = await insertExpense(name, amount, addressId, isFixed, profile?.name, isRefill, paymentMethod, metadata, categoryId, createdAt)
            // Only fold into today's local list when it actually belongs to today —
            // a backdated expense (createdAt in the past) shows up on its own day's
            // range view, not today's. invalidateDailyContext below refreshes both.
            const isToday = !createdAt || dateStringVN(new Date(createdAt)) === dateStringVN(new Date())
            if (isToday) {
                setTodayExpenses(prev => [expense, ...prev])
                if (!isFixed) setTotalCost(prev => prev + amount)
            }
            invalidateDailyContext(addressId)
            // handleAddExpense chỉ được gọi từ modal "Thêm chi phí" — isRefill ở đây thực ra
            // là cờ "Sau ca" (xem HistoryPage.submitExpense), KHÔNG phải mua NVL thật (NVL đi
            // qua processIngredientRestock riêng). Toast không nên phân theo isRefill.
            showToast(isFixed ? 'Đã ghi nhận thực chi cố định' : 'Đã thêm chi phí', 'success')
            return expense
        } catch (err) {
            showError(err, isFixed ? 'Ghi nhận thực chi cố định' : 'Thêm chi phí')
            throw err
        }
    }

    async function handleUpdateExpense(expenseId, updates) {
        try {
            const updated = await updateExpense(expenseId, updates)
            // Patch today's local list if the row belongs to today's shift; range
            // views refetch via invalidateReportCache happening inside updateExpense.
            setTodayExpenses(prev => prev.map(e => e.id === expenseId ? { ...e, ...updates } : e))
            invalidateDailyContext(addressId)
            return updated
        } catch (err) {
            showError(err, 'Cập nhật chi phí')
            throw err
        }
    }

    async function handleDeleteExpense(expenseId, amount) {
        try {
            await deleteExpense(expenseId)
            const wasFixed = todayExpenses.find(e => e.id === expenseId)?.is_fixed
            setTodayExpenses(prev => prev.filter(e => e.id !== expenseId))
            if (!wasFixed) setTotalCost(prev => Math.max(0, prev - amount))
            invalidateDailyContext(addressId)
            showToast('Đã xóa chi phí', 'success')
        } catch (err) {
            showError(err, 'Xóa chi phí')
        }
    }

    // Re-fetch today expenses (e.g. after restock RPC bypasses handleAddExpense)
    async function refreshTodayExpenses() {
        if (!addressId) return
        try {
            const expenses = await fetchTodayExpenses(addressId)
            setTodayExpenses(expenses)
        } catch (err) {
            showError(err, 'Tải lại chi phí')
        }
    }

    const userRole = profile?.role || 'staff'

    // ---- Memoized slices ----
    // Each useMemo's deps list only the state this slice exposes. A change to,
    // say, todayOrders won't recompute cartValue → useCart consumers don't
    // re-render. (Function identities are stable across renders only when their
    // deps don't change; the original code already recreated them every render,
    // so this is no worse and slices keep change frequencies separated.)
    const cartValue = useMemo(() => ({
        cart, activeCartItemId,
        handleAddItem, cancelHeld, handleToggleExtra, handleToggleStickyExtra, commitHeld, reopenRoundIntoCart,
        setItemDiscount,
        dineIn, handleConfirm, tableName, setTableName,
        openTables, refreshTables, handleCloseTable, toggleServed, moveTableRounds,
        enabledStickyExtraIds,
        total, orderCount, hasOrder,
        discountAmount, finalTotal,
        recentOrders, draftOrder, enterKey,
        toast, showToast, showError,
        // deliberately partial deps, see comment above
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [cart, activeCartItemId, dineIn, tableName, openTables, refreshTables, handleCloseTable, toggleServed, moveTableRounds, enabledStickyExtraIds, total, orderCount, hasOrder, discountAmount, finalTotal, recentOrders, draftOrder, enterKey, toast, showToast, showError])

    const statsValue = useMemo(() => ({
        revenue, totalCost, cupsSold, isOnline,
        retrySync,
    }), [revenue, totalCost, cupsSold, isOnline, retrySync])

    const historyValue = useMemo(() => ({
        todayOrders, todayExpenses, isLoadingHistory, justArrivedIds,
        handleLoadHistory, handleDeleteOrder, handleUpdateOrderDiscount, handleAddExpense, handleUpdateExpense, handleDeleteExpense, refreshTodayExpenses,
        userRole,
        // deliberately partial deps, see comment above
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [todayOrders, todayExpenses, isLoadingHistory, justArrivedIds, userRole])

    return (
        <CartContext.Provider value={cartValue}>
            <StatsContext.Provider value={statsValue}>
                <HistoryContext.Provider value={historyValue}>
                    <Outlet />
                </HistoryContext.Provider>
            </StatsContext.Provider>
        </CartContext.Provider>
    )
}
