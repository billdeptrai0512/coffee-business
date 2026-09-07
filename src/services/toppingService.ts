import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { upsertIngredientCost } from './ingredientCostService'
import { normalizeIngredientKey } from '../utils/ingredients'
import type { UUID, Row } from '../types/domain'

// ---- Toppings CRUD ----
// Thực thể toàn cục (không product_id) — mirrors product_extras nhưng gắn vào nhiều món
// qua product_toppings thay vì 1-1. Xem CLAUDE.md/plan: tồn kho topping KHÔNG suy từ
// topping_ingredients, nó là 1 dòng ingredient_costs độc lập cùng tên (đếm tay ở kiểm kê).

export async function fetchToppings(addressId: UUID | null) {
    if (localRepo.isGuest()) return localRepo.fetchLocalToppings(addressId)
    if (!supabase) return []
    let query = supabase.from('toppings').select('id, name, price, address_id, sort_order').order('sort_order', { ascending: true, nullsFirst: false })

    if (addressId) query = query.eq('address_id', addressId)
    else query = query.is('address_id', null)

    const { data, error } = await query
    if (error) {
        console.error('fetchToppings error:', error)
        return []
    }
    return data || []
}

// Tạo topping mới + đăng ký luôn 1 dòng ingredient_costs cùng tên (normalize key như mọi
// nguyên liệu khác) để nó xuất hiện ngay trong màn kiểm kê, không cần thao tác gì thêm.
export async function insertTopping(name: string, price: number, addressId: UUID | null, unit: string = 'đv') {
    const ingredientKey = normalizeIngredientKey(name)
    await upsertIngredientCost(ingredientKey, 0, addressId, unit)

    if (localRepo.isGuest()) return localRepo.insertLocalTopping({ name, price, address_id: addressId })
    if (!supabase) throw new Error('No Supabase connection')
    const payload: Row = { name, price }
    if (addressId) payload.address_id = addressId

    let maxQuery = supabase.from('toppings').select('sort_order')
    maxQuery = addressId ? maxQuery.eq('address_id', addressId) : maxQuery.is('address_id', null)
    const { data: maxRow } = await maxQuery.order('sort_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    payload.sort_order = (maxRow?.sort_order ?? -1) + 1

    const { data, error } = await supabase.from('toppings').insert(payload).select().single()
    if (error) throw error
    return data
}

export async function updateToppingName(toppingId: UUID, name: string) {
    if (localRepo.isGuest()) return localRepo.updateLocalToppingName(toppingId, name)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('toppings').update({ name }).eq('id', toppingId)
    if (error) throw error
}

export async function updateToppingPrice(toppingId: UUID, price: number) {
    if (localRepo.isGuest()) return localRepo.updateLocalToppingPrice(toppingId, price)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('toppings').update({ price }).eq('id', toppingId)
    if (error) throw error
}

export async function deleteTopping(toppingId: UUID) {
    if (localRepo.isGuest()) return localRepo.deleteLocalTopping(toppingId)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('toppings').delete().eq('id', toppingId)
    if (error) throw error
    return true
}

// ---- Topping Ingredients CRUD (công thức riêng của topping — mirrors recipes) ----

export async function fetchToppingIngredients(toppingIds: UUID[] | null = null) {
    if (localRepo.isGuest()) return localRepo.fetchLocalToppingIngredients(toppingIds)
    if (!supabase) return {}
    if (Array.isArray(toppingIds) && toppingIds.length === 0) return {}

    let query = supabase.from('topping_ingredients').select('id, topping_id, ingredient, amount, unit')
    if (toppingIds?.length) query = query.in('topping_id', toppingIds)

    const { data, error } = await query
    if (error) {
        console.error('fetchToppingIngredients error:', error)
        return {}
    }
    const map: Record<string, Row[]> = {}
    for (const row of data || []) {
        if (!map[row.topping_id]) map[row.topping_id] = []
        map[row.topping_id].push(row)
    }
    return map
}

export async function upsertToppingIngredient(toppingId: UUID, ingredient: string, amount: number, unit: string | null = null) {
    if (localRepo.isGuest()) return localRepo.upsertLocalToppingIngredient({ topping_id: toppingId, ingredient, amount, unit })
    if (!supabase) throw new Error('No Supabase connection')
    const payload: Row = { topping_id: toppingId, ingredient, amount }
    if (unit) payload.unit = unit
    const { error } = await supabase.from('topping_ingredients').upsert(payload, { onConflict: 'topping_id,ingredient' })
    if (error) throw error
}

export async function deleteToppingIngredient(toppingId: UUID, ingredient: string) {
    if (localRepo.isGuest()) return localRepo.deleteLocalToppingIngredient(toppingId, ingredient)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('topping_ingredients').delete().eq('topping_id', toppingId).eq('ingredient', ingredient)
    if (error) throw error
    return true
}

// ---- Product<->Topping links (nhiều-nhiều: món nào dùng topping nào) ----

// Trả về mảng {product_id, topping_id} thô — caller tự dựng map theo chiều cần
// (productId -> toppingIds cho POS, toppingId -> productIds cho màn tick-list).
export async function fetchProductToppingLinks(toppingIds: UUID[]) {
    if (localRepo.isGuest()) return localRepo.fetchLocalProductToppingLinks(toppingIds)
    if (!supabase) return []
    if (!toppingIds?.length) return []
    const { data, error } = await supabase.from('product_toppings').select('product_id, topping_id').in('topping_id', toppingIds)
    if (error) {
        console.error('fetchProductToppingLinks error:', error)
        return []
    }
    return data || []
}

// Ghi đè toàn bộ danh sách món được gắn 1 topping — xoá hết row cũ rồi insert lại theo
// danh sách mới (số lượng nhỏ, đơn giản hơn tính diff).
export async function setToppingProductLinks(toppingId: UUID, productIds: UUID[]) {
    if (localRepo.isGuest()) return localRepo.setLocalToppingProductLinks(toppingId, productIds)
    if (!supabase) throw new Error('No Supabase connection')
    const { error: delError } = await supabase.from('product_toppings').delete().eq('topping_id', toppingId)
    if (delError) throw delError
    if (productIds.length === 0) return
    const { error: insError } = await supabase
        .from('product_toppings')
        .insert(productIds.map(productId => ({ product_id: productId, topping_id: toppingId })))
    if (insError) throw insError
}
