import { useEffect, useRef } from 'react'
import { useCart } from '../contexts/CartContext'
import { useStats } from '../contexts/StatsContext'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import { useOrderOnboardingProgress } from '../hooks/useOrderOnboardingProgress'
import { useNavigate, useLocation } from 'react-router-dom'
import { DAY_NAMES } from '../constants'
import { dateFullVN } from '../utils/dateVN'

import Header from '../components/POSPage/Header'
import MenuGrid from '../components/POSPage/MenuGrid'
import CheckoutBar from '../components/POSPage/CheckoutBar'
import TableModal from '../components/POSPage/TableModal'
import Toast from '../components/POSPage/Toast'

export default function POSPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { isGuest } = useAuth()
    const { products, productExtras, productToppings, productDiscounts } = useProducts()
    const { selectedAddress } = useAddress()
    const {
        cart, activeCartItemId,
        handleAddItem, cancelHeld, handleToggleExtra, handleToggleTopping,
        toast, recentOrders, draftOrder, enterKey,
        enabledStickyExtraIds,
        handleToggleStickyExtra,
        commitHeld,
        dineIn, handleConfirm, tableName,
        hasOrder, discountAmount, finalTotal, setItemDiscount,
    } = useCart()
    const { isOnline } = useStats()
    const { handleLoadHistory } = useHistory()
    const { requestRefresh: requestOnboardingRefresh } = useOnboardingVisibility()
    const addressId = selectedAddress?.id

    // Active (held) item whose extras show. Mirrors the old footer's pick: explicit active
    // id, else the last held item. Computed once here (not also in MenuGrid) and passed down,
    // since both MenuGrid and useOrderOnboardingProgress below need it.
    const activeItem = cart.find(i => i.cartItemId === activeCartItemId) || cart[cart.length - 1]

    // Commit the last held item to DB when leaving the POS screen.
    // Ref keeps the unmount cleanup pointed at the latest commitHeld.
    const flushRef = useRef(commitHeld)
    flushRef.current = commitHeld
    useEffect(() => () => flushRef.current(), [])

    // "BÀN X" trong Nhật ký nhảy vào đây kèm state.openTableDetail (đọc lại ở CheckoutBar/
    // TableModal) để mở thẳng chi tiết bàn đó. location.state sống mãi qua các lần
    // mount/unmount sau đó nếu không dọn — bấm nút chọn bàn khác trên CheckoutBar sẽ vẫn
    // ăn lại state cũ này và mở nhầm bàn. Xài đúng 1 lần rồi xoá.
    useEffect(() => {
        if (location.state?.openTableDetail) navigate('/pos', { replace: true, state: null })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // OnboardingGuide is mounted once at the layout level (not per-page), so it doesn't
    // know a new order landed on its own — nudge it to re-check the "Tạo đơn" step.
    // enterKey (a submit timestamp, null until the first doSubmit) only changes on a
    // real submit, not on the initial recentOrders fetch.
    useEffect(() => { if (enterKey) requestOnboardingRefresh() }, [enterKey, requestOnboardingRefresh])

    const { hintProductId, hintExtraName, showHistoryHint } = useOrderOnboardingProgress({
        isGuest, addressId, products, activeItem, requestOnboardingRefresh,
    })

    // Prefetch the lazy History chunk on mount so "go next" doesn't flash the Suspense
    // fallback while it loads. Same module App.jsx lazy-imports → warms the same chunk.
    useEffect(() => { import('./HistoryPage') }, [])

    const today = new Date()
    const dayName = DAY_NAMES[today.getDay()]
    const dateOnly = dateFullVN(today)

    function handleOpenHistory() {
        // Do NOT commit synchronously here: setCart([]) clears draftOrder, which repaints
        // the journal's ArrowRight for a frame before the route change lands (the "flash").
        // Just navigate — POSPage's unmount effect (flushRef) commits the held order as the
        // page leaves, so the cart (and its Check icon) stays intact until POSPage is gone.
        // handleLoadHistory's fetch resolves after that unmount flush, so its merge still
        // sees the optimistic /history row.
        navigate('/history')
        handleLoadHistory()
    }

    const menuColumn = (
        <>
            <Header
                isOnline={isOnline}
                dayName={dayName}
                dateOnly={dateOnly}
                onOpenHistory={handleOpenHistory}
                addressName={selectedAddress?.name}
                onAddressClick={() => navigate(isGuest ? '/login' : '/addresses')}
                recentOrders={recentOrders}
                draftOrder={draftOrder}
                enterKey={enterKey}
                showOnboardingHint={showHistoryHint}
                dineIn={dineIn}
            />

            <MenuGrid
                products={products}
                cart={cart}
                activeItem={activeItem}
                onAddItem={handleAddItem}
                onCancelHeld={cancelHeld}
                productExtras={productExtras}
                productToppings={productToppings}
                productDiscounts={productDiscounts}
                onToggleExtra={handleToggleExtra}
                onToggleTopping={handleToggleTopping}
                enabledStickyExtraIds={enabledStickyExtraIds}
                onToggleStickyExtra={handleToggleStickyExtra}
                hintProductId={hintProductId}
                hintExtraName={hintExtraName}
                dineIn={dineIn}
            />

            <Toast toast={toast} />
        </>
    )

    if (!dineIn) {
        return (
            <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
                {menuColumn}
            </div>
        )
    }

    // Bàn ngồi trên tablet/foldable (biến thể dine-split, xem index.css): chia đôi
    // màn hình — bên trái vẫn là POS như trên điện thoại, bên phải là lưới chọn bàn
    // luôn hiện (TableModal inline) thay vì phải bấm mở modal, và "Tạo đơn" nằm
    // ngay dưới lưới đó thay vì dưới menu — đỡ một cú liếc chéo cột lúc chốt đơn.
    // .pos-dine-grid (index.css) xếp 3 vùng: left (menu, y hệt điện thoại) | table |
    // checkout — CheckoutBar CHỈ MOUNT MỘT LẦN, "nhảy" chỗ qua grid-area theo
    // breakpoint thay vì phải render 2 bản (2 bản = 2 state độc lập, gập/mở
    // Samsung Z Fold giữa lúc sửa giảm giá là mất thao tác dở dang).
    return (
        <div className="pos-dine-grid h-full">
            <div className="[grid-area:left] flex flex-col h-full min-h-0 max-w-lg mx-auto bg-bg dine-split:max-w-none dine-split:mx-0 dine-split:border-r dine-split:border-border/80">
                {menuColumn}
            </div>

            <div className="pos-table-pane hidden dine-split:flex flex-col min-h-0 [grid-area:table] bg-bg">
                <TableModal inline />
            </div>

            <div className="[grid-area:checkout]">
                <CheckoutBar
                    discountAmount={discountAmount}
                    finalTotal={finalTotal}
                    cart={cart}
                    onItemDiscount={setItemDiscount}
                    tableName={tableName}
                    onConfirm={handleConfirm}
                    disabled={!hasOrder}
                />
            </div>
        </div>
    )
}
