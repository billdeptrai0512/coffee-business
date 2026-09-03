import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID, Row } from '../types/domain'

// Fetch all recipes from Supabase (Pure isolated by address)
export async function fetchAllRecipes(addressId: UUID | null) {
    if (localRepo.isGuest()) return localRepo.fetchLocalRecipes(addressId)
    if (!supabase) return []
    let query = supabase.from('recipes').select('product_id, ingredient, amount, unit, address_id')

    if (addressId) {
        query = query.eq('address_id', addressId)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchAllRecipes error:', error)
        return []
    }

    return data || []
}

// Upsert a recipe row (insert or update ingredient amount for a product)
export async function upsertRecipe(productId: UUID, ingredient: string, amount: number, addressId: UUID | null = null, unit: string | null = null) {
    if (localRepo.isGuest()) return localRepo.upsertLocalRecipe({ product_id: productId, ingredient, amount, address_id: addressId, unit })
    if (!supabase) throw new Error('No Supabase connection')

    const payload: Row = { product_id: productId, ingredient, amount }
    if (unit) payload.unit = unit
    if (addressId) payload.address_id = addressId

    const { error } = await supabase
        .from('recipes')
        .upsert(payload, { onConflict: 'product_id,ingredient,address_id' })
    if (error) throw error
}

// Batch upsert — same table/onConflict as upsertRecipe, one round trip for N rows.
// Use for bulk operations (recipe copy, adding several ingredients at once) that would
// otherwise fire one request per row.
export async function upsertRecipes(rows: Array<{ productId: UUID, ingredient: string, amount: number, addressId?: UUID | null, unit?: string | null }>) {
    if (rows.length === 0) return
    if (localRepo.isGuest()) {
        for (const r of rows) {
            await localRepo.upsertLocalRecipe({ product_id: r.productId, ingredient: r.ingredient, amount: r.amount, address_id: r.addressId ?? null, unit: r.unit ?? null })
        }
        return
    }
    if (!supabase) throw new Error('No Supabase connection')

    const payload: Row[] = rows.map(r => {
        const row: Row = { product_id: r.productId, ingredient: r.ingredient, amount: r.amount }
        if (r.unit) row.unit = r.unit
        if (r.addressId) row.address_id = r.addressId
        return row
    })
    const { error } = await supabase
        .from('recipes')
        .upsert(payload, { onConflict: 'product_id,ingredient,address_id' })
    if (error) throw error
}

// Delete a recipe row
export async function deleteRecipeRow(productId: UUID, ingredient: string, addressId: UUID | null = null) {
    if (localRepo.isGuest()) return localRepo.deleteLocalRecipeRow(productId, ingredient)
    if (!supabase) throw new Error('No Supabase connection')

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
