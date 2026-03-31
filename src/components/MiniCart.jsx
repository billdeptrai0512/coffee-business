import { formatVND } from '../utils'

export default function MiniCart({ cart, activeCartItemId, onSelectItem, onRemoveItem }) {
    if (cart.length === 0) return null

    return (
        <div className="shrink-0 bg-surface border-t border-border/80 p-4 max-h-[30vh] overflow-y-auto">
            <div className="flex flex-col gap-2">
                {cart.map(item => {
                    const extrasPrice = item.extras.reduce((sum, e) => sum + e.price, 0)
                    const itemTotal = (item.basePrice + extrasPrice) * item.quantity
                    const isActive = item.cartItemId === activeCartItemId || (!activeCartItemId && item === cart[cart.length - 1])

                    return (
                        <div
                            key={item.cartItemId}
                            onClick={() => onSelectItem(item.cartItemId)}
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
                                <button onClick={(e) => { e.stopPropagation(); onRemoveItem(item.cartItemId); }} className="text-text-secondary hover:text-danger text-[13px] font-bold uppercase tracking-wider px-2 py-1 -mr-2 focus:outline-none">Xóa</button>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
