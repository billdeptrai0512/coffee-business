import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchTodayRevenue, fetchTodayCupsSold, fetchInventory, submitOrder, fetchTodayOrders, deleteOrder, fetchTodayExpenses, insertExpense, deleteExpense } from '../services/orderService'
import { useOfflineSync, addPendingOrder } from '../hooks/useOfflineSync'
import { calculateProductCost } from '../utils'
import { useProducts } from './ProductContext'
import { useAddress } from './AddressContext'
import { Outlet } from 'react-router-dom'

const POSContext = createContext(null)

export function usePOS() {
    const ctx = useContext(POSContext)
    if (!ctx) throw new Error('usePOS must be used within POSProvider')
    return ctx
}

export function POSProvider() {
    const { recipes, ingredientCosts } = useProducts()
    const { selectedAddress } = useAddress()
    const addressId = selectedAddress?.id

    // ---- Persisted State ----
    const loadLocalJSON = (key, fallback) => {
        try { const val = localStorage.getItem(key); return val ? JSON.parse(val) : fallback }
        catch { return fallback }
    }

    const [cart, setCart] = useState(() => loadLocalJSON('pos_cart', []))
    const [activeCartItemId, setActiveCartItemId] = useState(null)
    const [revenue, setRevenue] = useState(() => Number(localStorage.getItem('pos_revenue')) || 0)
    const [totalCost, setTotalCost] = useState(() => Number(localStorage.getItem('pos_total_cost')) || 0)
    const [cupsSold, setCupsSold] = useState(() => Number(localStorage.getItem('pos_cups')) || 0)
    const [inventory, setInventory] = useState(() => loadLocalJSON('pos_inventory', {}))
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [toast, setToast] = useState(null)
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const toastTimer = useRef(null)

    // ---- History State ----
    const [todayOrders, setTodayOrders] = useState([])
    const [todayExpenses, setTodayExpenses] = useState([])
    const [isLoadingHistory, setIsLoadingHistory] = useState(false)

    // ---- Toast helper ----
    function showToast(message, type = 'info') {
        if (toastTimer.current) clearTimeout(toastTimer.current)
        setToast({ message, type })
        toastTimer.current = setTimeout(() => setToast(null), 3000)
    }

    // ---- Offline sync ----
    const handleSyncComplete = useCallback(() => {
        if (!addressId) return
        fetchTodayRevenue(addressId).then(setRevenue)
        fetchTodayCupsSold(addressId).then(setCupsSold)
        fetchInventory().then(setInventory)
        showToast('Đã đồng bộ đơn hàng offline!', 'success')
    }, [addressId])

    const { getPendingCount } = useOfflineSync(handleSyncComplete)

    // ---- Load data when address changes ----
    useEffect(() => {
        if (!addressId) return

        async function load() {
            try {
                const [rev, inv, cups] = await Promise.all([
                    fetchTodayRevenue(addressId),
                    fetchInventory(),
                    fetchTodayCupsSold(addressId),
                ])
                if (supabase) {
                    setRevenue(rev)
                    setInventory(inv)
                    setCupsSold(cups)
                } else {
                    setInventory(prev => Object.keys(prev).length ? prev : inv)
                }
            } catch (error) {
                console.error('Failed to load POS data', error)
            }
        }
        load()
    }, [addressId])

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
            const storedDate = localStorage.getItem('pos_current_date')
            const todayStr = new Date().toDateString()
            if (storedDate && storedDate !== todayStr) {
                if (navigator.onLine && supabase && addressId) {
                    fetchTodayRevenue(addressId).then(setRevenue)
                    fetchTodayCupsSold(addressId).then(setCupsSold)
                    setTotalCost(0)
                    showToast('Đã qua ngày mới, dữ liệu đã được làm mới!', 'info')
                } else {
                    setRevenue(0)
                    setCupsSold(0)
                    setTotalCost(0)
                }
                localStorage.setItem('pos_current_date', todayStr)
            } else if (!storedDate) {
                localStorage.setItem('pos_current_date', todayStr)
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
    }, [addressId])

    // ---- Supabase realtime subscriptions ----
    useEffect(() => {
        if (!supabase || !addressId) return

        const ordersChannel = supabase
            .channel(`orders-realtime-${addressId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
                // Only react to orders for this address
                if (payload.new?.address_id === addressId) {
                    fetchTodayRevenue(addressId).then(setRevenue)
                    fetchTodayCupsSold(addressId).then(setCupsSold)
                }
            })
            .subscribe()

        const expensesChannel = supabase
            .channel(`expenses-realtime-${addressId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, (payload) => {
                if (payload.new?.address_id === addressId || payload.old?.address_id === addressId) {
                    if (document.visibilityState === 'visible') {
                        // Optimistically could refetch totalCost if we tracked it from DB, 
                        // but totalCost is derived from orders + expenses. We'll simply let it update on load history.
                        // Actually, to keep dashboard cost synced when other devices add expenses:
                        fetchTodayExpenses(addressId).then(expenses => {
                            setTodayExpenses(expenses)
                        })
                    }
                }
            })
            .subscribe()

        return () => {
            supabase.removeChannel(ordersChannel)
            supabase.removeChannel(expensesChannel)
        }
    }, [addressId])

    // ---- Autosave Daemon ----
    useEffect(() => {
        localStorage.setItem('pos_cart', JSON.stringify(cart))
        localStorage.setItem('pos_revenue', revenue.toString())
        localStorage.setItem('pos_total_cost', totalCost.toString())
        localStorage.setItem('pos_cups', cupsSold.toString())
        localStorage.setItem('pos_inventory', JSON.stringify(inventory))
    }, [cart, revenue, totalCost, cupsSold, inventory])

    // ---- Derived values ----
    const total = cart.reduce((sum, item) => {
        const extrasPrice = item.extras.reduce((extraSum, ex) => extraSum + ex.price, 0)
        return sum + (item.basePrice + extrasPrice) * item.quantity
    }, 0)

    const orderCount = cart.reduce((sum, item) => sum + item.quantity, 0)
    const hasOrder = cart.length > 0

    // ---- Handlers ----
    function handleAddItem(product) {
        const cartItemId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2, 9)
        setCart(prev => [...prev, {
            cartItemId,
            productId: product.id,
            name: product.name,
            basePrice: product.price,
            quantity: 1,
            extras: []
        }])
        setActiveCartItemId(cartItemId)
    }

    function handleRemoveCartItem(cartItemId) {
        setCart(prev => prev.filter(item => item.cartItemId !== cartItemId))
    }

    function handleToggleExtra(extra) {
        setCart(prev => {
            if (prev.length === 0) return prev
            let targetIndex = prev.findIndex(item => item.cartItemId === activeCartItemId)
            if (targetIndex === -1) targetIndex = prev.length - 1

            const next = [...prev]
            const targetItem = next[targetIndex]
            const hasExtra = targetItem.extras.some(e => e.id === extra.id)
            const newExtras = hasExtra ? targetItem.extras.filter(e => e.id !== extra.id) : [...targetItem.extras, extra]

            next[targetIndex] = { ...targetItem, extras: newExtras }
            return next
        })
    }

    async function handleConfirm() {
        if (cart.length === 0 || isSubmitting) return
        setIsSubmitting(true)

        const cartCost = cart.reduce((sum, item) => {
            const costPerItem = calculateProductCost(item.productId, recipes, ingredientCosts)
            return sum + (costPerItem * item.quantity)
        }, 0)

        try {
            if (navigator.onLine && supabase) {
                await submitOrder(cart, total, null, addressId)
                const [rev, cups] = await Promise.all([fetchTodayRevenue(addressId), fetchTodayCupsSold(addressId)])
                setRevenue(rev)
                setTotalCost(prev => prev + cartCost)
                setCupsSold(cups)
                showToast('Tạo thành công', 'success')
            } else {
                addPendingOrder(cart, total)
                setRevenue(prev => prev + total)
                setTotalCost(prev => prev + cartCost)
                setCupsSold(prev => prev + orderCount)
                showToast(`Lưu offline (${getPendingCount()} đơn chờ)`, 'warning')
            }
            setCart([])
            setActiveCartItemId(null)
        } catch (err) {
            console.error('Submit error:', err)
            addPendingOrder(cart, total)
            setRevenue(prev => prev + total)
            setTotalCost(prev => prev + cartCost)
            setCupsSold(prev => prev + orderCount)
            showToast('Lỗi mạng – đã lưu offline', 'warning')
            setCart([])
            setActiveCartItemId(null)
        } finally {
            setIsSubmitting(false)
        }
    }

    async function handleLoadHistory() {
        if (!addressId) return
        setIsLoadingHistory(true)
        try {
            const [orders, expenses] = await Promise.all([
                fetchTodayOrders(addressId),
                fetchTodayExpenses(addressId)
            ])
            setTodayOrders(orders)
            setTodayExpenses(expenses)
        } catch (err) {
            console.error(err)
        } finally {
            setIsLoadingHistory(false)
        }
    }

    async function handleDeleteOrder(orderId) {
        try {
            await deleteOrder(orderId)
            setTodayOrders(prev => prev.filter(o => o.id !== orderId))
            if (addressId) {
                const [rev, cups] = await Promise.all([fetchTodayRevenue(addressId), fetchTodayCupsSold(addressId)])
                setRevenue(rev)
                setCupsSold(cups)
            }
            showToast('Đã xóa đơn hàng', 'success')
        } catch (err) {
            console.error('Delete order error:', err)
            showToast('Lỗi khi xóa đơn hàng', 'warning')
        }
    }

    async function handleAddExpense(name, amount) {
        if (!addressId) return
        try {
            const expense = await insertExpense(name, amount, addressId)
            setTodayExpenses(prev => [expense, ...prev])
            setTotalCost(prev => prev + amount)
            showToast('Đã thêm chi phí', 'success')
            return expense
        } catch (err) {
            console.error('Add expense error:', err)
            showToast('Lỗi mạng khi thêm chi phí', 'danger')
            throw err
        }
    }

    async function handleDeleteExpense(expenseId, amount) {
        try {
            await deleteExpense(expenseId)
            setTodayExpenses(prev => prev.filter(e => e.id !== expenseId))
            setTotalCost(prev => Math.max(0, prev - amount))
            showToast('Đã xóa chi phí', 'success')
        } catch (err) {
            console.error('Delete expense error:', err)
            showToast('Lỗi khi xóa chi phí', 'warning')
        }
    }

    return (
        <POSContext.Provider value={{
            // Cart
            cart, activeCartItemId, setActiveCartItemId,
            handleAddItem, handleRemoveCartItem, handleToggleExtra, handleConfirm,
            total, orderCount, hasOrder, isSubmitting,
            // Dashboard
            revenue, totalCost, cupsSold, inventory, isOnline,
            // History
            todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, handleDeleteOrder, handleAddExpense, handleDeleteExpense,
            // Toast
            toast, showToast,
        }}>
            <Outlet />
        </POSContext.Provider>
    )
}
