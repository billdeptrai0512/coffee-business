import { supabase } from '../lib/supabaseClient'
import { INGREDIENT_COSTS as DEFAULT_COSTS } from '../constants'

// Demo data used when Supabase is not connected
const DEMO_PRODUCTS = [
    { id: '11111111-1111-1111-1111-111111111101', name: 'Cà phê đen', price: 14000 },
    { id: '11111111-1111-1111-1111-111111111102', name: 'Cà phê sữa', price: 16000 },
    { id: '11111111-1111-1111-1111-111111111103', name: 'Bạc xỉu', price: 16000 },
    { id: '11111111-1111-1111-1111-111111111104', name: 'Sữa tươi cà phê', price: 16000 },
    { id: '11111111-1111-1111-1111-111111111105', name: 'Cà phê muối', price: 19000 },
    { id: '11111111-1111-1111-1111-111111111106', name: 'Americano', price: 14000 },
    { id: '11111111-1111-1111-1111-111111111107', name: 'Cacao sữa', price: 21000 },
    { id: '11111111-1111-1111-1111-111111111108', name: 'Matcha Latte', price: 21000 },
    { id: '11111111-1111-1111-1111-111111111109', name: 'Cacao cà phê', price: 24000 },
    { id: '11111111-1111-1111-1111-111111111110', name: 'Matcha kem muối', price: 27000 },
]

export const DEMO_RECIPES = [
    // 1. Cà phê đen (101)
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'lid', amount: 1 },

    // 2. Cà phê sữa (102)
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'lid', amount: 1 },

    // 3. Bạc xỉu (103)
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'coffee_g', amount: 10 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'fresh_milk_ml', amount: 50 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'condensed_milk_ml', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'lid', amount: 1 },

    // 4. Sữa tươi cà phê (104)
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'coffee_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'fresh_milk_ml', amount: 60 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'sugar_g', amount: 10 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'lid', amount: 1 },

    // 5. Cà phê muối (105)
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'salt_cream_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'lid', amount: 1 },

    // 6. Americano (106)
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'lid', amount: 1 },

    // 7. Cacao sữa (107)
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'cacao_powder_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'fresh_milk_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'lid', amount: 1 },

    // 8. Matcha Latte (108)
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'matcha_powder_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'condensed_milk_ml', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'fresh_milk_ml', amount: 60 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'lid', amount: 1 },

    // 9. Cacao cà phê (109)
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'coffee_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'cacao_powder_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'fresh_milk_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'lid', amount: 1 },

    // 10. Matcha kem muối (110)
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'matcha_powder_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'condensed_milk_ml', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'fresh_milk_ml', amount: 60 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'salt_cream_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'lid', amount: 1 },
]

const DEMO_INVENTORY = {
    coffee_g: 2000,
    condensed_milk_ml: 3000,
    fresh_milk_ml: 5000,
    salt_cream_ml: 1000,
    sugar_g: 2000,
    cacao_powder_g: 1000,
    matcha_powder_g: 1000,
    tea_bag: 100,
    peach_syrup_ml: 2000,
    lychee_syrup_ml: 2000,
    orange: 50,
    cup: 200,
    lid: 200,
}

// Fetch all products for the menu
export async function fetchProducts(addressId) {
    if (!supabase) return DEMO_PRODUCTS
    let { data: prods, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name')

    if (error) {
        // Fallback if is_active column doesn't exist yet (42703 = undefined column)
        if (error.code === '42703') {
            const { data: fallbackProds } = await supabase.from('products').select('*').order('name')
            prods = fallbackProds
        } else {
            console.error('fetchProducts error:', error)
            return DEMO_PRODUCTS
        }
    }

    const products = prods.length > 0 ? prods : DEMO_PRODUCTS

    if (addressId) {
        // Fetch explicit price overrides for this address
        const { data: prices } = await supabase
            .from('product_prices')
            .select('product_id, price')
            .eq('address_id', addressId)

        if (prices && prices.length > 0) {
            const priceMap = {}
            for (let p of prices) priceMap[p.product_id] = p.price
            return products.map(prod => ({
                ...prod,
                price: priceMap[prod.id] !== undefined ? priceMap[prod.id] : prod.price
            }))
        }
    }

    return products
}

// Upsert a product price override for a specific address
export async function upsertProductPrice(productId, addressId, price) {
    if (!supabase) return
    const { data: existing } = await supabase
        .from('product_prices')
        .select('id')
        .eq('product_id', productId)
        .eq('address_id', addressId)
        .maybeSingle()

    if (existing) {
        await supabase.from('product_prices').update({ price }).eq('id', existing.id)
    } else {
        await supabase.from('product_prices').insert({ product_id: productId, address_id: addressId, price })
    }
}

// Fetch today's total revenue (optionally scoped by address)
export async function fetchTodayRevenue(addressId) {
    if (!supabase) return 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let query = supabase
        .from('orders')
        .select('total')
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query

    if (error) {
        console.error('fetchTodayRevenue error:', error)
        return 0
    }
    return data.reduce((sum, o) => sum + o.total, 0)
}

// Fetch today's total cups sold (optionally scoped by address)
export async function fetchTodayCupsSold(addressId) {
    if (!supabase) return 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let query = supabase
        .from('orders')
        .select('id')
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data: orders, error: ordersError } = await query

    if (ordersError || !orders?.length) return 0

    const orderIds = orders.map(o => o.id)
    const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('quantity')
        .in('order_id', orderIds)

    if (itemsError) {
        console.error('fetchTodayCupsSold items error:', itemsError)
        return 0
    }

    return items.reduce((sum, i) => sum + i.quantity, 0)
}

// Fetch all orders for today, newest first (optionally scoped by address)
export async function fetchTodayOrders(addressId) {
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let query = supabase
        .from('orders')
        .select(`
            id,
            total,
            payment_method,
            created_at,
            order_items (
                quantity,
                options,
                product_id,
                products (
                    name
                )
            )
        `)
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
        console.error('fetchTodayOrders error:', error)
        return []
    }
    return data
}

// Fetch current inventory (Disabled for now)
export async function fetchInventory() {
    return { ...DEMO_INVENTORY }
}

// Fetch all recipes from Supabase, fallback to demo
export async function fetchAllRecipes(addressId) {
    if (!supabase) return DEMO_RECIPES
    let query = supabase.from('recipes').select('product_id, ingredient, amount, address_id')

    if (addressId) {
        query = query.or(`address_id.eq.${addressId},address_id.is.null`)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchAllRecipes error:', error)
        return DEMO_RECIPES
    }

    if (!data || data.length === 0) return DEMO_RECIPES

    // Group defaults by productId
    const defaultData = data.filter(d => d.address_id === null)
    const addressData = data.filter(d => d.address_id === addressId)

    const addressProductIds = new Set(addressData.map(d => d.product_id))

    const finalRecipes = []
    finalRecipes.push(...addressData)

    for (const d of defaultData) {
        if (!addressProductIds.has(d.product_id)) {
            finalRecipes.push(d)
        }
    }

    return finalRecipes.length > 0 ? finalRecipes : DEMO_RECIPES
}

// Fetch recipes for a list of product IDs
export async function fetchRecipes(productIds) {
    if (!supabase) return DEMO_RECIPES.filter(r => productIds.includes(r.product_id))
    const { data, error } = await supabase
        .from('recipes')
        .select('product_id, ingredient, amount')
        .in('product_id', productIds)
    if (error) {
        console.error('fetchRecipes error:', error)
        return DEMO_RECIPES.filter(r => productIds.includes(r.product_id))
    }
    return data
}

// Fetch ingredient costs from Supabase, fallback to constants
export async function fetchIngredientCosts(addressId) {
    if (!supabase) return { ...DEFAULT_COSTS }
    let query = supabase.from('ingredient_costs').select('ingredient, unit_cost, address_id')

    if (addressId) {
        query = query.or(`address_id.eq.${addressId},address_id.is.null`)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchIngredientCosts error:', error)
        return { ...DEFAULT_COSTS }
    }
    if (!data || data.length === 0) return { ...DEFAULT_COSTS }

    const costs = { ...DEFAULT_COSTS }
    const defaultData = data.filter(d => d.address_id === null)
    const addressData = data.filter(d => d.address_id === addressId)

    for (const d of defaultData) costs[d.ingredient] = d.unit_cost
    for (const d of addressData) costs[d.ingredient] = d.unit_cost

    return costs
}

// Utility to ensure an address has a copy of the default recipe for a product before modifying
async function ensureAddressRecipe(productId, addressId) {
    if (!supabase || !addressId) return

    const { data } = await supabase
        .from('recipes')
        .select('id')
        .eq('product_id', productId)
        .eq('address_id', addressId)
        .limit(1)

    if (!data || data.length === 0) {
        // clone default recipe for this product
        const { data: defaults } = await supabase
            .from('recipes')
            .select('product_id, ingredient, amount')
            .eq('product_id', productId)
            .is('address_id', null)

        if (defaults && defaults.length > 0) {
            const inserts = defaults.map(d => ({ ...d, address_id: addressId }))
            await supabase.from('recipes').insert(inserts)
        }
    }
}

// Upsert a recipe row (insert or update ingredient amount for a product)
export async function upsertRecipe(productId, ingredient, amount, addressId = null) {
    if (!supabase) throw new Error('No Supabase connection')

    if (addressId) {
        await ensureAddressRecipe(productId, addressId)
    }

    let query = supabase
        .from('recipes')
        .select('id')
        .eq('product_id', productId)
        .eq('ingredient', ingredient)

    if (addressId) query = query.eq('address_id', addressId)
    else query = query.is('address_id', null)

    const { data: existing } = await query.maybeSingle()

    if (existing) {
        const { error } = await supabase
            .from('recipes')
            .update({ amount })
            .eq('id', existing.id)
        if (error) throw error
    } else {
        const payload = { product_id: productId, ingredient, amount }
        if (addressId) payload.address_id = addressId
        const { error } = await supabase
            .from('recipes')
            .insert(payload)
        if (error) throw error
    }
}

// Delete a recipe row
export async function deleteRecipeRow(productId, ingredient, addressId = null) {
    if (!supabase) throw new Error('No Supabase connection')
    if (addressId) {
        await ensureAddressRecipe(productId, addressId)
    }

    let query = supabase
        .from('recipes')
        .delete()
        .eq('product_id', productId)
        .eq('ingredient', ingredient)

    if (addressId) query = query.eq('address_id', addressId)
    else query = query.is('address_id', null)

    const { error } = await query
    if (error) throw error
}

// Upsert an ingredient cost
export async function upsertIngredientCost(ingredient, unitCost, addressId = null) {
    if (!supabase) throw new Error('No Supabase connection')

    let query = supabase.from('ingredient_costs').select('id').eq('ingredient', ingredient)
    if (addressId) query = query.eq('address_id', addressId)
    else query = query.is('address_id', null)

    const { data: existing } = await query.maybeSingle()

    if (existing) {
        const { error } = await supabase.from('ingredient_costs').update({ unit_cost: unitCost }).eq('id', existing.id)
        if (error) throw error
    } else {
        const payload = { ingredient, unit_cost: unitCost }
        if (addressId) payload.address_id = addressId
        const { error } = await supabase.from('ingredient_costs').insert(payload)
        if (error) throw error
    }
}

// Create a new product
export async function insertProduct(name, price) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('products')
        .insert({ name, price })
        .select()
        .single()
    if (error) throw error
    return data
}

// Delete a product (soft delete)
export async function deleteProduct(productId) {
    if (!supabase) throw new Error('No Supabase connection')

    // 1. Attempt soft delete first (preserves history and order items)
    const { error: softError } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', productId)

    if (softError) {
        if (softError.code === '42703') {
            // Fallback: column doesn't exist yet. Attempt hard delete.
            const { error: priceError } = await supabase.from('product_prices').delete().eq('product_id', productId)
            if (priceError) throw priceError

            const { error: recipeError } = await supabase.from('recipes').delete().eq('product_id', productId)
            if (recipeError) throw recipeError

            const { error: hardError } = await supabase.from('products').delete().eq('id', productId)
            if (hardError) throw hardError
        } else {
            throw softError
        }
    }

    return true
}

// Submit a complete order to Supabase
// cart: [{ cartItemId, productId, quantity, basePrice, extras }]
export async function submitOrder(cart, total, paymentMethod = null, addressId = null) {
    if (!supabase) throw new Error('No Supabase connection')

    // 1. Insert order (with payment_method and address_id at order level)
    const orderPayload = { total }
    if (paymentMethod) orderPayload.payment_method = paymentMethod
    if (addressId) orderPayload.address_id = addressId

    const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert(orderPayload)
        .select()
        .single()

    if (orderError) throw orderError

    // 2. Insert order items
    const items = cart.map(item => {
        const payload = {
            order_id: order.id,
            product_id: item.productId,
            quantity: item.quantity,
        }

        // Append options text if the user selected any extras (excludes payment method)
        const optionsText = item.extras?.length > 0 ? item.extras.map(e => e.name).join(', ') : null;
        if (optionsText) {
            payload.options = optionsText;
        }

        return payload;
    })

    if (items.length > 0) {
        const { error: itemsError } = await supabase
            .from('order_items')
            .insert(items)

        if (itemsError) {
            // Cleanup partial order to avoid duplicate accumulation offline
            await supabase.from('orders').delete().eq('id', order.id)
            throw itemsError
        }
    }

    // 3. Inventory calculation disabled for now

    return order
}

// Delete an order and its items (for duplicate order cleanup)
export async function deleteOrder(orderId) {
    if (!supabase) throw new Error('No Supabase connection')

    // Delete order_items first (FK constraint)
    const { error: itemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId)

    if (itemsError) throw itemsError

    const { error: orderError } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId)

    if (orderError) throw orderError

    return true
}
