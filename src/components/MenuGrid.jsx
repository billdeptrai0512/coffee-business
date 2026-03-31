import { formatVND } from '../utils'

export default function MenuGrid({ products, cart, onAddItem }) {
    return (
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-6 pb-6 pt-5">
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
                            onClick={() => onAddItem(product)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onAddItem(product);
                                }
                            }}
                            className={`menu-btn relative rounded-[1.5rem] p-4.5 sm:p-5 text-left min-h-[140px] flex flex-col justify-between border cursor-pointer transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-primary/30 ${qty > 0
                                ? 'bg-gradient-to-br from-primary/15 to-primary/5 border-primary/40 shadow-[0_8px_24px_var(--color-primary-glow)] ring-1 ring-primary/20'
                                : 'bg-surface border-border/60 shadow-sm hover:border-text/30 hover:shadow-md hover:bg-surface-hover'
                                }`}
                        >
                            {/* Glow Effect */}
                            {qty > 0 && <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />}

                            {/* Top: Name */}
                            <div className="relative z-10 w-full">
                                <h3 className={`font-black text-[18px] sm:text-[19px] leading-tight break-words pt-0.25 ${qty > 0 ? 'text-primary drop-shadow-sm' : 'text-text'}`}>
                                    {product.name}
                                </h3>
                            </div>

                            {/* Bottom: Price & Badge */}
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
    )
}
