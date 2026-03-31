import { formatVND } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'

export default function HistoryView({ todayOrders, isLoadingHistory, onBack }) {
    const formattedOnline = todayOrders.map(o => ({
        id: o.id,
        total: o.total,
        createdAt: o.created_at,
        isOffline: false,
        paymentMethod: o.payment_method || null,
        itemsText: o.order_items ? o.order_items.map(i => {
            const options = i.options
                ? i.options.split(', ').filter(opt => opt !== 'Tiền mặt' && opt !== 'Chuyển khoản').join(' - ')
                : ''
            return `${i.quantity} ${i.products?.name}${options ? ` (${options})` : ''}`
        }).join(' + ') : ''
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
            paymentMethod: o.paymentMethod || null,
            itemsText: o.cart
                ? o.cart.map(i => {
                    const extras = i.extras.filter(e => e.name !== 'Tiền mặt' && e.name !== 'Chuyển khoản')
                    return `${i.quantity} ${i.name}${extras.length ? ` (${extras.map(e => e.name).join(', ')})` : ''}`
                }).join(', ')
                : o.orderItems ? o.orderItems.map(i => `${i.quantity} ${i.name}`).join(', ') : ''
        }))

    const allOrders = [...formattedOnline, ...formattedOffline].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // --- Stats ---
    const totalRevenue = allOrders.reduce((sum, o) => sum + o.total, 0)
    const cashOrders = allOrders.filter(o => o.paymentMethod === 'cash')
    const transferOrders = allOrders.filter(o => o.paymentMethod === 'transfer')
    const cashRevenue = cashOrders.reduce((sum, o) => sum + o.total, 0)
    const transferRevenue = transferOrders.reduce((sum, o) => sum + o.total, 0)

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
                        <div className="flex-1 bg-primary/10 border border-primary/20 rounded-[14px] px-3 py-2.5 flex flex-col items-center">
                            <span className="text-[10px] font-bold text-primary/70 uppercase">TOTAL</span>
                            <span className="text-[14px] font-black text-primary leading-none mt-1">{allOrders.length}</span>
                        </div>
                        <div className="flex-1 bg-green-500/10 border border-green-500/20 rounded-[14px] px-3 py-2.5 flex flex-col items-center">
                            <span className="text-[10px] font-bold text-green-600/70 uppercase">CASH</span>
                            <span className="text-[14px] font-black text-green-600 leading-none mt-1 tabular-nums">{formatVND(cashRevenue)}</span>
                        </div>
                        <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-[14px] px-3 py-2.5 flex flex-col items-center">
                            <span className="text-[10px] font-bold text-blue-600/70 uppercase">BANK</span>
                            <span className="text-[14px] font-black text-blue-600 leading-none mt-1 tabular-nums">{formatVND(transferRevenue)}</span>
                        </div>
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
                                        <span className="text-text font-black text-[15px] text-primary">+ {formatVND(order.total)}</span>
                                        {order.paymentMethod && (
                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${order.paymentMethod === 'cash'
                                                ? 'bg-green-500/15 text-green-600'
                                                : 'bg-blue-500/15 text-blue-600'
                                                }`}>
                                                {order.paymentMethod === 'cash' ? '💵 Tiền mặt' : '📱 Bank'}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-primary leading-none text-[17px] font-bold tabular-nums">
                                        {formatVND(runningTotals.get(order.id) || 0)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center mb-1  border-t border-border/40 pt-2">
                                    <span className="text-text text-[14px] leading-snug font-medium">{order.itemsText || 'Không có chi tiết'}</span>
                                    <span className="text-text-secondary text-[14px] font-bold">{time}</span>
                                </div>
                            </div>
                        )
                    })
                )}
            </main>
        </div>
    )
}
