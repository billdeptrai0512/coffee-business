import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID, Row } from '../types/domain'

// Chương trình giảm giá tự động theo lịch — thực thể toàn cục theo địa chỉ (không product_id),
// gắn vào nhiều món qua discount_program_products. Mirrors toppingService.ts (Topping <->
// product_toppings) — xem plan "Chương trình giảm giá tự động theo lịch".

export async function fetchDiscountPrograms(addressId: UUID | null) {
    if (localRepo.isGuest()) return localRepo.fetchLocalDiscountPrograms(addressId)
    if (!supabase || !addressId) return []
    const { data, error } = await supabase
        .from('discount_programs')
        .select('id, address_id, name, type, value, days_of_week, start_date, end_date, enabled')
        .eq('address_id', addressId)
        .order('created_at', { ascending: true })
    if (error) {
        console.error('fetchDiscountPrograms error:', error)
        return []
    }
    return data || []
}

export async function insertDiscountProgram(name: string, type: string, value: number, addressId: UUID) {
    if (localRepo.isGuest()) return localRepo.insertLocalDiscountProgram({ name, type, value, address_id: addressId })
    if (!supabase) throw new Error('No Supabase connection')
    const payload: Row = { name, type, value, address_id: addressId }
    const { data, error } = await supabase.from('discount_programs').insert(payload).select().single()
    if (error) throw error
    return data
}

export async function updateDiscountProgram(programId: UUID, patch: Row) {
    if (localRepo.isGuest()) return localRepo.updateLocalDiscountProgram(programId, patch)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('discount_programs').update(patch).eq('id', programId)
    if (error) throw error
}

export async function deleteDiscountProgram(programId: UUID) {
    if (localRepo.isGuest()) return localRepo.deleteLocalDiscountProgram(programId)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('discount_programs').delete().eq('id', programId)
    if (error) throw error
    return true
}

// ---- Discount program <-> product links (nhiều-nhiều, mirrors product_toppings) ----

export async function fetchDiscountProgramProductLinks(programIds: UUID[]) {
    if (localRepo.isGuest()) return localRepo.fetchLocalDiscountProgramProductLinks(programIds)
    if (!supabase) return []
    if (!programIds?.length) return []
    const { data, error } = await supabase
        .from('discount_program_products')
        .select('discount_program_id, product_id')
        .in('discount_program_id', programIds)
    if (error) {
        console.error('fetchDiscountProgramProductLinks error:', error)
        return []
    }
    return data || []
}

// Ghi đè toàn bộ danh sách món của 1 chương trình — xoá hết row cũ rồi insert lại theo danh
// sách mới, mirrors setToppingProductLinks (số lượng nhỏ, đơn giản hơn tính diff).
export async function setDiscountProgramProducts(programId: UUID, productIds: UUID[]) {
    if (localRepo.isGuest()) return localRepo.setLocalDiscountProgramProducts(programId, productIds)
    if (!supabase) throw new Error('No Supabase connection')
    const { error: delError } = await supabase.from('discount_program_products').delete().eq('discount_program_id', programId)
    if (delError) throw delError
    if (productIds.length === 0) return
    const { error: insError } = await supabase
        .from('discount_program_products')
        .insert(productIds.map(productId => ({ product_id: productId, discount_program_id: programId })))
    if (insError) throw insError
}
