import { useState, useEffect } from 'react'
import { Heart, Coffee } from 'lucide-react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'
import { calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'

import ReportHeader from '../components/report/ReportHeader'
import CupsFilterCard from '../components/report/CupsFilterCard'
import FinanceCards from '../components/report/FinanceCards'
import RevenueChart from '../components/report/RevenueChart'
import HeatmapChart from '../components/report/HeatmapChart'
import MenuEngineering from '../components/report/MenuEngineering'
import ExpenseModal from '../components/report/ExpenseModal'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleAddExpense, handleDeleteExpense, handleLoadHistory } = usePOS()

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const [selectedProductId, setSelectedProductId] = useState('all')
    const [showExpenseListModal, setShowExpenseListModal] = useState(false)

    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const offlineToday = pending.filter(o => new Date(o.createdAt).toDateString() === todayStr)

    // Calculate metrics
    let totalRevenue = 0
    let totalCOGS = 0
    let totalCups = 0

    const heatmapData = {}
    const hourlyRevenue = {}
    const productStats = {}
    const activeHours = new Set()
    const soldProducts = new Set()
    let maxHeatmapQty = 0

    const processOrder = (o, isOffline) => {
        const createdAt = isOffline ? o.createdAt : o.created_at
        if (!createdAt) return

        const d = new Date(createdAt)
        const hour = d.getHours()
        activeHours.add(hour)

        hourlyRevenue[hour] = (hourlyRevenue[hour] || 0) + o.total
        totalRevenue += o.total

        const items = isOffline ? (o.cart || o.orderItems || []) : (o.order_items || [])
        items.forEach(i => {
            const productId = isOffline ? i.productId : i.product_id
            const qty = i.quantity || 1

            if (selectedProductId === 'all' || selectedProductId === productId) {
                totalCups += qty
            }

            soldProducts.add(productId)

            if (!heatmapData[productId]) heatmapData[productId] = {}
            heatmapData[productId][hour] = (heatmapData[productId][hour] || 0) + qty
            if (heatmapData[productId][hour] > maxHeatmapQty) maxHeatmapQty = heatmapData[productId][hour]

            const cost = calculateProductCost(productId, recipes, ingredientCosts)
            totalCOGS += cost * qty

            const prodDef = products.find(p => p.id === productId)
            const price = prodDef ? prodDef.price : 0

            if (!productStats[productId]) productStats[productId] = { qty: 0, revenue: 0, cost: 0 }
            productStats[productId].qty += qty
            productStats[productId].revenue += price * qty
            productStats[productId].cost += cost * qty
        })
    }

    todayOrders.forEach(o => processOrder(o, false))
    offlineToday.forEach(o => processOrder(o, true))

    const totalExpense = (todayExpenses || []).reduce((sum, e) => sum + e.amount, 0)
    const grossProfit = totalRevenue - totalCOGS
    const netProfit = grossProfit - totalExpense

    // Build Chart Arrays
    const hourRange = []
    if (activeHours.size > 0) {
        const minH = Math.min(...Array.from(activeHours))
        const maxH = Math.max(...Array.from(activeHours))
        for (let h = minH; h <= maxH; h++) hourRange.push(h)
    }

    const lineChartData = []
    let cumulative = 0
    for (const h of hourRange) {
        cumulative += (hourlyRevenue[h] || 0)
        lineChartData.push({ hour: `${h}h`, revenue: cumulative })
    }

    // Menu Engineering data
    const menuItems = Array.from(soldProducts).map(productId => {
        const prodDef = products.find(p => p.id === productId)
        const stats = productStats[productId] || { qty: 0, revenue: 0, cost: 0 }
        const profit = stats.revenue - stats.cost
        const margin = stats.revenue > 0 ? (profit / stats.revenue) * 100 : 0
        return { id: productId, name: prodDef ? prodDef.name : 'Unknown', qty: stats.qty, revenue: stats.revenue, cost: stats.cost, profit, margin }
    })

    const medianQty = menuItems.length > 0 ? [...menuItems].sort((a, b) => a.qty - b.qty)[Math.floor(menuItems.length / 2)].qty : 0
    const medianMargin = menuItems.length > 0 ? [...menuItems].sort((a, b) => a.margin - b.margin)[Math.floor(menuItems.length / 2)].margin : 0

    const classifiedItems = menuItems.map(item => {
        const highPop = item.qty >= medianQty
        const highProfit = item.margin >= medianMargin
        let tag, emoji
        if (highPop && highProfit) { tag = 'Star'; emoji = '⭐' }
        else if (highPop && !highProfit) { tag = 'Plow'; emoji = '🐴' }
        else if (!highPop && highProfit) { tag = 'Puzzle'; emoji = '🧩' }
        else { tag = 'Dog'; emoji = '🐶' }
        return { ...item, tag, emoji }
    }).sort((a, b) => b.profit - a.profit)

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader onBack={() => navigate('/history')} />

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 space-y-4 bg-bg">
                {isLoadingHistory ? (
                    <div className="flex flex-col gap-4 animate-pulse">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                        </div>
                        <div className="bg-surface-light rounded-[24px] h-60" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 animate-fade-in">
                        <CupsFilterCard
                            totalCups={totalCups}
                            selectedProductId={selectedProductId}
                            onFilterChange={setSelectedProductId}
                            products={products}
                            soldProducts={soldProducts}
                        />

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 my-1 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Doanh thu - Giá vốn - Chi phí</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                        </div>

                        <FinanceCards
                            totalRevenue={totalRevenue}
                            totalCOGS={totalCOGS}
                            totalExpense={totalExpense}
                            netProfit={netProfit}
                            onRecipesClick={() => navigate('/recipes')}
                            onExpenseClick={() => setShowExpenseListModal(true)}
                        />

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 mt-4 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Phân Tích Kinh Doanh</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                        </div>

                        <RevenueChart lineChartData={lineChartData} />
                        <HeatmapChart hourRange={hourRange} soldProducts={soldProducts} products={products} heatmapData={heatmapData} maxHeatmapQty={maxHeatmapQty} />
                        <MenuEngineering classifiedItems={classifiedItems} />

                        {/* Enhanced Footer */}
                        <div className="flex flex-col items-center justify-center py-8 mt-4 gap-3 relative">
                            <a
                                href="https://github.com/billdeptrai0512"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-surface-light border border-border/50 text-text-secondary hover:text-primary hover:border-primary/30 hover:bg-primary/5 hover:shadow-[0_0_15px_var(--color-primary-glow)] transition-all duration-300 group z-10"
                            >
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap mt-[1px]">
                                    Developed by billdeptrai0512
                                </span>
                            </a>


                        </div>
                    </div>
                )}
            </main>

            {showExpenseListModal && (
                <ExpenseModal
                    todayExpenses={todayExpenses}
                    onClose={() => setShowExpenseListModal(false)}
                    onAddExpense={handleAddExpense}
                    onDeleteExpense={handleDeleteExpense}
                />
            )}
        </div>
    )
}
