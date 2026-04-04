import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

import HistoryView from '../components/HistoryView'

export default function HistoryPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleDeleteOrder, handleAddExpense, handleDeleteExpense } = usePOS()
    const { isManager, isAdmin } = useAuth()

    return (
        <HistoryView
            todayOrders={todayOrders}
            todayExpenses={todayExpenses || []}
            recipes={recipes}
            products={products}
            ingredientCosts={ingredientCosts}
            isLoadingHistory={isLoadingHistory}
            onBack={() => navigate('/pos')}
            onDeleteOrder={handleDeleteOrder}
            onOpenRecipeManager={(isManager || isAdmin) ? () => navigate('/recipes') : null}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
        />
    )
}
