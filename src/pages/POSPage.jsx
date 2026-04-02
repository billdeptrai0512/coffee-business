import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useNavigate } from 'react-router-dom'
import { DAY_NAMES } from '../constants'

import Header from '../components/Header'
import MenuGrid from '../components/MenuGrid'
import MiniCart from '../components/MiniCart'
import OrderFooter from '../components/OrderFooter'
import Toast from '../components/Toast'

export default function POSPage() {
    const navigate = useNavigate()
    const { products } = useProducts()
    const { selectedAddress } = useAddress()
    const {
        cart, activeCartItemId, setActiveCartItemId,
        handleAddItem, handleRemoveCartItem, handleToggleExtra, handleConfirm,
        total, hasOrder, isSubmitting,
        revenue, totalCost, cupsSold, isOnline,
        toast, handleLoadHistory,
    } = usePOS()

    // Format date
    const today = new Date()
    const dayName = DAY_NAMES[today.getDay()]
    const dateOnly = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`

    function handleOpenHistory() {
        handleLoadHistory()
        navigate('/history')
    }

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            <Header
                isOnline={isOnline}
                dayName={dayName}
                dateOnly={dateOnly}
                cupsSold={cupsSold}
                revenue={revenue}
                totalCost={totalCost}
                onOpenHistory={handleOpenHistory}
                addressName={selectedAddress?.name}
                onAddressClick={() => navigate('/addresses')}
            />

            <MenuGrid
                products={products}
                cart={cart}
                onAddItem={handleAddItem}
            />

            <MiniCart
                cart={cart}
                activeCartItemId={activeCartItemId}
                onSelectItem={setActiveCartItemId}
                onRemoveItem={handleRemoveCartItem}
            />

            <OrderFooter
                cart={cart}
                activeCartItemId={activeCartItemId}
                total={total}
                hasOrder={hasOrder}
                isSubmitting={isSubmitting}
                onToggleExtra={handleToggleExtra}
                onConfirm={handleConfirm}
            />

            <Toast toast={toast} />
        </div>
    )
}
