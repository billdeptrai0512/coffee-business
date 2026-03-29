import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { fetchProducts, fetchTodayRevenue, fetchInventory, submitOrder, fetchRecipes, fetchAllRecipes, fetchTodayCupsSold } from './services/orderService'
import { useOfflineSync, addPendingOrder } from './hooks/useOfflineSync'
import './index.css'
import { WalletSVG, DrinkSVG } from './components/icons'

// Format VND currency
function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

// Quick Extras (UUID formatted for safe DB parsing)
const QUICK_EXTRAS = [
  { id: '22222222-2222-2222-2222-222222222201', name: 'Size lớn', price: 6000 },
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

  const [order, setOrder] = useState(() => loadLocalJSON('pos_order', {}))
  const [extras, setExtras] = useState(() => loadLocalJSON('pos_extras', {}))
  const [revenue, setRevenue] = useState(() => Number(localStorage.getItem('pos_revenue')) || 0)
  const [cupsSold, setCupsSold] = useState(() => Number(localStorage.getItem('pos_cups')) || 0)
  const [inventory, setInventory] = useState(() => loadLocalJSON('pos_inventory', {}))
  const [recipes, setRecipes] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const toastTimer = useRef(null)

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
    localStorage.setItem('pos_order', JSON.stringify(order))
    localStorage.setItem('pos_extras', JSON.stringify(extras))
    localStorage.setItem('pos_revenue', revenue.toString())
    localStorage.setItem('pos_cups', cupsSold.toString())
    localStorage.setItem('pos_inventory', JSON.stringify(inventory))
  }, [order, extras, revenue, cupsSold, inventory])

  // ---- Order helpers ----
  const baseItems = Object.entries(order)
    .filter(([, qty]) => qty > 0)
    .map(([productId, quantity]) => {
      const product = products.find(p => p.id === productId)
      return product ? { productId, quantity, name: product.name, price: product.price } : null
    })
    .filter(Boolean)

  const extraItems = Object.entries(extras)
    .filter(([, qty]) => qty > 0)
    .map(([id, quantity]) => {
      const extra = QUICK_EXTRAS.find(e => e.id === id)
      return extra ? { productId: extra.id, quantity, name: extra.name, price: extra.price, isExtra: true } : null
    })
    .filter(Boolean)

  const orderItems = [...baseItems, ...extraItems]

  const total = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const orderCount = baseItems.reduce((sum, item) => sum + item.quantity, 0)

  // ---- Check if ingredient stock is sufficient ----
  function checkStockSufficiency(itemsToCheck) {
    return [] // Disabled for now
  }

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
  function handleAddItem(productId) {
    setOrder(prev => ({
      ...prev,
      [productId]: (prev[productId] || 0) + 1,
    }))
  }

  function handleDecreaseItem(productId) {
    setOrder(prev => {
      const newQty = (prev[productId] || 0) - 1
      if (newQty <= 0) {
        const next = { ...prev }
        delete next[productId]
        return next
      }
      return { ...prev, [productId]: newQty }
    })
  }

  async function handleConfirm() {
    if (orderItems.length === 0 || isSubmitting) return

    const insufficient = checkStockSufficiency(orderItems)
    if (insufficient.length > 0) {
      showToast(`Không đủ: ${insufficient.join(', ')}`, 'error')
      return
    }

    setIsSubmitting(true)

    try {
      if (navigator.onLine && supabase) {
        await submitOrder(orderItems, total)
        setRevenue(prev => prev + total)
        setCupsSold(prev => prev + orderCount)
        showToast(`Tạo thành công`, 'success')
      } else {
        addPendingOrder(orderItems, total)
        setRevenue(prev => prev + total)
        setCupsSold(prev => prev + orderCount)
        showToast(`Lưu offline (${getPendingCount()} đơn chờ)`, 'warning')
      }
      setOrder({})
      setExtras({})
    } catch (err) {
      console.error('Submit error:', err)
      addPendingOrder(orderItems, total)
      showToast('Lỗi mạng – đã lưu offline', 'warning')
      setOrder({})
      setExtras({})
    } finally {
      setIsSubmitting(false)
    }
  }

  // ---- Render ----
  const pendingCount = getPendingCount()
  const hasOrder = orderItems.length > 0

  // ---- Format Date ----
  const days = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
  const today = new Date()
  const dayName = days[today.getDay()]
  const dateOnly = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`

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
          <div className="bg-primary/5 rounded-[20px] p-3.5 sm:p-4 border border-primary/10 shadow-sm flex flex-col justify-center gap-1.5 sm:gap-2 relative overflow-hidden h-full">
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
            const qty = order[product.id] || 0
            return (
              <div
                key={product.id}
                id={`menu-${product.id}`}
                role="button"
                tabIndex={0}
                aria-pressed={qty > 0}
                aria-label={`Thêm ${product.name}`}
                onClick={() => handleAddItem(product.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleAddItem(product.id);
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
                  <h3 className={`font-black text-[18px] sm:text-[19px] leading-tight break-words pt-1 pr-7 ${qty > 0 ? 'text-primary drop-shadow-sm' : 'text-text'}`}>
                    {product.name}
                  </h3>
                  {qty > 0 && (
                    <span className="badge-pop absolute -top-1.5 -right-1 bg-text text-bg text-[14px] font-black w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-primary/10" aria-hidden="true">
                      {qty}
                    </span>
                  )}
                </div>

                {/* Bottom: Price & Minus */}
                <div className="flex items-end justify-between mt-6 relative z-10 w-full gap-2">
                  <span className={`font-extrabold text-[15px] pb-1 ${qty > 0 ? 'text-primary/90' : 'text-text-secondary'}`}>
                    {formatVND(product.price)}
                  </span>
                  {qty > 0 && (
                    <button
                      id={`minus-${product.id}`}
                      aria-label={`Giảm số lượng ${product.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDecreaseItem(product.id)
                      }}
                      className="shrink-0 w-[40px] h-[40px] rounded-[14px] bg-surface/90 backdrop-blur-md border border-danger/30 flex items-center justify-center hover:bg-danger/10 active:bg-danger/20 shadow-sm transition-all z-20 -mb-1 -mr-1 focus:outline-none focus:ring-2 focus:ring-danger/40"
                    >
                      <span className="text-danger text-[24px] font-medium leading-none mb-[2px] pointer-events-none">−</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* ===== FOOTER ===== */}
      <footer className="shrink-0 bg-surface border-t border-border/80 shadow-[0_-4px_24px_rgba(0,0,0,0.02)] flex flex-col">

        {/* Quick Extras Bar */}
        {(baseItems.length > 0 || extraItems.length > 0) && (
          <div className="w-full overflow-x-auto py-3 px-6 flex gap-2.5 items-center hide-scrollbar border-b border-border/40">
            {QUICK_EXTRAS.map(ex => {
              const qty = extras[ex.id] || 0

              if (qty === 0) {
                return (
                  <button
                    key={ex.id}
                    onClick={() => setExtras(prev => ({ ...prev, [ex.id]: 1 }))}
                    className="shrink-0 h-[42px] px-4 rounded-[14px] border bg-surface-light border-border/80 text-text-secondary hover:text-text font-bold text-[14px] whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all shadow-sm"
                  >
                    {ex.name} {ex.price > 0 ? `+${ex.price / 1000}k` : ''}
                  </button>
                )
              }

              return (
                <div key={ex.id} className="shrink-0 flex items-center h-[42px] rounded-[14px] border bg-primary/10 border-primary/50 text-primary overflow-hidden shadow-sm backdrop-blur-sm">
                  <button
                    onClick={() => setExtras(prev => {
                      const next = { ...prev }
                      if (next[ex.id] > 1) {
                        next[ex.id] -= 1
                      } else {
                        delete next[ex.id]
                      }
                      return next
                    })}
                    className="w-11 h-full flex items-center justify-center font-bold text-[22px] active:bg-primary/20"
                  >
                    −
                  </button>
                  <span className="font-extrabold text-[13px] px-0.5 whitespace-nowrap flex items-center tracking-tight">
                    {ex.name} <span className="flex items-center justify-center text-bg bg-primary font-black text-[12px] h-[20px] min-w-[20px] px-1.5 rounded-full ml-1.5 shadow-sm leading-none">{qty}</span>
                  </span>
                  <button
                    onClick={() => setExtras(prev => ({ ...prev, [ex.id]: (prev[ex.id] || 0) + 1 }))}
                    className="w-11 h-full flex items-center justify-center font-bold text-[20px] active:bg-primary/20"
                  >
                    +
                  </button>
                </div>
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
