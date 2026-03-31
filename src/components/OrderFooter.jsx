import { formatVND } from '../utils'
import { QUICK_EXTRAS, PAYMENT_METHODS } from '../constants'

export default function OrderFooter({ cart, activeCartItemId, total, hasOrder, isSubmitting, paymentMethod, onToggleExtra, onSelectPayment, onConfirm }) {
    return (
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
                                    onClick={() => onToggleExtra(ex)}
                                    className="shrink-0 h-[42px] px-4 rounded-[14px] border bg-surface-light border-border/80 text-text-secondary hover:text-text font-bold text-[14px] whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all shadow-sm"
                                >
                                    {ex.name}
                                </button>
                            )
                        }

                        return (
                            <button
                                key={ex.id}
                                onClick={() => onToggleExtra(ex)}
                                className="shrink-0 flex items-center gap-1.5 h-[42px] px-4 rounded-[14px] border bg-primary/10 border-primary/50 text-primary font-bold text-[14px] whitespace-nowrap focus:outline-none shadow-sm backdrop-blur-sm active:bg-primary/20"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-primary mb-[1px]"></span>
                                {ex.name}
                            </button>
                        )
                    })}

                    {/* Divider */}
                    <div className="shrink-0 w-px h-7 bg-border/60" />

                    {/* Payment Method Toggles */}
                    {PAYMENT_METHODS.map(pm => {
                        const isActive = paymentMethod === pm.id
                        return (
                            <button
                                key={pm.id}
                                onClick={() => onSelectPayment(isActive ? null : pm.id)}
                                className={`shrink-0 h-[42px] px-4 rounded-[14px] border font-bold text-[14px] whitespace-nowrap focus:outline-none transition-all shadow-sm ${isActive
                                    ? pm.id === 'cash'
                                        ? 'bg-green-500/15 border-green-500/50 text-green-600'
                                        : 'bg-blue-500/15 border-blue-500/50 text-blue-600'
                                    : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'
                                    }`}
                            >
                                {pm.label}
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
                    onClick={onConfirm}
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
    )
}
