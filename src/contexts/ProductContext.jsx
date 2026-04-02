import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchProducts, fetchAllRecipes, fetchIngredientCosts } from '../services/orderService'
import { useAuth } from './AuthContext'
import { Outlet } from 'react-router-dom'

const ProductContext = createContext(null)

export function useProducts() {
    const ctx = useContext(ProductContext)
    if (!ctx) throw new Error('useProducts must be used within ProductProvider')
    return ctx
}

export function ProductProvider() {
    const [products, setProducts] = useState([])
    const [recipes, setRecipes] = useState([])
    const [ingredientCosts, setIngredientCosts] = useState({})
    const [loading, setLoading] = useState(true)

    const { profile } = useAuth()
    const activeManagerId = profile?.role === 'manager' ? profile.id : profile?.manager_id

    useEffect(() => {
        async function load() {
            try {
                setLoading(true)
                const [prods, recs, costs] = await Promise.all([
                    fetchProducts(),
                    fetchAllRecipes(activeManagerId),
                    fetchIngredientCosts(activeManagerId)
                ])
                setProducts(prods)
                setRecipes(recs)
                setIngredientCosts(costs)
            } catch (error) {
                console.error('Failed to load product data', error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [activeManagerId])

    const refreshProducts = useCallback(async () => {
        const [recs, costs] = await Promise.all([
            fetchAllRecipes(activeManagerId),
            fetchIngredientCosts(activeManagerId)
        ])
        setRecipes(recs)
        setIngredientCosts(costs)
    }, [activeManagerId])

    return (
        <ProductContext.Provider value={{
            products,
            recipes,
            ingredientCosts,
            refreshProducts,
            loading
        }}>
            <Outlet />
        </ProductContext.Provider>
    )
}
