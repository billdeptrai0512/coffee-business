import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from './AuthContext'
import {
    fetchAddresses, createAddress as apiCreateAddress, updateAddress as apiUpdateAddress, deleteAddress as apiDeleteAddress,
    setAddressDineIn as apiSetAddressDineIn, setAddressTables as apiSetAddressTables,
    setAddressPrinters as apiSetAddressPrinters,
    upsertSession,
    fetchWarehouseGroups, upsertWarehouseGroup as apiUpsertWarehouseGroup,
    deleteWarehouseGroup as apiDeleteWarehouseGroup, setAddressWarehouseGroup as apiSetAddressWarehouseGroup
} from '../services/authService'
import { getDemoAddress } from '../services/localRepository'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { Outlet } from 'react-router-dom'

const AddressContext = createContext(null)

// ponytail: hook co-located with its Provider (standard context pattern) —
// splitting into its own file isn't worth the diff for a fast-refresh (dev-only HMR) nag.
// eslint-disable-next-line react-refresh/only-export-components
export function useAddress() {
    const ctx = useContext(AddressContext)
    if (!ctx) throw new Error('useAddress must be used within AddressProvider')
    return ctx
}

// Normalize a name for duplicate detection (trim + collapse spaces + lowercase)
const normalizeName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()

// Cached selected-address object → lets the POS render on cold start without
// waiting for the addresses network fetch (which can hang 5s behind the SW
// NetworkFirst timeout on a flaky connection = "lag không bấm được order").
function readCachedAddress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ)
        return raw ? JSON.parse(raw) : null
    } catch { return null }
}

export function AddressProvider() {
    const { profile, isGuest, hasSession } = useAuth()
    const cachedAddress = readCachedAddress()
    const [addresses, setAddresses] = useState([])
    const [warehouseGroups, setWarehouseGroups] = useState([])
    const [selectedAddress, setSelectedAddressState] = useState(() => (isGuest ? null : cachedAddress))
    // Start unblocked when we already have a cached address — RequireAddress lets
    // POS through immediately and the real list refetches in the background.
    const [loading, setLoading] = useState(() => isGuest ? true : !cachedAddress)
    const [fetchError, setFetchError] = useState(null)

    // Load addresses when profile is available. Synchronous setState in the
    // guest/no-profile branches is an intentional init reset, not a cascade hazard.
    useEffect(() => {
        if (isGuest) {
            const demo = getDemoAddress()
            setAddresses([demo])
            setSelectedAddressState(demo)
            setWarehouseGroups([]) // grouping không áp dụng guest/local mode
            setLoading(false)
            return
        }

        if (!profile?.id) {
            setAddresses([])
            setWarehouseGroups([])
            setLoading(false)
            return
        }

        // profile có thể đến từ cache trong khi chưa có session — xem hasSession trong
        // AuthContext. Giữ nguyên cache, effect chạy lại khi session về (hasSession ở deps).
        if (!hasSession) {
            setLoading(false)
            return
        }

        let addressOwnerId = null
        if (profile.role === 'admin') {
            addressOwnerId = 'ALL'
        } else if (profile.role === 'manager') {
            // co-manager has manager_id pointing to the main manager
            addressOwnerId = profile.manager_id || profile.id
        } else {
            addressOwnerId = profile.manager_id
        }

        if (!addressOwnerId && profile.role !== 'admin') {
            setLoading(false)
            return
        }

        // Only gate the UI when we have nothing to show yet. With a cached address
        // the POS is already interactive; this fetch just reconciles in the background.
        if (!selectedAddress) setLoading(true)
        setFetchError(null)
        fetchAddresses(addressOwnerId).then(({ data, error }) => {
            if (error) {
                // Network/RLS failure → keep any cached address so POS stays usable offline.
                setFetchError(error.message || 'Không tải được danh sách địa chỉ')
                setLoading(false)
                return
            }
            const addrs = data || []
            setAddresses(addrs)

            if (addressOwnerId === 'ALL') {
                setWarehouseGroups([]) // admin xem toàn hệ thống — nhóm kho tổng chỉ có ý nghĩa trong 1 manager
            } else {
                fetchWarehouseGroups(addressOwnerId).then(({ data: groups }) => setWarehouseGroups(groups || []))
            }

            // "Mẫu mặc định" (id: null, admin-only) isn't a row in `addrs` — it can't be
            // looked up by id, so the reconcile-with-server-list logic below would always
            // "miss" and wrongly treat it as a deleted address. Keep it as-is instead.
            if (cachedAddress?.id === null) {
                setLoading(false)
                return
            }

            // Restore previously selected address from localStorage
            const savedId = localStorage.getItem(STORAGE_KEYS.SELECTED_ADDRESS)
            const saved = addrs.find(a => a.id === savedId)
            if (saved) {
                setSelectedAddressState(saved)
                localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ, JSON.stringify(saved))
            } else if (addrs.length === 1) {
                // Auto-select if only one address
                setSelectedAddressState(addrs[0])
                localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS, addrs[0].id)
                localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ, JSON.stringify(addrs[0]))
            } else if (!saved && addrs.length) {
                // Saved address genuinely no longer exists for this account → drop the
                // stale selection + cache so RequireAddress sends the user to pick a
                // valid one. (An empty result — likely a transient read — keeps the cache.)
                if (cachedAddress) {
                    setSelectedAddressState(null)
                    localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS)
                    localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ)
                }
            }

            setLoading(false)
        })
        // ponytail: isGuest/cachedAddress/selectedAddress are read once as this-render
        // snapshots (gating UI / one-time stale-cache cleanup), not live reactive state —
        // every path that flips isGuest also updates `profile` (sync or one async hop via
        // loadProfile), which already re-triggers this effect.
        //
        // Deps là 3 field nguyên thuỷ, KHÔNG phải object `profile`: loadProfile chạy vài lần
        // lúc khởi động (finish + onAuthStateChange) và mỗi lần setProfile ra object mới dù
        // dữ liệu y hệt → refetch addresses 4 lần, kéo theo stats RPC (~1.9s) + subscription
        // chạy 4 lần. Chỉ 3 field này ảnh hưởng query bên dưới.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile?.id, profile?.role, profile?.manager_id, hasSession])

    const setSelectedAddress = useCallback((addr) => {
        setSelectedAddressState(addr)
        if (addr) {
            // addr.id is null for "Mẫu mặc định" (admin-only default template) — it isn't a
            // real address, so skip the id-lookup cache key and session tracking for it.
            if (addr.id) localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS, addr.id)
            else localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS)
            localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ, JSON.stringify(addr))
            if (profile?.id && addr.id) {
                upsertSession(profile.id, addr.id)
                localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, profile.id)
            }
        } else {
            localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS)
            localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ)
            localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER_ID)
        }
    }, [profile])

    const createNewAddress = useCallback(async (name) => {
        if (isGuest) throw new Error('Vui lòng đăng ký tài khoản để tạo quán mới!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể tạo địa chỉ')
        const cleanName = (name || '').trim().replace(/\s+/g, ' ')
        if (!cleanName) throw new Error('Tên địa chỉ không được để trống')
        const norm = normalizeName(cleanName)
        if (addresses.some(a => normalizeName(a.name) === norm)) {
            throw new Error(`Địa chỉ "${cleanName}" đã tồn tại`)
        }
        // co-manager creates under main manager's id
        const ownerId = profile.manager_id || profile.id
        const newAddr = await apiCreateAddress(ownerId, cleanName)
        setAddresses(prev => [...prev, newAddr])
        return newAddr
    }, [profile, addresses, isGuest])

    const renameAddress = useCallback(async (addressId, newName) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể sửa địa chỉ')
        const cleanName = (newName || '').trim().replace(/\s+/g, ' ')
        if (!cleanName) throw new Error('Tên địa chỉ không được để trống')
        const norm = normalizeName(cleanName)
        if (addresses.some(a => a.id !== addressId && normalizeName(a.name) === norm)) {
            throw new Error(`Địa chỉ "${cleanName}" đã tồn tại`)
        }
        const updatedAddr = await apiUpdateAddress(addressId, cleanName)
        setAddresses(prev => prev.map(a => a.id === addressId ? updatedAddr : a))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(updatedAddr)
            localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ, JSON.stringify(updatedAddr))
        }
        return updatedAddr
    }, [profile, selectedAddress, addresses, isGuest])

    // Bật/tắt chế độ bàn ngồi lại. Mirror renameAddress: cùng guard quản lý, cùng
    // cách đồng bộ selectedAddress + cache localStorage (POS đọc cờ này từ đó khi
    // cold-start, trước cả khi fetch addresses về).
    const setDineIn = useCallback(async (addressId, dineIn) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể sửa địa chỉ')
        const updatedAddr = await apiSetAddressDineIn(addressId, dineIn)
        setAddresses(prev => prev.map(a => a.id === addressId ? updatedAddr : a))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(updatedAddr)
            localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ, JSON.stringify(updatedAddr))
        }
        return updatedAddr
    }, [profile, selectedAddress, isGuest])

    // Danh sách bàn cố định. Cùng guard/cách đồng bộ như setDineIn ở trên — POS đọc
    // addresses.tables từ cache localStorage nên lưới bàn vẽ được ngay lúc cold-start.
    const setTables = useCallback(async (addressId, tables) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể sửa danh sách bàn')
        const updatedAddr = await apiSetAddressTables(addressId, tables)
        setAddresses(prev => prev.map(a => a.id === addressId ? updatedAddr : a))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(updatedAddr)
            localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ, JSON.stringify(updatedAddr))
        }
        return updatedAddr
    }, [profile, selectedAddress, isGuest])

    // IP máy in ESC/POS (quầy + bếp) cho app native. Cùng guard/cách đồng bộ như
    // setDineIn/setTables ở trên.
    const setPrinters = useCallback(async (addressId, printers) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể sửa địa chỉ')
        const updatedAddr = await apiSetAddressPrinters(addressId, printers)
        setAddresses(prev => prev.map(a => a.id === addressId ? updatedAddr : a))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(updatedAddr)
            localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ, JSON.stringify(updatedAddr))
        }
        return updatedAddr
    }, [profile, selectedAddress, isGuest])

    const removeAddress = useCallback(async (addressId) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể xóa địa chỉ')
        await apiDeleteAddress(addressId)
        setAddresses(prev => prev.filter(a => a.id !== addressId))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(null)
            localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS)
            localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ)
        }
    }, [profile, selectedAddress, isGuest])

    // Kho tổng dùng chung nhiều địa chỉ — 1 địa chỉ chỉ thuộc tối đa 1 nhóm (groupId=null = rời nhóm).
    const createWarehouseGroup = useCallback(async (name) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể tạo nhóm kho tổng')
        const cleanName = (name || '').trim()
        if (!cleanName) throw new Error('Tên nhóm không được để trống')
        const ownerId = profile.manager_id || profile.id
        const groupId = await apiUpsertWarehouseGroup(null, cleanName)
        setWarehouseGroups(prev => [...prev, { id: groupId, manager_id: ownerId, name: cleanName, created_at: new Date().toISOString() }])
        return groupId
    }, [profile, isGuest])

    const renameWarehouseGroup = useCallback(async (groupId, name) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        const cleanName = (name || '').trim()
        if (!cleanName) throw new Error('Tên nhóm không được để trống')
        await apiUpsertWarehouseGroup(groupId, cleanName)
        setWarehouseGroups(prev => prev.map(g => g.id === groupId ? { ...g, name: cleanName } : g))
    }, [isGuest])

    const removeWarehouseGroup = useCallback(async (groupId) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        await apiDeleteWarehouseGroup(groupId)
        setWarehouseGroups(prev => prev.filter(g => g.id !== groupId))
        setAddresses(prev => prev.map(a => a.warehouse_group_id === groupId ? { ...a, warehouse_group_id: null } : a))
    }, [isGuest])

    // groupId=null → rời nhóm, kho tổng của địa chỉ này trở lại độc lập.
    const setAddressGroup = useCallback(async (addressId, groupId) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        await apiSetAddressWarehouseGroup(addressId, groupId ?? null)
        setAddresses(prev => prev.map(a => a.id === addressId ? { ...a, warehouse_group_id: groupId ?? null } : a))
    }, [isGuest])

    // Địa chỉ "anh em" cùng nhóm kho tổng — dùng để hiển thị nhãn "Kho tổng chung với: X, Y".
    const siblingsByAddress = useMemo(() => {
        const map = {}
        for (const addr of addresses) {
            if (!addr.warehouse_group_id) continue
            map[addr.id] = addresses.filter(a => a.id !== addr.id && a.warehouse_group_id === addr.warehouse_group_id)
        }
        return map
    }, [addresses])

    const value = useMemo(() => ({
        addresses,
        selectedAddress,
        setSelectedAddress,
        createNewAddress,
        renameAddress,
        setDineIn,
        setTables,
        setPrinters,
        removeAddress,
        warehouseGroups,
        siblingsByAddress,
        createWarehouseGroup,
        renameWarehouseGroup,
        removeWarehouseGroup,
        setAddressGroup,
        loading,
        fetchError
    }), [addresses, selectedAddress, setSelectedAddress, createNewAddress, renameAddress, setDineIn, setTables, setPrinters, removeAddress, warehouseGroups, siblingsByAddress, createWarehouseGroup, renameWarehouseGroup, removeWarehouseGroup, setAddressGroup, loading, fetchError])

    return (
        <AddressContext.Provider value={value}>
            <Outlet />
        </AddressContext.Provider>
    )
}
