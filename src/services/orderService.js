import { supabase } from '../lib/supabaseClient'

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

const DEMO_RECIPES = [
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'coffee_g', amount: 10 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'fresh_milk_ml', amount: 50 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'condensed_milk_ml', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'tea_bag', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'peach_syrup_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'tea_bag', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'lychee_syrup_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'orange', amount: 3 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'lid', amount: 1 },
]

const DEMO_INVENTORY = {
    coffee_g: 2000,
    condensed_milk_ml: 3000,
    fresh_milk_ml: 5000,
    tea_bag: 100,
    peach_syrup_ml: 2000,
    lychee_syrup_ml: 2000,
    orange: 50,
    cup: 200,
    lid: 200,
}

// Fetch all products for the menu
export async function fetchProducts() {
    if (!supabase) return DEMO_PRODUCTS
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name')
    if (error) {
        console.error('fetchProducts error:', error)
        return DEMO_PRODUCTS
    }
    return data.length > 0 ? data : DEMO_PRODUCTS
}

// Fetch today's total revenue
export async function fetchTodayRevenue() {
    if (!supabase) return 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
        .from('orders')
        .select('total')
        .gte('created_at', today.toISOString())

    if (error) {
        console.error('fetchTodayRevenue error:', error)
        return 0
    }
    return data.reduce((sum, o) => sum + o.total, 0)
}

// Fetch today's total cups sold
export async function fetchTodayCupsSold() {
    if (!supabase) return 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id')
        .gte('created_at', today.toISOString())

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

// Fetch all orders for today, newest first
export async function fetchTodayOrders() {
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
        .from('orders')
        .select(`
            id,
            total,
            created_at,
            order_items (
                quantity,
                options,
                products (
                    name
                )
            )
        `)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })

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

// Fetch all recipes (Disabled for now)
export async function fetchAllRecipes() {
    return DEMO_RECIPES
}

// Fetch recipes for a list of product IDs (Disabled for now)
export async function fetchRecipes(productIds) {
    return DEMO_RECIPES.filter(r => productIds.includes(r.product_id))
}

// Submit a complete order to Supabase
// cart: [{ cartItemId, productId, quantity, basePrice, extras }]
export async function submitOrder(cart, total) {
    if (!supabase) throw new Error('No Supabase connection')

    // 1. Insert order
    const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({ total })
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

        // Append options text if the user selected any extras
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

        if (itemsError) throw itemsError
    }

    // 3. Inventory calculation disabled for now

    return order
}
