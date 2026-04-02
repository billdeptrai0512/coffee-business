import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

import HistoryView from '../components/HistoryView'

export default function HistoryPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts } = useProducts()
    const { todayOrders, isLoadingHistory, handleDeleteOrder } = usePOS()
    const { isManager } = useAuth()

    return (
        <HistoryView
            todayOrders={todayOrders}
            recipes={recipes}
            products={products}
            ingredientCosts={ingredientCosts}
            isLoadingHistory={isLoadingHistory}
            onBack={() => navigate('/pos')}
            onDeleteOrder={handleDeleteOrder}
            onOpenRecipeManager={isManager ? () => navigate('/recipes') : null}
        />
    )
}
