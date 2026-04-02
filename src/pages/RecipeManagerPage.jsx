import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'

import RecipeManager from '../components/RecipeManager'

export default function RecipeManagerPage() {
    const navigate = useNavigate()
    const { products, recipes, refreshProducts } = useProducts()

    return (
        <RecipeManager
            products={products}
            recipes={recipes}
            onBack={() => navigate('/history')}
            onDataChanged={refreshProducts}
        />
    )
}
