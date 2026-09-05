import { useMemo, useState, useRef, useEffect, memo } from 'react'
import { X } from 'lucide-react'
import { formatVND } from '../../utils'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useProducts } from '../../contexts/ProductContext'
import MenuDivider from '../common/MenuDivider'
import { computeExtrasAfterIdx } from '../../utils/menuGridLayout'
import { onboardingHintClass, norm } from '../../utils/onboardingHint'

// The WHOLE card is the tap surface.
//   tap (any card)  → activate/order that item (onAdd); extras bar opens
//   tap corner X    → cancel the active order (onCancel).
// Committing happens elsewhere: tap another card's order (auto-commit) or the
// journal card in the header.

// memo: onAdd/onCancel are now stable across taps (see POSContext's useCallback
// wiring) and product/qty are cheap-to-compare — lets untouched cards skip
// re-rendering when MenuGrid re-renders on every single tap.
const ProductCard = memo(function ProductCard({ product, qty, onAdd, onCancel, hint, showQty }) {
    const held = qty > 0
    const hintClass = onboardingHintClass(hint)
    const [pulseKey, setPulseKey] = useState(0)        // bump per tap-add → replays the confirm pulse
    const suppressClick = useRef(false)               // swallow the click that trails a pointerup add

    // Taps add on pointerup, not on the click: iOS Safari drops the synthetic `click`
    // on rapid repeat taps (it waits to see a double-tap), so relying on click loses
    // every tap after the first. The trailing compatibility `click` (if one arrives)
    // must be eaten so it can't add again — that's all suppressClick does. A stale
    // true never swallows a tap (up() adds independently), only an unwanted click.
    const up = () => {
        suppressClick.current = true
        onAdd(product); setPulseKey(k => k + 1)
    }
    const click = () => {
        if (suppressClick.current) { suppressClick.current = false; return }
        onAdd(product)
    }
    const stop = (e) => e.stopPropagation()
    // product đi kèm để chế độ dineIn biết X này thuộc món nào — ở đó MỌI món trong
    // giỏ đều hiện X, không chỉ món đang giữ. Đường 1-chạm bỏ qua tham số này.
    const cancel = (e) => { e.stopPropagation(); onCancel(product) }

    return (
        <div
            id={`menu-${product.id}`}
            role="button"
            tabIndex={0}
            aria-pressed={held}
            aria-label={`Thêm ${product.name}`}
            onClick={click}
            onPointerUp={up}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    suppressClick.current = true
                    onAdd(product)
                }
            }}
            className={`menu-btn relative rounded-[1.5rem] p-3 sm:p-4 text-left min-h-[100px] flex flex-col justify-between cursor-pointer transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 ${held
                ? 'bg-surface border-2 border-primary shadow-[0_8px_24px_var(--color-primary-glow)]'
                : 'bg-surface border border-border/60 shadow-sm hover:border-text/30 hover:shadow-md hover:bg-surface-hover'
                } ${hintClass}`}
        >
            {/* Glow Effect */}
            {held && <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />}

            {/* Confirm pulse: a primary ring that pings out on each tap-add — the ack the
                chained 1-tap flow otherwise lacks (card stays held, no toast). Keyed so it
                replays every tap. */}
            {pulseKey > 0 && <span key={pulseKey} className="tap-pulse absolute inset-0 rounded-[1.5rem] ring-2 ring-primary pointer-events-none z-30" />}

            {/* Badge số ly, góc dưới-phải — cùng cách neo với nút X ở góc trên-phải
                (offset -4 + p-2.5) nên hai huy hiệu thò ra khỏi card đúng bằng nhau.
                Chỉ ở dineIn: đường 1-chạm giỏ luôn ≤1 ly nên badge "1" là nhiễu
                (đã gỡ ở 49b0f02), viền + nút X đã nói đủ. */}
            {showQty && qty > 0 && (
                <span className="absolute -bottom-4 -right-4 z-20 p-2.5
                  " aria-hidden="true">
                    <span className="badge-pop w-8 h-8 rounded-full flex items-center justify-center bg-text text-bg text-[14px] font-black shadow-lg border-2 border-primary/10">
                        {qty}
                    </span>
                </span>
            )}

            {/* Corner badge when active: X = cancel. */}
            {held && (
                <button
                    onPointerDown={stop}
                    onPointerUp={stop}
                    onClick={cancel}
                    aria-label={`Huỷ ${product.name}`}
                    className="absolute -top-4 -right-4 z-20 p-2.5 active:scale-90 transition-transform"
                >
                    <span className="relative w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 border-white/20 overflow-hidden bg-primary">
                        <span className="relative z-10 text-white">
                            <X size={15} strokeWidth={3} />
                        </span>
                    </span>
                </button>
            )}

            {/* Top: Name */}
            <div className="relative z-10 w-full">
                <h3 className="font-black text-[15px] sm:text-[16px] leading-tight break-words pt-0.25 text-text">
                    {product.name}
                </h3>
            </div>

            {/* Bottom: Price */}
            <div className="flex items-end justify-between mt-3 relative z-10 w-full gap-2">
                <span className={`font-extrabold text-[13px] pb-1 ${held ? 'text-primary' : 'text-text-secondary'}`}>
                    {formatVND(product.price)}
                </span>
            </div>
        </div>
    )
})

// Extras for the active (held) item. Inserted as a full-width grid item right
// after the active card's row (see MenuGrid) so it pushes the cards below down
// instead of covering them — no reflow holes regardless of column/row.
function ExtrasPopover({ activeProductId, extras, activeItem, enabledStickyExtraIds, onToggleExtra, onToggleStickyExtra, hintExtraName }) {
    const { sticky, normal } = useMemo(() => {
        const s = [], n = []
        for (const e of extras) (e.is_sticky ? s : n).push(e)
        return { sticky: s, normal: n }
    }, [extras])
    const hintClassFor = (ex) => onboardingHintClass(hintExtraName && norm(ex.name) === hintExtraName)

    // Tapping the bottom card drops the bar below the fold. Pull it into view when
    // the active item changes — `nearest` stays put if it's already visible.
    const ref = useRef(null)
    useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }) }, [activeProductId])

    return (
        <div ref={ref} className="col-span-2 bg-surface border border-border/80 rounded-[14px] shadow-xl shadow-black/10">
            <div className="w-full overflow-x-auto py-2.5 px-3 flex gap-2 items-center hide-scrollbar">
                {sticky.map(ex => {
                    const on = enabledStickyExtraIds.includes(ex.id)
                    const hintClass = hintClassFor(ex)
                    return (
                        <button
                            key={ex.id}
                            onClick={() => onToggleStickyExtra(ex)}
                            className={`shrink-0 h-[34px] px-3 rounded-[10px] border font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase flex items-center gap-1.5 ${on ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'} ${hintClass}`}
                        >
                            {on && <span className="w-1.5 h-1.5 rounded-full bg-warning mb-[1px]" />}
                            {ex.name}
                        </button>
                    )
                })}

                {sticky.length > 0 && normal.length > 0 && (
                    <div className="w-px h-5 bg-border/40 shrink-0" />
                )}

                {normal.map(ex => {
                    const on = activeItem?.extras.some(e => e.id === ex.id) || false
                    const hintClass = hintClassFor(ex)
                    return (
                        <button
                            key={ex.id}
                            onClick={() => onToggleExtra(ex)}
                            className={`shrink-0 h-[34px] px-3 rounded-[10px] border font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase flex items-center gap-1.5 ${on ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'} ${hintClass}`}
                        >
                            {on && <span className="w-1.5 h-1.5 rounded-full bg-warning mb-[1px]" />}
                            {ex.name}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

export default function MenuGrid({ products, cart, activeItem, onAddItem, onCancelHeld, productExtras, onToggleExtra, enabledStickyExtraIds = [], onToggleStickyExtra, hintProductId, hintExtraName = null, dineIn = false }) {
    const navigate = useNavigate()
    const { isManager, isAdmin } = useAuth()
    const { loading, loadError } = useProducts()
    const canSetup = isManager || isAdmin

    // PERF: index cart qty by productId once per cart change.
    // Was: cart.filter().reduce() called per product per render — O(N×M).
    const cartQtyMap = useMemo(() => {
        const map = new Map()
        for (const item of cart) {
            map.set(item.productId, (map.get(item.productId) || 0) + item.quantity)
        }
        return map
    }, [cart])

    // Active (held) item whose extras show — computed once by POSPage (its parent) and
    // passed down, since POSPage needs the same value for onboarding progress tracking.
    const activeProductId = activeItem?.productId
    const activeExtras = productExtras?.[activeProductId] || []
    const activeIdx = activeExtras.length > 0 ? products.findIndex(p => p.id === activeProductId) : -1
    // Insert the extras bar after the END of the active card's row (its right-col
    // neighbour, or the card itself if it's right-col / last) so the full-width
    // span drops to a fresh row with no empty grid slot beside it.
    const extrasAfterIdx = computeExtrasAfterIdx(products, activeIdx)

    // every([]) = true → giữ hành vi menu rỗng; menu chỉ toàn divider cũng coi là chưa có món
    if (products.every(p => p.is_divider)) {
        const isLoading = loading
        const hasError = !!loadError
        const title = isLoading
            ? 'Đang tải menu…'
            : hasError
                ? 'Không tải được menu'
                : 'Chưa có món nào trong menu'
        const description = isLoading
            ? 'Vui lòng chờ giây lát.'
            : hasError
                ? (navigator.onLine
                    ? 'Có lỗi khi tải dữ liệu. Thử tải lại trang.'
                    : 'Đang offline. Khi có mạng dữ liệu sẽ tự đồng bộ.')
                : (canSetup
                    ? 'Thiết lập menu và công thức để bắt đầu bán hàng.'
                    : 'Liên hệ quản lý để được thiết lập menu.')

        return (
            <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-6 pb-6 pt-5 flex items-center justify-center hide-scrollbar">
                <div className="bg-surface border border-border/60 rounded-[24px] p-6 max-w-sm w-full text-center shadow-sm">
                    <div className="text-[15px] font-black text-text mb-1.5">{title}</div>
                    <div className="text-[13px] text-text-secondary mb-4 leading-relaxed">{description}</div>
                    {!isLoading && hasError && (
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-3 rounded-[12px] bg-primary text-bg font-black text-[14px] hover:bg-primary/90 active:bg-primary/80 transition-colors uppercase"
                        >
                            Tải lại
                        </button>
                    )}
                    {!isLoading && !hasError && canSetup && (
                        <button
                            onClick={() => navigate('/recipes', { state: { from: '/pos' } })}
                            className="w-full py-3 rounded-[12px] bg-primary text-bg font-black text-[14px] hover:bg-primary/90 active:bg-primary/80 transition-colors uppercase"
                        >
                            Thiết lập menu
                        </button>
                    )}
                </div>
            </main>
        )
    }

    const gridItems = []
    products.forEach((product, idx) => {
        gridItems.push(product.is_divider ? (
            <MenuDivider key={product.id} name={product.name} />
        ) : (
            <ProductCard
                key={product.id}
                product={product}
                qty={cartQtyMap.get(product.id) || 0}
                onAdd={onAddItem}
                onCancel={onCancelHeld}
                hint={product.id === hintProductId}
                showQty={dineIn}
            />
        ))
        if (idx === extrasAfterIdx) {
            gridItems.push(
                <ExtrasPopover
                    key="extras"
                    activeProductId={activeProductId}
                    extras={activeExtras}
                    activeItem={activeItem}
                    enabledStickyExtraIds={enabledStickyExtraIds}
                    onToggleExtra={onToggleExtra}
                    onToggleStickyExtra={onToggleStickyExtra}
                    hintExtraName={hintExtraName}
                />
            )
        }
    })

    return (
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-6 pb-6 pt-5 hide-scrollbar">
            <div className="grid grid-cols-2 gap-4 pt-1">
                {gridItems}
            </div>
        </main>
    )
}
