import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { fetchProducts, fetchTodayRevenue, fetchInventory, submitOrder, fetchAllRecipes, fetchTodayCupsSold, fetchTodayOrders } from './services/orderService'
import { useOfflineSync, addPendingOrder, getPendingOrders } from './hooks/useOfflineSync'
import './index.css'

// Format VND currency
function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

// Quick Extras (UUID formatted for safe DB parsing)
const QUICK_EXTRAS = [
  { id: '22222222-2222-2222-2222-222222222201', name: 'Lớn', price: 6000 },
  { id: '22222222-2222-2222-2222-222222222202', name: 'Ít đá', price: 0 },
  { id: '22222222-2222-2222-2222-222222222203', name: 'Không đá', price: 0 },
  { id: '22222222-2222-2222-2222-222222222204', name: 'Ít ngọt', price: 0 },
  { id: '22222222-2222-2222-2222-222222222205', name: 'Ngọt', price: 0 },
]

// Ingredient display names for warnings
const INGREDIENT_NAMES = {
  coffee_g: 'Cà phê',
  condensed_milk_ml: 'Sữa đặc',
  fresh_milk_ml: 'Sữa tươi',
  tea_bag: 'Trà',
  peach_syrup_ml: 'Syrup đào',
  lychee_syrup_ml: 'Syrup vải',
  orange: 'Cam',
  cup: 'Ly',
  lid: 'Nắp',
}

// Low stock threshold per ingredient
const LOW_STOCK_THRESHOLD = {
  coffee_g: 100,
  condensed_milk_ml: 200,
  fresh_milk_ml: 300,
  tea_bag: 10,
  peach_syrup_ml: 200,
  lychee_syrup_ml: 200,
  orange: 5,
  cup: 20,
  lid: 20,
}

export default function App() {
  // ---- Persisted State ----
  const [products, setProducts] = useState([])

  // Safe JSON parse helper for localStorage hydration
  const loadLocalJSON = (key, fallback) => {
    try { const val = localStorage.getItem(key); return val ? JSON.parse(val) : fallback }
    catch { return fallback }
  }

  const [cart, setCart] = useState(() => loadLocalJSON('pos_cart', []))
  const [activeCartItemId, setActiveCartItemId] = useState(null)

  const [revenue, setRevenue] = useState(() => Number(localStorage.getItem('pos_revenue')) || 0)
  const [cupsSold, setCupsSold] = useState(() => Number(localStorage.getItem('pos_cups')) || 0)
  const [inventory, setInventory] = useState(() => loadLocalJSON('pos_inventory', {}))
  const [recipes, setRecipes] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const toastTimer = useRef(null)

  // ---- History View State ----
  const [currentView, setCurrentView] = useState('pos')
  const [todayOrders, setTodayOrders] = useState([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  // ---- Offline sync ----
  const handleSyncComplete = useCallback(() => {
    fetchTodayRevenue().then(setRevenue)
    fetchTodayCupsSold().then(setCupsSold)
    fetchInventory().then(setInventory)
    showToast('Đã đồng bộ đơn hàng offline!', 'success')
  }, [])

  const { getPendingCount } = useOfflineSync(handleSyncComplete)

  // ---- Toast helper ----
  function showToast(message, type = 'info') {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, type })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // ---- Load data on mount ----
  useEffect(() => {
    async function load() {
      try {
        const [prods, rev, inv, recs, cups] = await Promise.all([
          fetchProducts(),
          fetchTodayRevenue(),
          fetchInventory(),
          fetchAllRecipes(),
          fetchTodayCupsSold()
        ])
        setProducts(prods)
        setRecipes(recs)

        // If Supabase is connected, the server is the absolute source of truth
        if (supabase) {
          setRevenue(rev)
          setInventory(inv)
          setCupsSold(cups)
        } else {
          // In pure offline/demo mode, respect what was loaded from localStorage.
          // Only seed inventory if it's completely empty.
          setInventory(prev => Object.keys(prev).length ? prev : inv)
        }
      } catch (error) {
        console.error("Failed to load initial data", error)
      }
    }
    load()
  }, [])

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

  // ---- Supabase realtime subscriptions ----
  useEffect(() => {
    if (!supabase) return

    const ordersChannel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        fetchTodayRevenue().then(setRevenue)
        fetchTodayCupsSold().then(setCupsSold)
      })
      .subscribe()

    // const inventoryChannel = ... (Disabled for now)

    return () => {
      supabase.removeChannel(ordersChannel)
      // supabase.removeChannel(inventoryChannel)
    }
  }, [])

  // ---- Autosave Daemon ----
  useEffect(() => {
    localStorage.setItem('pos_cart', JSON.stringify(cart))
    localStorage.setItem('pos_revenue', revenue.toString())
    localStorage.setItem('pos_cups', cupsSold.toString())
    localStorage.setItem('pos_inventory', JSON.stringify(inventory))
  }, [cart, revenue, cupsSold, inventory])

  // ---- Order helpers ----
  const total = cart.reduce((sum, item) => {
    const extrasPrice = item.extras.reduce((extraSum, ex) => extraSum + ex.price, 0)
    return sum + (item.basePrice + extrasPrice) * item.quantity
  }, 0)

  const orderCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const hasOrder = cart.length > 0

  // ---- Low stock warnings ----
  const lowStockItems = Object.entries(inventory)
    .filter(([ingredient, stock]) => {
      const threshold = LOW_STOCK_THRESHOLD[ingredient] || 10
      return stock <= threshold && stock > 0
    })
    .map(([ingredient]) => INGREDIENT_NAMES[ingredient] || ingredient)

  const outOfStockItems = Object.entries(inventory)
    .filter(([, stock]) => stock <= 0)
    .map(([ingredient]) => INGREDIENT_NAMES[ingredient] || ingredient)

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

  function handleDecreaseItem(productId) {
    setCart(prev => {
      const lastIndex = [...prev].reverse().findIndex(item => item.productId === productId)
      if (lastIndex === -1) return prev

      const realIndex = prev.length - 1 - lastIndex
      const next = [...prev]
      if (next[realIndex].quantity > 1) {
        next[realIndex] = { ...next[realIndex], quantity: next[realIndex].quantity - 1 }
      } else {
        next.splice(realIndex, 1)
      }
      return next
    })
  }

  function handleRemoveCartItem(cartItemId) {
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId))
  }

  function handleToggleExtra(extra) {
    setCart(prev => {
      if (prev.length === 0) return prev
      let targetIndex = prev.findIndex(item => item.cartItemId === activeCartItemId)
      if (targetIndex === -1) targetIndex = prev.length - 1 // Fallback

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

    try {
      if (navigator.onLine && supabase) {
        await submitOrder(cart, total)
        setRevenue(prev => prev + total)
        setCupsSold(prev => prev + orderCount)
        showToast(`Tạo thành công`, 'success')
      } else {
        addPendingOrder(cart, total)
        setRevenue(prev => prev + total)
        setCupsSold(prev => prev + orderCount)
        showToast(`Lưu offline (${getPendingCount()} đơn chờ)`, 'warning')
      }
      setCart([])
      setActiveCartItemId(null)
    } catch (err) {
      console.error('Submit error:', err)
      addPendingOrder(cart, total)
      showToast('Lỗi mạng – đã lưu offline', 'warning')
      setCart([])
      setActiveCartItemId(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ---- History View Handlers ----
  async function handleOpenHistory() {
    setCurrentView('history')
    setIsLoadingHistory(true)
    try {
      const orders = await fetchTodayOrders()
      setTodayOrders(orders)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // ---- Render History View ----
  function renderHistoryView() {
    const formattedOnline = todayOrders.map(o => ({
      id: o.id,
      total: o.total,
      createdAt: o.created_at,
      isOffline: false,
      itemsText: o.order_items ? o.order_items.map(i => `${i.quantity} ${i.products?.name}${i.options ? ` (${i.options})` : ''}`).join(', ') : ''
    }))

    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const formattedOffline = pending
      .filter(o => new Date(o.createdAt).toDateString() === todayStr)
      .map((o, idx) => ({
        id: `offline-${idx}`,
        total: o.total,
        createdAt: o.createdAt,
        isOffline: true,
        itemsText: o.cart
          ? o.cart.map(i => `${i.quantity} ${i.name}${i.extras.length ? ` (${i.extras.map(e => e.name).join(', ')})` : ''}`).join(', ')
          : o.orderItems ? o.orderItems.map(i => `${i.quantity} ${i.name}`).join(', ') : ''
      }))

    const allOrders = [...formattedOnline, ...formattedOffline].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    return (
      <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-3">
          <button
            onClick={() => setCurrentView('pos')}
            className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
          >
            <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
          </button>
          <div className="flex flex-col">
            <h1 className="text-[19px] font-black text-text tracking-tight leading-none mb-1">Đơn Trong Ngày</h1>
            <span className="text-[12px] font-bold text-text-secondary uppercase">{allOrders.length} đơn</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 space-y-3 bg-bg">
          {isLoadingHistory ? (
            <div className="flex justify-center py-10">
              <span className="text-text-secondary font-medium">Đang tải...</span>
            </div>
          ) : allOrders.length === 0 ? (
            <div className="flex justify-center py-10">
              <span className="text-text-secondary font-medium">Chưa có đơn hàng nào hôm nay.</span>
            </div>
          ) : (
            allOrders.map(order => {
              const date = new Date(order.createdAt)
              const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`

              return (
                <div key={order.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden">
                  {order.isOffline && (
                    <div className="absolute top-0 right-0 bg-warning/20 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                      Offline
                    </div>
                  )}
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-text font-black text-[18px] text-primary">{formatVND(order.total)}</span>
                    <span className="text-text-secondary text-[13px] font-bold">{time}</span>
                  </div>
                  <div className="text-text text-[14px] leading-snug font-medium border-t border-border/40 pt-2">
                    {order.itemsText || 'Không có chi tiết'}
                  </div>
                </div>
              )
            })
          )}
        </main>
      </div>
    )
  }

  // ---- Render ----

  // ---- Format Date ----
  const days = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
  const today = new Date()
  const dayName = days[today.getDay()]
  const dateOnly = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`

  if (currentView === 'history') {
    return renderHistoryView()
  }

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
      {/* ===== HEADER ===== */}
      <header className="shrink-0 pt-6 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
        <div className="px-6 grid grid-cols-2 gap-3 mb-1">
          {/* Card 1: Date & Status */}
          <div className="bg-bg rounded-[20px] p-3.5 sm:p-4 border border-border/60 shadow-sm flex flex-col justify-center gap-1.5 sm:gap-2 relative overflow-hidden h-full">
            <div className="flex flex-col justify-between items-start gap-0.5 relative z-10">
              <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">{dayName}</span>
              <span className="text-[15px] sm:text-[16px] text-text font-black tracking-tight">{dateOnly}</span>
            </div>
            <div className="w-full h-[1px] bg-border/60 rounded-full relative z-10"></div>
            <div className="flex flex-col justify-between items-start gap-0.5 relative z-10">
              <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Trạng thái</span>
              <div className="flex items-center gap-1.5 mt-[1px]">
                <span className={`w-2 h-2 rounded-full shadow-sm ${isOnline ? 'bg-success shadow-success/40' : 'bg-danger shadow-danger/40'}`} />
                <span className="text-[14px] sm:text-[15px] text-text font-black tracking-tight leading-none mb-[1px]">{isOnline ? 'Online' : 'Offline'}</span>
              </div>
            </div>
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
          </div>

          {/* Card 2: Revenue / Cups */}
          <div
            onClick={handleOpenHistory}
            role="button"
            tabIndex={0}
            className="cursor-pointer bg-primary/5 rounded-[20px] p-3.5 sm:p-4 border border-primary/10 shadow-sm flex flex-col justify-center gap-1.5 sm:gap-2 relative overflow-hidden h-full hover:bg-primary/10 active:bg-primary/15 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <div className="flex flex-row justify-between items-center gap-0.5 relative z-10">
              <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Đã bán</span>
              <span className="text-[16px] sm:text-[17px] pb-1 text-text font-black tracking-tight flex items-baseline gap-1">{cupsSold} <span className="text-[12px] sm:text-[13px] font-extrabold text-text-dim">ly</span></span>
            </div>
            <div className="w-full h-[1px] bg-primary/15 rounded-full relative z-10"></div>
            <div className="flex flex-col justify-between items-center gap-1 relative z-10">
              <span className="text-[13px] sm:text-[14px] text-text-secondary font-bold uppercase tracking-wider">Doanh thu</span>
              <span className="text-[17px] sm:text-[18px] text-primary font-black tracking-tight align-right">{formatVND(revenue)}</span>
            </div>
            <div className="absolute bottom-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl -mr-10 -mb-10 pointer-events-none" />
          </div>
        </div>
      </header>

      {/* ===== LOW STOCK WARNINGS ===== */}
      {(lowStockItems.length > 0 || outOfStockItems.length > 0) && (
        <div className="px-6 pt-5 pb-2 shrink-0 space-y-2">
          {outOfStockItems.length > 0 && (
            <div className="flex items-center gap-2.5 bg-danger-soft rounded-2xl px-4 py-3 border border-danger/20 shadow-sm">
              <span className="text-sm">⛔</span>
              <span className="text-xs text-danger font-bold">
                Hết: {outOfStockItems.join(', ')}
              </span>
            </div>
          )}
          {lowStockItems.length > 0 && (
            <div className="flex items-center gap-2.5 bg-warning-soft rounded-2xl px-4 py-3 border border-warning/20 shadow-sm">
              <span className="text-sm">⚠️</span>
              <span className="text-xs text-warning font-bold">
                Sắp hết: {lowStockItems.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-6 pb-6 pt-5">
        {/* ---- Menu Grid ---- */}
        <div className="grid grid-cols-2 gap-4 pt-1">
          {products.map(product => {
            const qty = cart.filter(item => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0)
            return (
              <div
                key={product.id}
                id={`menu-${product.id}`}
                role="button"
                tabIndex={0}
                aria-pressed={qty > 0}
                aria-label={`Thêm ${product.name}`}
                onClick={() => handleAddItem(product)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleAddItem(product);
                  }
                }}
                className={`menu-btn relative rounded-[1.5rem] p-4.5 sm:p-5 text-left min-h-[140px] flex flex-col justify-between border cursor-pointer transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-primary/30 ${qty > 0
                  ? 'bg-gradient-to-br from-primary/15 to-primary/5 border-primary/40 shadow-[0_8px_24px_var(--color-primary-glow)] ring-1 ring-primary/20'
                  : 'bg-surface border-border/60 shadow-sm hover:border-text/30 hover:shadow-md hover:bg-surface-hover'
                  }`}
              >
                {/* Glow Effect */}
                {qty > 0 && <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />}

                {/* Top: Name & Qty */}
                <div className="relative z-10 w-full">
                  <h3 className={`font-black text-[18px] sm:text-[19px] leading-tight break-words pt-0.25 ${qty > 0 ? 'text-primary drop-shadow-sm' : 'text-text'}`}>
                    {product.name}
                  </h3>

                </div>

                {/* Bottom: Price & Minus */}
                <div className="flex items-end justify-between mt-6 relative z-10 w-full gap-2">
                  <span className={`font-extrabold text-[15px] pb-1 ${qty > 0 ? 'text-primary/90' : 'text-text-secondary'}`}>
                    {formatVND(product.price)}
                  </span>
                  {qty > 0 && (
                    <span className="badge-pop absolute -top-1.5 -right-1 bg-text text-bg text-[14px] font-black w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-primary/10" aria-hidden="true">
                      {qty}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* ===== MINI CART ===== */}
      {cart.length > 0 && (
        <div className="shrink-0 bg-surface border-t border-border/80 p-4 max-h-[30vh] overflow-y-auto">
          <div className="flex flex-col gap-2">
            {cart.map(item => {
              const extrasPrice = item.extras.reduce((sum, e) => sum + e.price, 0)
              const itemTotal = (item.basePrice + extrasPrice) * item.quantity
              const isActive = item.cartItemId === activeCartItemId || (!activeCartItemId && item === cart[cart.length - 1])

              return (
                <div
                  key={item.cartItemId}
                  onClick={() => setActiveCartItemId(item.cartItemId)}
                  className={`flex items-start justify-between p-3 rounded-2xl border cursor-pointer transition-colors ${isActive ? 'border-primary/50 bg-primary/5 shadow-sm' : 'border-border/60 bg-bg hover:bg-surface-hover'}`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-text text-[15px]">{item.name}</span>
                    {item.extras.length > 0 && (
                      <span className="text-primary font-bold text-[13px]">{item.extras.map(e => e.name).join(', ')}</span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-black text-text text-[15px]">{formatVND(itemTotal)}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleRemoveCartItem(item.cartItemId); }} className="text-text-secondary hover:text-danger text-[13px] font-bold uppercase tracking-wider px-2 py-1 -mr-2 focus:outline-none">Xóa</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== FOOTER ===== */}
      <footer className="shrink-0 bg-surface border-t border-border/80 shadow-[0_-4px_24px_rgba(0,0,0,0.02)] flex flex-col">

        {/* Quick Extras Bar */}
        {cart.length > 0 && (
          <div className="w-full overflow-x-auto py-3 px-6 flex gap-2.5 items-center hide-scrollbar border-b border-border/40">
            {QUICK_EXTRAS.map(ex => {
              const activeItem = cart.find(item => item.cartItemId === activeCartItemId) || cart[cart.length - 1]
              const hasExtra = activeItem?.extras.some(e => e.id === ex.id) || false

              if (!hasExtra) {
                return (
                  <button
                    key={ex.id}
                    onClick={() => handleToggleExtra(ex)}
                    className="shrink-0 h-[42px] px-4 rounded-[14px] border bg-surface-light border-border/80 text-text-secondary hover:text-text font-bold text-[14px] whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all shadow-sm"
                  >
                    {ex.name}
                  </button>
                )
              }

              return (
                <button
                  key={ex.id}
                  onClick={() => handleToggleExtra(ex)}
                  className="shrink-0 flex items-center gap-1.5 h-[42px] px-4 rounded-[14px] border bg-primary/10 border-primary/50 text-primary font-bold text-[14px] whitespace-nowrap focus:outline-none shadow-sm backdrop-blur-sm active:bg-primary/20"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mb-[1px]"></span>
                  {ex.name}
                </button>
              )
            })}
          </div>
        )}

        <div className="px-6 pt-4 pb-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-text-secondary text-sm font-bold uppercase tracking-wider">Tổng cộng</span>
            <span className="text-text font-black text-2xl tabular-nums tracking-tight">
              {formatVND(total)}
            </span>
          </div>
          <button
            id="confirm-order"
            onClick={handleConfirm}
            disabled={!hasOrder || isSubmitting}
            className={`w-full p-4 font-bold text-[18px] tracking-tight transition-all duration-75 flex items-center justify-center gap-2 ${!hasOrder || isSubmitting
              ? 'bg-surface-light text-text-dim cursor-not-allowed border border-border/50'
              : 'bg-primary text-bg active:bg-primary-hover shadow-[0_8px_32px_var(--color-primary-glow)] hover:-translate-y-0.5'
              }`}
          >
            {isSubmitting ? 'Đang tạo đơn...' : 'Tạo đơn'}
          </button>
        </div>
        {/* Safe area padding for notched phones */}
        <div className="h-[env(safe-area-inset-bottom,12px)]" />
      </footer>

      {/* ===== TOAST ===== */}
      {toast && (
        <div className={`toast-in fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl text-[13px] font-semibold shadow-2xl max-w-[90vw] text-center border backdrop-blur-sm ${toast.type === 'success'
          ? 'bg-success-soft text-success border-success/20'
          : toast.type === 'error'
            ? 'bg-danger-soft text-danger border-danger/20'
            : toast.type === 'warning'
              ? 'bg-warning-soft text-warning border-warning/20'
              : 'bg-surface text-text border-border/40'
          }`}>
          {toast.type === 'success' && '✓ '}
          {toast.type === 'error' && '✕ '}
          {toast.type === 'warning' && '⚡ '}
          {toast.message}
        </div>
      )}
    </div>
  )
}
