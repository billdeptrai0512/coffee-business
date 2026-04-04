import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CirclePlus, ClipboardCheck } from 'lucide-react'
import { formatVND, calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'

export default function HistoryView({ todayOrders, todayExpenses, recipes, products, ingredientCosts, isLoadingHistory, onBack, onDeleteOrder, onAddExpense, onDeleteExpense }) {
    const navigate = useNavigate()
    const [deletingId, setDeletingId] = useState(null)
    const [showCostModal, setShowCostModal] = useState(false)
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmittingCost, setIsSubmittingCost] = useState(false)

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
                cost: calculateProductCost(i.product_id, recipes, ingredientCosts) * i.quantity,
                quantity: i.quantity
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
                        cost: calculateProductCost(i.productId, recipes, ingredientCosts) * i.quantity,
                        quantity: i.quantity
                    }
                })
                : o.orderItems ? o.orderItems.map(i => ({
                    text: `${i.quantity} ${i.name}`,
                    cost: calculateProductCost(i.productId, recipes, ingredientCosts) * i.quantity,
                    quantity: i.quantity
                })) : []
        }))

    const formattedExpenses = (todayExpenses || []).map(e => ({
        id: e.id,
        total: 0,
        cost: e.amount,
        createdAt: e.created_at,
        isOffline: false,
        isExpense: true,
        items: [{ text: `${e.name}`, cost: e.amount }]
    }))

    const allOrders = [...formattedOnline, ...formattedOffline, ...formattedExpenses].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // --- Stats ---
    const totalRevenue = allOrders.reduce((sum, o) => sum + o.total, 0)
    const totalExpense = formattedExpenses.reduce((sum, e) => sum + e.cost, 0)
    const totalCups = allOrders.reduce((sum, o) => {
        if (o.isExpense || !o.items) return sum;
        return sum + o.items.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0);
    }, 0)

    // Running totals (oldest first to accumulate)
    const chronological = [...allOrders].reverse()
    const runningTotals = new Map()
    let cumulative = 0
    for (const order of chronological) {
        if (!order.isExpense) {
            cumulative += order.total
        }
        runningTotals.set(order.id, cumulative)
    }

    const handleAddCost = async () => {
        if (!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0) return
        if (!onAddExpense) return

        setIsSubmittingCost(true)
        try {
            await onAddExpense(costName.trim(), Number(costAmount))
            setCostName('')
            setCostAmount('')
            setShowCostModal(false)
        } catch (err) {
            console.error(err)
        } finally {
            setIsSubmittingCost(false)
        }
    }

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
                    </button>

                    <div className="flex flex-row gap-2 flex-1">

                        <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm  rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Tổng cộng</span>
                            <span className="text-[12px] font-bold text-primary/80 leading-none mt-1 tabular-nums">{totalCups} ly</span>
                        </div>

                        <button onClick={() => setShowCostModal(true)}
                            className="flex-1 bg-danger/10 border border-danger/20 rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-danger/15 active:bg-danger/20 active:scale-[0.98] transition-all select-none focus:outline-none focus:ring-2 focus:ring-danger/30"
                            title="Thêm chi phí"
                        >
                            <div className="flex items-center gap-1">
                                <span className="text-[12px] font-black text-danger uppercase line-clamp-1">Chi phí</span>
                                <CirclePlus size={14} className="text-danger" strokeWidth={2.5} />
                            </div>
                            <span className="text-[12px] font-bold text-danger/80 leading-none mt-1 tabular-nums">{formatVND(totalExpense)}</span>
                        </button>

                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-5 pb-24 space-y-3 bg-bg">
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
                            <div key={order.id} className={`bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden ${order.isExpense ? 'opacity-90' : ''}`}>
                                {order.isOffline && !order.isExpense && (
                                    <div className="absolute top-0 right-0 bg-warning/20 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                        Offline
                                    </div>
                                )}
                                {order.isExpense && (
                                    <div className="absolute top-0 right-0 bg-danger/10 text-danger text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                        Chi phí
                                    </div>
                                )}
                                <div className="flex justify-between items-center mb-1">
                                    <div className="flex items-center gap-2 mt-1">
                                        {!order.isExpense ? (
                                            <span className="font-black text-[14px] text-primary">+ {formatVND(order.total)}</span>
                                        ) : (
                                            <span className="font-black text-[14px] text-danger">- {formatVND(order.cost)}</span>
                                        )}
                                    </div>
                                    {!order.isExpense ? (
                                        <span className="text-success leading-none text-[14px] mt-1 font-bold tabular-nums">
                                            {formatVND(runningTotals.get(order.id) || 0)}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                    <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                        {order.items?.length > 0 ? (
                                            order.items.map((item, idx) => (
                                                <div key={idx} className="flex flex-row gap-2 items-start w-full">
                                                    <span className={`text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text`}>{item.text}</span>
                                                    {/* {!order.isExpense && item.cost > 0 && (
                                                        <div className="flex gap-2 text-[11px] font-medium mt-0.5 items-start shrink-0">
                                                            <span className="text-danger bg-danger/10 px-1.5 py-0.5 rounded-md">{formatVND(item.cost)}</span>
                                                        </div>
                                                    )} */}
                                                </div>
                                            ))
                                        ) : (
                                            <span className="text-text text-[14px] leading-snug font-medium whitespace-pre-wrap">Không có chi tiết</span>
                                        )}
                                    </div>
                                    <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                        {!order.isOffline ? (
                                            <span
                                                className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                                onClick={() => {
                                                    if (deletingId === order.id) return
                                                    const text = order.items?.map(i => i.text).join(', ') || ''
                                                    if (order.isExpense) {
                                                        if (window.confirm(`Xóa chi phí ${text}?\n\nHành động này không thể hoàn tác!`)) {
                                                            setDeletingId(order.id)
                                                            onDeleteExpense(order.id, order.cost).finally(() => setDeletingId(null))
                                                        }
                                                    } else {
                                                        if (window.confirm(`Xóa đơn ${text} (${formatVND(order.total)})?\n\nHành động này không thể hoàn tác!`)) {
                                                            setDeletingId(order.id)
                                                            onDeleteOrder(order.id).finally(() => setDeletingId(null))
                                                        }
                                                    }
                                                }}
                                                title={order.isExpense ? "Nhấn để xóa chi phí" : "Nhấn để xóa đơn hàng"}
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

            {/* Footer */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-bg via-bg via-60% to-transparent pointer-events-none">
                <div className="flex gap-2 pointer-events-auto mt-6">
                    <div className="flex-1 bg-surface-light border border-border/60 rounded-[16px] px-4 py-2 flex flex-col justify-center items-start shadow-sm">
                        <span className="text-[12px] font-black text-text-secondary uppercase">Tổng doanh thu</span>
                        <span className="text-[16px] font-bold text-success max-w-full overflow-hidden text-ellipsis leading-none mt-1 tabular-nums">
                            {formatVND(totalRevenue - totalExpense)}
                        </span>
                    </div>

                    <button
                        onClick={() => navigate('/daily-report')}
                        className="bg-surface-light border border-border/60 rounded-[16px] px-5 flex flex-col items-center justify-center gap-1 shadow-sm hover:bg-border/30 active:scale-95 transition-all group"
                        title="Chốt ca"
                    >
                        {/* <ClipboardCheck size={20} strokeWidth={2.5} className="text-text-secondary group-hover:text-text transition-colors" /> */}
                        <span className="text-[14px] font-black text-text-secondary uppercase whitespace-nowrap group-hover:text-text transition-colors">Báo cáo cuối ngày</span>
                    </button>
                </div>
            </div>

            {/* Add Cost Modal */}
            {showCostModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-fade-in backdrop-blur-sm">
                    <div className="bg-surface w-full max-w-xs rounded-[24px] shadow-lg animate-scale-up overflow-hidden flex flex-col border border-border/40">
                        <div className="p-5 pb-4">
                            <h3 className="text-[18px] font-black text-danger text-center">Thêm Chi Phí</h3>
                            <p className="text-[13px] text-text-secondary text-center mt-1 leading-snug">
                                Nhập thông tin chi phí phát sinh
                            </p>

                            <div className="mt-4 space-y-3">
                                <div>
                                    <label className="block text-[12px] font-black text-text-secondary uppercase tracking-wider mb-1.5 ml-1">
                                        Tên chi phí
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="VD: Tiền điện, Mua đá..."
                                        value={costName}
                                        onChange={e => setCostName(e.target.value)}
                                        className="w-full bg-surface-light border border-border/60 rounded-[16px] px-4 py-3 min-h-[48px] text-[15px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-[12px] font-black text-text-secondary uppercase tracking-wider mb-1.5 ml-1">
                                        Số tiền (đ)
                                    </label>
                                    <input
                                        type="number"
                                        placeholder="Nhập số tiền..."
                                        value={costAmount}
                                        onChange={e => setCostAmount(e.target.value)}
                                        className="w-full bg-surface-light border border-border/60 rounded-[16px] px-4 py-3 min-h-[48px] text-[15px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleAddCost()
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 border-t border-border/40 bg-surface-light">
                            <button
                                onClick={() => setShowCostModal(false)}
                                className="py-3.5 text-[15px] font-bold text-text-secondary hover:text-text hover:bg-border/20 active:bg-border/40 transition-colors border-r border-border/40"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleAddCost}
                                disabled={!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || isSubmittingCost}
                                className="py-3.5 text-[15px] font-black text-danger hover:bg-danger/10 active:bg-danger/20 transition-colors disabled:opacity-50 disabled:bg-transparent"
                            >
                                {isSubmittingCost ? 'Đang lưu...' : 'Lưu'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
