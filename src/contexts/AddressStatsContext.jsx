import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
import { useMonetizationEnabled } from '../hooks/useEntitlement'
import { fetchBranchesTodayStats, fetchStaffByManager, fetchSubscriptionStatuses } from '../services/authService'
import { onTabReturn } from '../utils/tabVisibility'

const AddressStatsContext = createContext(null)

// ponytail: hook co-located with its Provider (standard context pattern) —
// splitting into its own file isn't worth the diff for a fast-refresh (dev-only HMR) nag.
// eslint-disable-next-line react-refresh/only-export-components
export function useAddressStats() {
    const ctx = useContext(AddressStatsContext)
    if (!ctx) throw new Error('useAddressStats must be used within AddressStatsProvider')
    return ctx
}

// Holds dashboard stats (cups, revenue, active sessions, staff list) above the
// route level so navigating /addresses ↔ /pos doesn't unmount + refetch. The
// AddressSelectPage reads from cache instantly and revalidates in background.
export function AddressStatsProvider() {
    const { profile, isStaff, hasSession } = useAuth()
    const { addresses } = useAddress()
    const { enabled: monetizationEnabled } = useMonetizationEnabled()

    const [cupsMap, setCupsMap] = useState({})
    const [revenueMap, setRevenueMap] = useState({})
    const [prevCupsMap, setPrevCupsMap] = useState({})
    const [prevRevenueMap, setPrevRevenueMap] = useState({})
    const [sessionsMap, setSessionsMap] = useState({})
    const [subscriptionStatusMap, setSubscriptionStatusMap] = useState({})
    const [subscriptionRowsMap, setSubscriptionRowsMap] = useState({})
    // true ngay từ đầu (giả định đang tải) — tránh badge render "Chưa đăng ký" sai
    // trong 1 frame trước khi effect bên dưới kịp chạy và set lại giá trị thật.
    const [subscriptionLoading, setSubscriptionLoading] = useState(true)
    const [staffList, setStaffList] = useState([])
    const [statsLoading, setStatsLoading] = useState(false)
    const [staffLoading, setStaffLoading] = useState(false)

    const addressIdsKey = useMemo(() => addresses.map(a => a.id).join('|'), [addresses])
    const cancelRef = useRef(false)

    // Safety valve: RPC/query không có timeout ở tầng supabase-js — mất mạng giữa chừng
    // (đổi wifi/4G, tab bị OS pause) có thể treo promise vô thời hạn, kẹt card ở skeleton
    // mãi. Không abort request thật (không đáng đổi phức tạp) — chỉ ngừng chặn UI sau
    // timeout; request vẫn resolve bình thường sau đó thì state vẫn cập nhật. Cùng pattern
    // với valve ở AuthContext.jsx (dòng ~216-222).
    const loadingValve = (setLoading) => {
        const id = setTimeout(() => setLoading(false), 8000)
        return () => clearTimeout(id)
    }

    const loadStats = useCallback(async () => {
        if (!addresses.length) return
        const addrIds = addresses.map(a => a.id)
        setStatsLoading(true)
        const clearValve = loadingValve(setStatsLoading)
        try {
            // 1 RPC duy nhất trả cả stats + sessions (kèm tên/role) + prev — was 3 round-trips.
            const { cupsMap: cups, revenueMap: revenue, prevCupsMap: prevCups, prevRevenueMap: prevRevenue, sessionsMap: sessions } = await fetchBranchesTodayStats(addrIds)
            if (cancelRef.current) return
            const filledCups = {}, filledRev = {}
            addrIds.forEach(id => {
                filledCups[id] = cups[id] ?? 0
                filledRev[id] = revenue[id] ?? 0
            })
            setCupsMap(filledCups)
            setRevenueMap(filledRev)
            setPrevCupsMap(prevCups)
            setPrevRevenueMap(prevRevenue)
            setSessionsMap(sessions)
        } catch (err) {
            // Giữ nguyên số đang hiện thay vì đổ 0 lên mọi card: rớt mạng một nhịp không
            // có nghĩa là quán không bán được ly nào. BranchGrid vốn đã stale-while-revalidate.
            console.error('loadStats:', err)
        } finally {
            clearValve()
            if (!cancelRef.current) setStatsLoading(false)
        }
        // ponytail: keyed on addressIdsKey — `addresses` chỉ được dùng để lấy ids, mà mảng
        // đổi reference mỗi lần AddressContext refetch dù ids y hệt. Giữ deps là object thì
        // RPC ~1.9s này chạy lại vài lần mỗi lần khởi động.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressIdsKey])

    // Trạng thái gói dùng để sort BranchGrid (dùng thử → đã đăng ký → chưa đăng ký).
    // Không gọi khi monetization tắt — cột address_subscriptions vô nghĩa lúc đó.
    const loadSubscriptionStatuses = useCallback(async () => {
        if (!monetizationEnabled || !addresses.length) {
            setSubscriptionStatusMap({})
            setSubscriptionRowsMap({})
            setSubscriptionLoading(false)
            return
        }
        setSubscriptionLoading(true)
        // try/finally như loadStats: throw hoặc cancelRef=true mà bỏ qua setLoading(false)
        // thì badge gói trên mọi card ẩn vĩnh viễn (BranchGrid gate bằng loading).
        const clearValve = loadingValve(setSubscriptionLoading)
        try {
            const result = await fetchSubscriptionStatuses(addresses.map(a => a.id))
            if (cancelRef.current) return
            // null = lỗi mạng/RLS thoáng qua → giữ nguyên map cũ (không đè badge tốt
            // thành sai); onTabReturn bên dưới sẽ tự thử lại lần quay về sau.
            if (result) {
                setSubscriptionStatusMap(result.statusMap)
                setSubscriptionRowsMap(result.rowsMap)
            }
        } finally {
            clearValve()
            setSubscriptionLoading(false)
        }
        // ponytail: keyed on addressIdsKey như loadStats ở trên, cùng lý do.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressIdsKey, monetizationEnabled])

    // Expose để SubscriptionPanel gọi lại sau Mock/Reset gói (admin) — làm tươi cả
    // rows (badge từng card + panel) lẫn status (thứ tự sort) trong 1 lần refetch.
    //
    // AddressStatsProvider mount 1 LẦN cho cả phiên (bọc mọi route sau login, xem
    // App.jsx) — không như loadStats có setInterval 30s, hàm này trước đây chỉ
    // chạy đúng 1 lần lúc mount. 1 lần rớt mạng lúc mới mở app (rất hay gặp trên máy
    // POS bắt wifi quán) là badge sai SUỐT CẢ CA, không có gì tự sửa lại. Thêm
    // onTabReturn (đúng pattern loadStats đã dùng ở dưới) để có cơ hội tự phục hồi
    // mỗi lần quay lại app, không cần F5.
    useEffect(() => {
        loadSubscriptionStatuses()
        return onTabReturn(loadSubscriptionStatuses)
    }, [addressIdsKey, monetizationEnabled, loadSubscriptionStatuses])

    const loadStaff = useCallback(async () => {
        // !hasSession: profile từ cache nhưng chưa có token — xem hasSession trong AuthContext.
        if (!profile?.id || isStaff || !hasSession) return
        setStaffLoading(true)
        const clearValve = loadingValve(setStaffLoading)
        try {
            const list = await fetchStaffByManager(profile.id)
            if (!cancelRef.current) setStaffList(list)
        } finally {
            clearValve()
            if (!cancelRef.current) setStaffLoading(false)
        }
    }, [profile?.id, isStaff, hasSession])

    useEffect(() => {
        cancelRef.current = false
        if (!addresses.length) {
            setStatsLoading(false)
            return
        }
        loadStats()

        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') loadStats()
        }, 30_000)

        // Chỉ bắt "quay lại sau khi đi vắng", không phải mỗi lần visible — xem onTabReturn.
        const offTabReturn = onTabReturn(loadStats)
        return () => {
            cancelRef.current = true
            clearInterval(intervalId)
            offTabReturn()
        }
        // ponytail: keyed on addressIdsKey (ids only) — addresses.length is only an
        // early-bail snapshot, not something that should restart the poll interval.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressIdsKey, loadStats])

    useEffect(() => {
        loadStaff()
    }, [loadStaff])

    // 10 independent state slices set on separate schedules (polling, staff load,
    // subscription load) — without useMemo here, every consumer (AddressSelectPage,
    // SubscriptionPanel) re-renders whenever ANY one field updates.
    const value = useMemo(() => ({
        cupsMap,
        revenueMap,
        prevCupsMap,
        prevRevenueMap,
        sessionsMap,
        subscriptionStatusMap,
        subscriptionRowsMap,
        subscriptionLoading,
        staffList,
        statsLoading,
        staffLoading,
        refreshStats: loadStats,
        refreshStaff: loadStaff,
        refreshSubscriptionStatuses: loadSubscriptionStatuses,
    }), [cupsMap, revenueMap, prevCupsMap, prevRevenueMap, sessionsMap, subscriptionStatusMap, subscriptionRowsMap, subscriptionLoading, staffList, statsLoading, staffLoading, loadStats, loadStaff, loadSubscriptionStatuses])

    return (
        <AddressStatsContext.Provider value={value}>
            <Outlet />
        </AddressStatsContext.Provider>
    )
}
