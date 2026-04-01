import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { fetchProducts, fetchTodayRevenue, fetchInventory, submitOrder, fetchAllRecipes, fetchTodayCupsSold, fetchTodayOrders, deleteOrder, fetchIngredientCosts } from './services/orderService'
import { useOfflineSync, addPendingOrder } from './hooks/useOfflineSync'
import { INGREDIENT_NAMES, LOW_STOCK_THRESHOLD, DAY_NAMES } from './constants'
import { calculateProductCost } from './utils'
import './index.css'

// Components
import Header from './components/Header'
import StockWarnings from './components/StockWarnings'
import MenuGrid from './components/MenuGrid'
import MiniCart from './components/MiniCart'
import OrderFooter from './components/OrderFooter'
import Toast from './components/Toast'
import HistoryView from './components/HistoryView'
import RecipeManager from './components/RecipeManager'
import PWAUpdatePrompt from './components/PWAUpdatePrompt'

export default function App() {
  // ---- Persisted State ----
  const [products, setProducts] = useState([])

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
  const [recipes, setRecipes] = useState([])
  const [ingredientCosts, setIngredientCosts] = useState({})
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
        const [prods, rev, inv, recs, cups, costs] = await Promise.all([
          fetchProducts(),
          fetchTodayRevenue(),
          fetchInventory(),
          fetchAllRecipes(),
          fetchTodayCupsSold(),
          fetchIngredientCosts()
        ])
        setProducts(prods)
        setRecipes(recs)
        setIngredientCosts(costs)

        if (supabase) {
          setRevenue(rev)
          setInventory(inv)
          setCupsSold(cups)
        } else {
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

  // ---- Auto-Reset Qua Ngày Mới ----
  useEffect(() => {
    const checkNewDay = () => {
      const storedDate = localStorage.getItem('pos_current_date')
      const todayStr = new Date().toDateString()
      if (storedDate && storedDate !== todayStr) {
        if (navigator.onLine && supabase) {
          fetchTodayRevenue().then(setRevenue)
          fetchTodayCupsSold().then(setCupsSold)
          setTotalCost(0) // Client-side tracking reset on new day
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
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkNewDay()
    })

    return () => {
      window.removeEventListener('focus', checkNewDay)
      window.removeEventListener('visibilitychange', checkNewDay)
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

    return () => {
      supabase.removeChannel(ordersChannel)
    }
  }, [])

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
      const costPerItem = calculateProductCost(item.productId, recipes, ingredientCosts);
      return sum + (costPerItem * item.quantity);
    }, 0);

    try {
      if (navigator.onLine && supabase) {
        await submitOrder(cart, total)
        const [rev, cups] = await Promise.all([fetchTodayRevenue(), fetchTodayCupsSold()])
        setRevenue(rev)
        setTotalCost(prev => prev + cartCost)
        setCupsSold(cups)
        showToast(`Tạo thành công`, 'success')
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

  async function handleDeleteOrder(orderId) {
    try {
      await deleteOrder(orderId)
      setTodayOrders(prev => prev.filter(o => o.id !== orderId))
      // Refresh revenue & cups from server
      const [rev, cups] = await Promise.all([fetchTodayRevenue(), fetchTodayCupsSold()])
      setRevenue(rev)
      setCupsSold(cups)
      showToast('Đã xóa đơn hàng', 'success')
    } catch (err) {
      console.error('Delete order error:', err)
      showToast('Lỗi khi xóa đơn hàng', 'warning')
    }
  }

  // ---- Format Date ----
  const today = new Date()
  const dayName = DAY_NAMES[today.getDay()]
  const dateOnly = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`

  // ---- Render ----
  // Reload recipes + costs after editing in RecipeManager
  async function handleRecipeDataChanged() {
    const [recs, costs] = await Promise.all([fetchAllRecipes(), fetchIngredientCosts()])
    setRecipes(recs)
    setIngredientCosts(costs)
  }

  if (currentView === 'recipe-manager') {
    return (
      <>
        <RecipeManager
          products={products}
          recipes={recipes}
          onBack={() => setCurrentView('history')}
          onDataChanged={handleRecipeDataChanged}
        />
        <PWAUpdatePrompt />
      </>
    )
  }

  if (currentView === 'history') {
    return (
      <>
        <HistoryView
          todayOrders={todayOrders}
          recipes={recipes}
          products={products}
          ingredientCosts={ingredientCosts}
          isLoadingHistory={isLoadingHistory}
          onBack={() => setCurrentView('pos')}
          onDeleteOrder={handleDeleteOrder}
          onOpenRecipeManager={() => setCurrentView('recipe-manager')}
        />
        <PWAUpdatePrompt />
      </>
    )
  }

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
      <Header
        isOnline={isOnline}
        dayName={dayName}
        dateOnly={dateOnly}
        cupsSold={cupsSold}
        revenue={revenue}
        totalCost={totalCost}
        onOpenHistory={handleOpenHistory}
      />

      <StockWarnings
        lowStockItems={lowStockItems}
        outOfStockItems={outOfStockItems}
      />

      <MenuGrid
        products={products}
        cart={cart}
        onAddItem={handleAddItem}
      />

      <MiniCart
        cart={cart}
        activeCartItemId={activeCartItemId}
        onSelectItem={setActiveCartItemId}
        onRemoveItem={handleRemoveCartItem}
      />

      <OrderFooter
        cart={cart}
        activeCartItemId={activeCartItemId}
        total={total}
        hasOrder={hasOrder}
        isSubmitting={isSubmitting}
        onToggleExtra={handleToggleExtra}
        onConfirm={handleConfirm}
      />

      <Toast toast={toast} />
      <PWAUpdatePrompt />
    </div>
  )
}
