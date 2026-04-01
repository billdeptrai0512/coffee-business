import { useState } from 'react'
import { formatVND, calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'

export default function HistoryView({ todayOrders, recipes, products, ingredientCosts, isLoadingHistory, onBack, onDeleteOrder, onOpenRecipeManager }) {
    const [deletingId, setDeletingId] = useState(null)
    const formattedOnline = todayOrders.map(o => ({
        id: o.id,
        total: o.total,
        cost: o.order_items ? o.order_items.reduce((sum, i) => sum + (calculateProductCost(i.product_id, recipes, ingredientCosts) * i.quantity), 0) : 0,
        createdAt: o.created_at,
        isOffline: false,
        paymentMethod: o.payment_method || null,
        items: o.order_items ? o.order_items.map(i => {
            const options = i.options
                ? i.options.split(', ').filter(opt => opt !== 'Tiền mặt' && opt !== 'MoMo').join(' - ')
                : ''
            const pName = products?.find(p => p.id === i.product_id)?.name || i.products?.name || '☕'
            return {
                text: `${i.quantity} ${pName}${options ? ` (${options})` : ''}`,
                cost: calculateProductCost(i.product_id, recipes, ingredientCosts) * i.quantity
            }
        }) : []
    }))

    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const formattedOffline = pending
        .filter(o => new Date(o.createdAt).toDateString() === todayStr)
        .map((o, idx) => ({
            id: `offline-${idx}`,
            total: o.total,
            cost: (o.cart || o.orderItems || []).reduce((sum, i) => sum + (calculateProductCost(i.productId, recipes, ingredientCosts) * i.quantity), 0),
            createdAt: o.createdAt,
            isOffline: true,
            paymentMethod: o.paymentMethod || null,
            items: o.cart
                ? o.cart.map(i => {
                    const extras = i.extras.filter(e => e.name !== 'Tiền mặt' && e.name !== 'MoMo')
                    return {
                        text: `${i.quantity} ${i.name}${extras.length ? ` (${extras.map(e => e.name).join(' - ')})` : ''}`,
                        cost: calculateProductCost(i.productId, recipes, ingredientCosts) * i.quantity
                    }
                })
                : o.orderItems ? o.orderItems.map(i => ({
                    text: `${i.quantity} ${i.name}`,
                    cost: calculateProductCost(i.productId, recipes, ingredientCosts) * i.quantity
                })) : []
        }))

    const allOrders = [...formattedOnline, ...formattedOffline].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // --- Stats ---
    const totalRevenue = allOrders.reduce((sum, o) => sum + o.total, 0)
    const totalCost = allOrders.reduce((sum, o) => sum + o.cost, 0)
    const totalProfit = totalRevenue - totalCost

    // Running totals (oldest first to accumulate)
    const chronological = [...allOrders].reverse()
    const runningTotals = new Map()
    let cumulative = 0
    for (const order of chronological) {
        cumulative += order.total
        runningTotals.set(order.id, cumulative)
    }

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
                    </button>

                    <div className="flex flex-row gap-2 flex-1">
                        <div
                            onClick={onOpenRecipeManager}
                            className="flex-1 bg-danger/10 border border-danger/20 rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-danger/15 active:bg-danger/20 transition-colors"
                        >
                            <span className="text-[12px] font-black text-danger uppercase line-clamp-1">Chi phí</span>
                            <span className="text-[12px] font-bold text-danger/80 leading-none mt-1 tabular-nums">{formatVND(totalCost)}</span>
                        </div>
                        <div className="flex-1 bg-success/10 border border-success/20 rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-success uppercase line-clamp-1">Doanh thu</span>
                            <span className="text-[12px] font-bold text-success/80 leading-none mt-1 tabular-nums">{formatVND(totalRevenue)}</span>
                        </div>

                        {/* <div className="flex-1 bg-success/10 border border-success/20 rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-success uppercase line-clamp-1">Lợi nhuận</span>
                            <span className="text-[12px] font-bold text-success/80 leading-none mt-1 tabular-nums">{formatVND(totalProfit)}</span>
                        </div> */}
                    </div>
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
                                    <div className="flex items-center gap-2">
                                        <span className="font-black text-[14px] text-primary">+ {formatVND(order.total)}</span>
                                    </div>
                                    <span className="text-success leading-none text-[14px] font-bold tabular-nums">
                                        {formatVND(runningTotals.get(order.id) || 0)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-start mb-1 border-t border-border/40 pt-2">
                                    <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                        {order.items?.length > 0 ? (
                                            order.items.map((item, idx) => (
                                                <div key={idx} className="flex flex-row gap-2 items-start w-full">
                                                    <span className="text-text text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap">{item.text}</span>
                                                    <div className="flex gap-2 text-[11px] font-medium mt-0.5 items-start shrink-0">
                                                        {item.cost > 0 && <span className="text-danger bg-danger/10 px-1.5 py-0.5 rounded-md">{formatVND(item.cost)}</span>}
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <span className="text-text text-[14px] leading-snug font-medium whitespace-pre-wrap">Không có chi tiết</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                                        {!order.isOffline ? (
                                            <span
                                                className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                                onClick={() => {
                                                    if (deletingId === order.id) return
                                                    const text = order.items?.map(i => i.text).join(', ') || ''
                                                    if (window.confirm(`Xóa đơn ${text} (${formatVND(order.total)})?\n\nHành động này không thể hoàn tác!`)) {
                                                        setDeletingId(order.id)
                                                        onDeleteOrder(order.id).finally(() => setDeletingId(null))
                                                    }
                                                }}
                                                title="Nhấn để xóa đơn hàng"
                                            >
                                                {deletingId === order.id ? '⏳' : time}
                                            </span>
                                        ) : (
                                            <span className="text-text-secondary text-[14px] font-bold">{time}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </main>
        </div>
    )
}
