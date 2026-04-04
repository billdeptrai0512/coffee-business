import { useState } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'
import { formatVND, calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { BarChart3, TrendingUp, MinusCircle, Wallet, ArrowLeft, ArrowRight, Coffee, Banknote, Activity, ShoppingBag, Filter, Plus, Trash2, X } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, Tooltip as RechartsTooltip } from 'recharts'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleAddExpense, handleDeleteExpense } = usePOS()

    const [selectedProductId, setSelectedProductId] = useState('all')
    const [showExpenseListModal, setShowExpenseListModal] = useState(false)
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmittingCost, setIsSubmittingCost] = useState(false)
    const [deletingId, setDeletingId] = useState(null)

    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const offlineToday = pending.filter(o => new Date(o.createdAt).toDateString() === todayStr)

    // Calculate metrics
    let totalRevenue = 0
    let totalCOGS = 0 // Cost of Goods Sold (Giá vốn hàng bán)
    let totalCups = 0

    // Data structures for charts
    const heatmapData = {}
    const hourlyRevenue = {}
    const productStats = {} // { [productId]: { qty, revenue, cost } }
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

            // Heatmap
            if (!heatmapData[productId]) heatmapData[productId] = {}
            heatmapData[productId][hour] = (heatmapData[productId][hour] || 0) + qty
            if (heatmapData[productId][hour] > maxHeatmapQty) maxHeatmapQty = heatmapData[productId][hour]

            // Profit & COGS
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
        for (let h = minH; h <= maxH; h++) {
            hourRange.push(h)
        }
    }

    const lineChartData = []
    let cumulative = 0
    // To ensure full graph visual even with gaps, fill empty hours with current cumulative
    for (const h of hourRange) {
        cumulative += (hourlyRevenue[h] || 0)
        lineChartData.push({
            hour: `${h}h`,
            revenue: cumulative
        })
    }

    // Menu Engineering data
    const menuItems = Array.from(soldProducts).map(productId => {
        const prodDef = products.find(p => p.id === productId)
        const stats = productStats[productId] || { qty: 0, revenue: 0, cost: 0 }
        const profit = stats.revenue - stats.cost
        const margin = stats.revenue > 0 ? (profit / stats.revenue) * 100 : 0
        return {
            id: productId,
            name: prodDef ? prodDef.name : 'Unknown',
            qty: stats.qty,
            revenue: stats.revenue,
            cost: stats.cost,
            profit,
            margin
        }
    })

    // Classify: Star / Plow / Puzzle / Dog
    const medianQty = menuItems.length > 0
        ? [...menuItems].sort((a, b) => a.qty - b.qty)[Math.floor(menuItems.length / 2)].qty
        : 0
    const medianMargin = menuItems.length > 0
        ? [...menuItems].sort((a, b) => a.margin - b.margin)[Math.floor(menuItems.length / 2)].margin
        : 0

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

    // Filter display name for cups card
    let filterDisplayTitle = "Tổng cộng bán"
    let cupIconColor = "text-text-secondary/20 group-hover:text-text-secondary/30"
    if (selectedProductId !== 'all') {
        const pDef = products.find(p => p.id === selectedProductId)
        if (pDef) {
            filterDisplayTitle = pDef.name
            // make it more colorful if a product is selected
            cupIconColor = "text-primary/20 group-hover:text-primary/30"
        }
    }

    const submitExpense = async () => {
        if (!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0) return
        if (!handleAddExpense) return

        setIsSubmittingCost(true)
        try {
            await handleAddExpense(costName.trim(), Number(costAmount))
            setCostName('')
            setCostAmount('')
        } catch (err) {
            console.error(err)
        } finally {
            setIsSubmittingCost(false)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-3">
                <button
                    onClick={() => navigate('/history')}
                    className="w-10 h-10 flex flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <div className="flex-1 text-center pr-10">
                    <h1 className="text-[16px] font-black uppercase text-primary tracking-wider">Báo Cáo Cuối Ngày</h1>
                    <span className="text-[12px] font-medium text-text-secondary">{new Date().toLocaleDateString('vi-VN')}</span>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 space-y-4 bg-bg">
                {isLoadingHistory ? (
                    <div className="flex justify-center py-10">
                        <span className="text-text-secondary font-medium">Đang tải báo cáo...</span>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 animate-fade-in">

                        {/* Tổng số ly */}
                        <div className="grid grid-cols-2 gap-3 mt-2">
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                                <div className={`absolute top-3 right-3 transition-colors ${cupIconColor}`}>
                                    <Coffee size={36} />
                                </div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1 truncate pr-8">{filterDisplayTitle}</h3>
                                <div className="text-[18px] font-bold text-text-primary tabular-nums">
                                    {totalCups} ly
                                </div>
                            </div>
                            <div className="bg-surface rounded-[24px] p-3 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Filter size={14} className="text-text-secondary" />
                                    <h3 className="text-[12px] font-black text-text-secondary uppercase">Lọc theo món</h3>
                                </div>
                                <div className="relative">
                                    <select
                                        value={selectedProductId}
                                        onChange={(e) => setSelectedProductId(e.target.value)}
                                        className="w-full bg-surface-light text-text border border-border/40 rounded-xl px-2 py-2 text-[13px] font-medium appearance-none focus:outline-none focus:border-primary/50 transition-colors"
                                    >
                                        <option value="all">Tất cả món</option>
                                        {products.filter(p => soldProducts.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-text-secondary">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 my-1 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Doanh thu - Giá vốn - Chi phí</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                        </div>

                        {/* Tài chính */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                                <div className="absolute top-3 right-3 text-success/20 group-hover:text-success/30 transition-colors">
                                    <Banknote size={36} />
                                </div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Doanh thu</h3>
                                <div className="text-[18px] font-bold text-success tabular-nums">
                                    {formatVND(totalRevenue)}
                                </div>
                            </div>
                            <div
                                onClick={() => navigate('/recipes')}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <div className="absolute top-3 right-3 text-warning/30 group-hover:text-warning/50 transition-colors">
                                    <ArrowRight size={36} />
                                </div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Giá vốn</h3>
                                <div className="text-[18px] font-bold text-warning tabular-nums">
                                    - {formatVND(totalCOGS)}
                                </div>
                            </div>
                            <div
                                onClick={() => setShowExpenseListModal(true)}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <div className="absolute top-3 right-3 text-danger/20 group-hover:text-danger/30 transition-colors">
                                    <MinusCircle size={36} />
                                </div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí</h3>
                                <div className="text-[18px] font-bold text-danger tabular-nums">
                                    - {formatVND(totalExpense)}
                                </div>
                            </div>
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                                <div className="absolute top-3 right-3 text-success/20 group-hover:text-success/30 transition-colors">
                                    <Activity size={36} />
                                </div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Lợi nhuận ròng</h3>
                                <div className="text-[18px] font-bold text-success tabular-nums">
                                    {formatVND(netProfit)}
                                </div>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 mt-4 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Phân Tích Kinh Doanh</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                        </div>

                        {/* 3. Cumulative Line Chart */}
                        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60">
                            <div className="flex flex-col mb-4">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="text-warning" size={20} />
                                    <h3 className="text-[14px] font-black uppercase text-text-primary">Dòng tiền / Thời gian</h3>
                                </div>
                                <p className="text-[12px] text-text-secondary mt-1 ml-7">Giúp quyết định cắt giảm chi phí vận hành.</p>
                            </div>

                            {lineChartData.length > 0 ? (
                                <div className="h-[220px] w-full mt-2">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={lineChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#44403c" vertical={false} />
                                            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} tickMargin={10} />
                                            <RechartsTooltip
                                                contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', borderRadius: '12px' }}
                                                itemStyle={{ color: '#f59e0b', fontSize: '13px', fontWeight: 'bold' }}
                                                formatter={(value) => [formatVND(value), 'Doanh thu']}
                                                labelStyle={{ color: '#fafaf9', fontWeight: 'bold', marginBottom: '4px' }}
                                            />
                                            <Line type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={4} dot={{ fill: '#1c1917', stroke: '#f59e0b', strokeWidth: 3, r: 4 }} activeDot={{ r: 7, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                                    Chưa có dòng tiền trong ngày
                                </div>
                            )}
                        </div>

                        {/* 1. Heatmap */}
                        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 overflow-hidden">
                            <div className="flex flex-col mb-4">
                                <div className="flex items-center gap-2">
                                    <Activity className="text-primary" size={20} />
                                    <h3 className="text-[14px] font-black uppercase text-text-primary">Bán món gì / Thời điểm</h3>
                                </div>
                                <p className="text-[12px] text-text-secondary mt-1 ml-7">Giúp quyết định thời điểm chuẩn bị nguyên liệu (Prep).</p>
                            </div>

                            {hourRange.length > 0 ? (
                                <div className="overflow-x-auto hide-scrollbar pb-2">
                                    <div className="min-w-max">
                                        <div className="flex border-b border-border/40 pb-2 mb-2">
                                            <div className="w-[100px] shrink-0 text-[10px] uppercase text-text-secondary font-bold">Món \ Giờ</div>
                                            {hourRange.map(h => (
                                                <div key={h} className="w-8 shrink-0 text-center text-[10px] text-text-secondary font-bold">{h}h</div>
                                            ))}
                                        </div>
                                        {Array.from(soldProducts).map(productId => {
                                            const prodDef = products.find(p => p.id === productId)
                                            const pName = prodDef ? prodDef.name : 'Unknown'
                                            return (
                                                <div key={productId} className="flex items-center py-[6px]">
                                                    <div className="w-[100px] shrink-0 text-[11px] font-medium text-text-primary truncate pr-2" title={pName}>{pName}</div>
                                                    {hourRange.map(h => {
                                                        const qty = heatmapData[productId]?.[h] || 0
                                                        const intensity = maxHeatmapQty > 0 ? qty / maxHeatmapQty : 0
                                                        return (
                                                            <div key={h} className="w-8 shrink-0 flex justify-center">
                                                                <div
                                                                    className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-[11px] font-bold transition-all"
                                                                    style={{
                                                                        backgroundColor: qty > 0 ? `rgba(245, 158, 11, ${Math.max(0.15, intensity)})` : 'transparent',
                                                                        color: qty > 0 ? (intensity > 0.5 ? '#fff' : '#f59e0b') : 'transparent'
                                                                    }}
                                                                >
                                                                    {qty > 0 ? qty : ''}
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                                    Chưa có dữ liệu hôm nay
                                </div>
                            )}
                        </div>

                        {/* 2. Menu Engineering Cards */}
                        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60">
                            <div className="flex flex-col mb-4">
                                <div className="flex items-center gap-2">
                                    <ShoppingBag className="text-success" size={20} />
                                    <h3 className="text-[14px] font-black uppercase text-text-primary">Menu / Số ly / Biên lợi nhuận</h3>
                                </div>
                                <p className="text-[12px] text-text-secondary mt-1 ml-7">Giúp quyết định giữ / bỏ / đẩy mạnh món nào.</p>
                            </div>

                            {classifiedItems.length > 0 ? (
                                <div className="flex flex-col gap-3">
                                    {classifiedItems.map(item => {
                                        const maxRev = Math.max(...classifiedItems.map(i => i.revenue), 1)
                                        const revWidth = Math.max(8, (item.revenue / maxRev) * 100)
                                        const costWidth = item.revenue > 0 ? (item.cost / item.revenue) * 100 : 0

                                        const tagColors = {
                                            Star: 'bg-success/15 text-success border-success/30',
                                            Plow: 'bg-warning/15 text-warning border-warning/30',
                                            Puzzle: 'bg-primary/15 text-primary border-primary/30',
                                            Dog: 'bg-danger/15 text-danger border-danger/30'
                                        }

                                        return (
                                            <div key={item.id} className="bg-surface-light rounded-2xl p-3 border border-border/40">
                                                {/* Row 1: Name + Badge */}
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[13px] font-bold text-text-primary truncate pr-2">{item.name}</span>
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${tagColors[item.tag]}`}>
                                                        {item.emoji} {item.tag}
                                                    </span>
                                                </div>
                                                {/* Row 2: Stats */}
                                                <div className="flex items-center gap-3 mb-2">
                                                    <span className="text-[11px] text-text-secondary">{item.qty} ly</span>
                                                    <span className="text-[11px] text-success font-semibold">+{formatVND(item.profit)}</span>
                                                    <span className={`text-[11px] font-bold ml-auto ${item.margin >= 50 ? 'text-success' : item.margin >= 30 ? 'text-warning' : 'text-danger'}`}>
                                                        {item.margin.toFixed(0)}% margin
                                                    </span>
                                                </div>
                                                {/* Row 3: Revenue vs Cost bar */}
                                                <div className="h-[6px] rounded-full bg-border/30 overflow-hidden" style={{ width: `${revWidth}%` }}>
                                                    <div className="h-full rounded-full bg-success" style={{ width: `${100 - costWidth}%` }}></div>
                                                </div>
                                                <div className="flex justify-between mt-1">
                                                    <span className="text-[9px] text-text-dim">Vốn {formatVND(item.cost)}</span>
                                                    <span className="text-[9px] text-text-dim">DT {formatVND(item.revenue)}</span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                                    Chưa có dữ liệu menu
                                </div>
                            )}
                        </div>

                    </div>
                )}
            </main>

            {/* Expense Management Modal */}
            {showExpenseListModal && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4 animate-fade-in backdrop-blur-sm">
                    <div className="bg-bg w-full h-[85dvh] sm:h-[80dvh] sm:max-h-[600px] sm:max-w-md rounded-t-[24px] sm:rounded-[24px] shadow-lg animate-slide-up sm:animate-scale-up flex flex-col border-t sm:border border-border/40 overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-border/60 bg-surface">
                            <div className="flex items-center gap-2">
                                <MinusCircle className="text-danger" size={20} />
                                <h3 className="text-[15px] font-black text-danger uppercase">Quản Lý Chi Phí</h3>
                            </div>
                            <button
                                onClick={() => setShowExpenseListModal(false)}
                                className="text-[14px] font-bold text-text-secondary hover:text-text transition-colors p-1"
                            >
                                Đóng
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {(!todayExpenses || todayExpenses.length === 0) ? (
                                <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                                    Chưa có chi phí nào phát sinh hôm nay.
                                </div>
                            ) : (
                                [...todayExpenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(expense => {
                                    const time = `${new Date(expense.created_at).getHours().toString().padStart(2, '0')}:${new Date(expense.created_at).getMinutes().toString().padStart(2, '0')}`
                                    return (
                                        <div key={expense.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
                                            <div className="absolute top-0 right-0 bg-danger/10 text-danger text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                                Chi phí
                                            </div>
                                            <div className="flex justify-between items-center mb-1">
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="font-black text-[14px] text-danger">- {formatVND(expense.amount)}</span>
                                                </div>
                                            </div>
                                            <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                                <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                                    <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                                                </div>
                                                <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                                    <span
                                                        className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                                        onClick={() => {
                                                            if (deletingId === expense.id) return
                                                            if (window.confirm(`Xóa chi phí ${expense.name}?\n\nHành động này không thể hoàn tác!`)) {
                                                                setDeletingId(expense.id)
                                                                if (handleDeleteExpense) {
                                                                    handleDeleteExpense(expense.id, expense.amount).finally(() => setDeletingId(null))
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        {deletingId === expense.id ? '⏳' : time}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        <div className="p-4 bg-surface border-t border-border/60 flex flex-col gap-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Tên chi phí (VD: Nước đá)"
                                    value={costName}
                                    onChange={e => setCostName(e.target.value)}
                                    className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                                />
                                <input
                                    type="number"
                                    placeholder="Số tiền..."
                                    value={costAmount}
                                    onChange={e => setCostAmount(e.target.value)}
                                    className="w-[110px] shrink-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitExpense()
                                    }}
                                />
                            </div>
                            <button
                                onClick={submitExpense}
                                disabled={!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || isSubmittingCost}
                                className="w-full py-3 rounded-[12px] bg-danger text-white text-[14px] font-black hover:bg-danger/90 active:bg-danger/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmittingCost ? 'Đang thêm...' : '+ Thêm chi phí'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
