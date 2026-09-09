import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { fetchToppings, fetchProductToppingLinks } from '../services/toppingService'
import { fetchDiscountPrograms, fetchDiscountProgramProductLinks } from '../services/discountService'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
import { supabase } from '../lib/supabaseClient'
import { Outlet } from 'react-router-dom'
import { cacheKey as buildCacheKey } from '../constants/storageKeys'
import { onTabReturn } from '../utils/tabVisibility'

const ProductContext = createContext(null)

// A quán-wifi blip during the one-shot product fetch used to require reopening
// the app (remounting ProductProvider) to recover — nothing else retried it.
// Bounded retry (same pattern as AuthContext's profile fetch) absorbs a
// transient failure without user intervention.
// toppings là thực thể toàn cục (không product_id) — dựng map productId -> Topping[]
// từ bảng nối product_toppings để POS/MenuGrid dùng y hệt cách đọc productExtras.
function buildProductToppingsMap(toppings, links) {
    const byId = new Map(toppings.map(t => [t.id, t]))
    const map = {}
    for (const link of links) {
        const topping = byId.get(link.topping_id)
        if (!topping) continue
        if (!map[link.product_id]) map[link.product_id] = []
        map[link.product_id].push(topping)
    }
    return map
}

// discountPrograms là thực thể toàn cục theo địa chỉ (không product_id) — dựng map
// productId -> DiscountProgram[] từ bảng nối discount_program_products, mirrors
// buildProductToppingsMap ở trên.
function buildProductDiscountsMap(programs, links) {
    const byId = new Map(programs.map(p => [p.id, p]))
    const map = {}
    for (const link of links) {
        const program = byId.get(link.discount_program_id)
        if (!program) continue
        if (!map[link.product_id]) map[link.product_id] = []
        map[link.product_id].push(program)
    }
    return map
}

async function fetchProductDataWithRetry(addressId, attempts = 3, delayMs = 800) {
    let lastError
    for (let i = 0; i < attempts; i++) {
        try {
            const [prods, recs, costsResult, extras, toppings, discountPrograms] = await Promise.all([
                fetchProducts(addressId),
                fetchAllRecipes(addressId),
                fetchIngredientCostsAndUnits(addressId),
                fetchProductExtras(addressId),
                fetchToppings(addressId),
                fetchDiscountPrograms(addressId),
            ])
            const extraIds = Object.values(extras).flat().map(e => e.id)
            const [extraIngs, toppingLinks, discountLinks] = await Promise.all([
                fetchExtraIngredients(extraIds),
                fetchProductToppingLinks(toppings.map(t => t.id)),
                fetchDiscountProgramProductLinks(discountPrograms.map(p => p.id)),
            ])
            return {
                prods, recs, costsResult, extras, extraIngs, toppings,
                productToppings: buildProductToppingsMap(toppings, toppingLinks),
                discountPrograms, productDiscounts: buildProductDiscountsMap(discountPrograms, discountLinks),
            }
        } catch (error) {
            lastError = error
            if (i < attempts - 1) await new Promise(res => setTimeout(res, delayMs))
        }
    }
    throw lastError
}

// ponytail: hook co-located with its Provider (standard context pattern) —
// splitting into its own file isn't worth the diff for a fast-refresh (dev-only HMR) nag.
// eslint-disable-next-line react-refresh/only-export-components
export function useProducts() {
    const ctx = useContext(ProductContext)
    if (!ctx) throw new Error('useProducts must be used within ProductProvider')
    return ctx
}

export function ProductProvider() {
    const { profile } = useAuth()
    const activeManagerId = profile?.role === 'manager' ? profile.id : profile?.manager_id
    const { selectedAddress } = useAddress()

    const cacheKey = useCallback((name) => buildCacheKey(selectedAddress?.id || 'default', name), [selectedAddress?.id])

    const readCache = useCallback((name, fallback) => {
        try {
            const cached = localStorage.getItem(cacheKey(name))
            return cached ? JSON.parse(cached) : fallback
        } catch { return fallback }
    }, [cacheKey])

    const [products, setProducts] = useState(() => readCache('products', []))
    const [recipes, setRecipes] = useState(() => readCache('recipes', []))
    const [ingredientCosts, setIngredientCosts] = useState(() => readCache('costs', {}))
    const [ingredientUnits, setIngredientUnits] = useState(() => readCache('units', {}))
    const [ingredientConfigs, setIngredientConfigs] = useState(() => readCache('configs', []))
    const [productExtras, setProductExtras] = useState(() => readCache('extras', {}))
    const [extraIngredients, setExtraIngredients] = useState(() => readCache('extra_ingredients', {}))
    const [toppings, setToppings] = useState(() => readCache('toppings', []))
    const [productToppings, setProductToppings] = useState(() => readCache('product_toppings', {}))
    const [discountPrograms, setDiscountPrograms] = useState(() => readCache('discount_programs', []))
    const [productDiscounts, setProductDiscounts] = useState(() => readCache('product_discounts', {}))
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(null)
    const loadGenRef = useRef(0) // bumped each effect run so a stale retry can no-op instead of writing over a newer address's data

    const applyData = useCallback((prods, recs, costsResult, extras, extraIngs, addressId, toppingsList, productToppingsMap, discountProgramsList, productDiscountsMap) => {
        const { costs, units, rows } = costsResult
        setProducts(prods)
        setRecipes(recs)
        setIngredientCosts(costs)
        setIngredientUnits(units)
        setIngredientConfigs(rows || [])
        setProductExtras(extras)
        setExtraIngredients(extraIngs)
        setToppings(toppingsList)
        setProductToppings(productToppingsMap)
        setDiscountPrograms(discountProgramsList)
        setProductDiscounts(productDiscountsMap)
        try {
            const key = (name) => buildCacheKey(addressId || 'default', name)
            localStorage.setItem(key('products'), JSON.stringify(prods))
            localStorage.setItem(key('recipes'), JSON.stringify(recs))
            localStorage.setItem(key('costs'), JSON.stringify(costs))
            localStorage.setItem(key('units'), JSON.stringify(units))
            localStorage.setItem(key('configs'), JSON.stringify(rows || []))
            localStorage.setItem(key('extras'), JSON.stringify(extras))
            localStorage.setItem(key('extra_ingredients'), JSON.stringify(extraIngs))
            localStorage.setItem(key('toppings'), JSON.stringify(toppingsList))
            localStorage.setItem(key('product_toppings'), JSON.stringify(productToppingsMap))
            localStorage.setItem(key('discount_programs'), JSON.stringify(discountProgramsList))
            localStorage.setItem(key('product_discounts'), JSON.stringify(productDiscountsMap))
        } catch { /* ignore quota errors */ }
    }, [])

    useEffect(() => {
        const addressId = selectedAddress?.id
        const gen = ++loadGenRef.current

        // Instantly apply address-specific cache while fresh data loads. This is
        // also the offline-fallback path: if the fetch below fails (no network at
        // shift-open), this cache-hydrated state is simply left in place — the POS
        // screen still shows the last-known menu/prices/extras and orders queue
        // into the existing offline-order mechanism.
        setProducts(readCache('products', []))
        setRecipes(readCache('recipes', []))
        setIngredientCosts(readCache('costs', {}))
        setIngredientUnits(readCache('units', {}))
        setIngredientConfigs(readCache('configs', []))
        setProductExtras(readCache('extras', {}))
        setExtraIngredients(readCache('extra_ingredients', {}))
        setToppings(readCache('toppings', []))
        setProductToppings(readCache('product_toppings', {}))
        setDiscountPrograms(readCache('discount_programs', []))
        setProductDiscounts(readCache('product_discounts', {}))

        async function load() {
            try {
                setLoading(true)
                setLoadError(null)
                const {
                    prods, recs, costsResult, extras, extraIngs, toppings: toppingsList, productToppings: productToppingsMap,
                    discountPrograms: discountProgramsList, productDiscounts: productDiscountsMap,
                } = await fetchProductDataWithRetry(addressId)
                if (loadGenRef.current !== gen) return // a newer address/profile change superseded this fetch
                applyData(prods, recs, costsResult, extras, extraIngs, addressId, toppingsList, productToppingsMap, discountProgramsList, productDiscountsMap)
            } catch (error) {
                // Offline-at-shift-open fallback: deliberately do NOT clear products/
                // recipes/etc here. They're already holding the cache snapshot set
                // above, so the POS screen keeps showing the last-known menu/prices
                // instead of going blank. loadError only drives the UI copy ("offline,
                // will sync" vs "no menu yet") — see MenuGrid.
                console.error('Failed to load product data', error)
                setLoadError(error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [activeManagerId, selectedAddress?.id, applyData, readCache])

    const refreshProducts = useCallback(async () => {
        const addressId = selectedAddress?.id
        // Snapshot the generation so a slow refresh (e.g. the online-retry below,
        // which can be in flight for a while on a bad connection) can't clobber a
        // newer address's data if the user switches addresses before it resolves.
        const gen = loadGenRef.current
        const [prods, recs, costsResult, extras, toppingsList, discountProgramsList] = await Promise.all([
            fetchProducts(addressId),
            fetchAllRecipes(addressId),
            fetchIngredientCostsAndUnits(addressId),
            fetchProductExtras(addressId),
            fetchToppings(addressId),
            fetchDiscountPrograms(addressId),
        ])
        const extraIds = Object.values(extras).flat().map(e => e.id)
        const [extraIngs, toppingLinks, discountLinks] = await Promise.all([
            fetchExtraIngredients(extraIds),
            fetchProductToppingLinks(toppingsList.map(t => t.id)),
            fetchDiscountProgramProductLinks(discountProgramsList.map(p => p.id)),
        ])
        if (loadGenRef.current !== gen) return
        applyData(
            prods, recs, costsResult, extras, extraIngs, addressId, toppingsList, buildProductToppingsMap(toppingsList, toppingLinks),
            discountProgramsList, buildProductDiscountsMap(discountProgramsList, discountLinks),
        )
    }, [selectedAddress?.id, applyData])

    // Genuinely-offline case: retries above gave up, then connectivity actually
    // comes back while the tab stays open (no visibilitychange to trigger the
    // other effect's refetch below) — reconcile without waiting for a reload.
    useEffect(() => {
        if (!loadError) return
        const onOnline = () => { refreshProducts().then(() => setLoadError(null)).catch(() => { }) }
        window.addEventListener('online', onOnline)
        return () => window.removeEventListener('online', onOnline)
    }, [loadError, refreshProducts])

    // Refresh menu/recipe/cost/extras when tab becomes visible again.
    // Replaces a per-address realtime channel that previously held an open
    // WebSocket subscription on 4 tables for every signed-in client. Product
    // data changes infrequently, so an on-focus refetch is sufficient.
    useEffect(() => {
        if (!supabase || !selectedAddress?.id) return

        // Only refetch the 5 product tables if the tab was actually away for a
        // while. Without this, every quick app-switch / lock-screen fires a herd
        // of reads that saturates a flaky connection (a key "lag after foreground"
        // aggravator). Product data changes infrequently → 30s is plenty.
        return onTabReturn(() => refreshProducts().catch(() => { }))
    }, [selectedAddress?.id, refreshProducts])

    const value = useMemo(() => ({
        products,
        recipes,
        ingredientCosts,
        ingredientUnits,
        ingredientConfigs,
        productExtras,
        extraIngredients,
        toppings,
        productToppings,
        discountPrograms,
        productDiscounts,
        refreshProducts,
        loading,
        loadError
    }), [products, recipes, ingredientCosts, ingredientUnits, ingredientConfigs, productExtras, extraIngredients, toppings, productToppings, discountPrograms, productDiscounts, refreshProducts, loading, loadError])

    return (
        <ProductContext.Provider value={value}>
            <Outlet />
        </ProductContext.Provider>
    )
}
