import { useEffect } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

import HistoryView from '../components/HistoryView'

export default function HistoryPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleDeleteOrder, handleAddExpense, handleDeleteExpense, handleLoadHistory } = usePOS()
    const { isManager, isAdmin } = useAuth()

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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
