import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchProducts, fetchAllRecipes, fetchIngredientCosts } from '../services/orderService'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
import { Outlet } from 'react-router-dom'

const ProductContext = createContext(null)

export function useProducts() {
    const ctx = useContext(ProductContext)
    if (!ctx) throw new Error('useProducts must be used within ProductProvider')
    return ctx
}

export function ProductProvider() {
    // Read from cache immediately for instant display
    const readCache = (key, fallback) => {
        try {
            const cached = localStorage.getItem(key)
            return cached ? JSON.parse(cached) : fallback
        } catch { return fallback }
    }

    const [products, setProducts] = useState(() => readCache('cache_products', []))
    const [recipes, setRecipes] = useState(() => readCache('cache_recipes', []))
    const [ingredientCosts, setIngredientCosts] = useState(() => readCache('cache_costs', {}))
    const [loading, setLoading] = useState(true)

    const { profile } = useAuth()
    const activeManagerId = profile?.role === 'manager' ? profile.id : profile?.manager_id
    const { selectedAddress } = useAddress()

    useEffect(() => {
        async function load() {
            try {
                if (products.length === 0) setLoading(true)
                const [prods, recs, costs] = await Promise.all([
                    fetchProducts(selectedAddress?.id),
                    fetchAllRecipes(selectedAddress?.id),
                    fetchIngredientCosts(selectedAddress?.id)
                ])
                setProducts(prods)
                setRecipes(recs)
                setIngredientCosts(costs)
                // Update cache
                try {
                    localStorage.setItem('cache_products', JSON.stringify(prods))
                    localStorage.setItem('cache_recipes', JSON.stringify(recs))
                    localStorage.setItem('cache_costs', JSON.stringify(costs))
                } catch { /* ignore quota errors */ }
            } catch (error) {
                console.error('Failed to load product data', error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [activeManagerId, selectedAddress?.id])

    const refreshProducts = useCallback(async () => {
        const [prods, recs, costs] = await Promise.all([
            fetchProducts(selectedAddress?.id),
            fetchAllRecipes(selectedAddress?.id),
            fetchIngredientCosts(selectedAddress?.id)
        ])
        setProducts(prods)
        setRecipes(recs)
        setIngredientCosts(costs)
    }, [activeManagerId, selectedAddress?.id])

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
