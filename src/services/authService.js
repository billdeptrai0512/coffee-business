import { supabase } from '../lib/supabaseClient'

// Formats username to a dummy email for Supabase Auth
const formatUsernameToEmail = (username) => {
    // Remove spaces and convert to lowercase for the dummy email
    const safeUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')
    return `${safeUsername}@coffee.local`
}

// Sign in with username and password via Supabase Auth
export async function signIn(username, password) {
    if (!supabase) throw new Error('No Supabase connection')
    const email = formatUsernameToEmail(username)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
}

// Sign up: creates Auth user + profile row in one step
export async function signUp(username, password, name, role = 'staff', managerId = null) {
    if (!supabase) throw new Error('No Supabase connection')

    const email = formatUsernameToEmail(username)

    // 1. Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
    if (authError) throw authError

    let authUser = authData.user
    if (!authUser) throw new Error('Đăng ký thất bại')

    // Lỗi vi phạm RLS (Row Level Security) khi insert user profile thường là do 
    // Supabase chưa trả về Session (chưa thực sự logged in) ngay lúc gọi hàm signUp.
    // Chúng ta bắt buộc phải ép hệ thống Login lấy Session trước khi ghi data vào bảng users.
    if (!authData.session) {
        const { data: signData, error: signError } = await supabase.auth.signInWithPassword({ email, password })
        if (signError) throw new Error('Tài khoản đã tạo nhưng không thể tự động đăng nhập (Có thể Supabase vẫn đòi xác nhận Email): ' + signError.message)
        authUser = signData.user
    }

    // 2. Create profile row linked to auth user
    const profileData = {
        auth_id: authUser.id,
        name,
        role,
        manager_id: role === 'staff' ? managerId : null
    }

    const { data: profile, error: profileError } = await supabase
        .from('users')
        .insert(profileData)
        .select()
        .single()

    if (profileError) throw profileError
    return { user: authUser, profile }
}


// Sign out
export async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
}

// Get the current session
export async function getSession() {
    if (!supabase) return null
    const { data: { session } } = await supabase.auth.getSession()
    return session
}

// Fetch user profile by Supabase Auth user ID
export async function fetchProfileByAuthId(authId) {
    if (!supabase) return null
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', authId)
        .maybeSingle()
    if (error) {
        console.error('fetchProfileByAuthId error:', error)
        return null
    }
    return data
}

// Fetch all managers (for staff signup selection)
export async function fetchManagers() {
    if (!supabase) return []
    const { data, error } = await supabase
        .from('users')
        .select('id, name')
        .eq('role', 'manager')
        .order('name')
    if (error) {
        console.error('fetchManagers error:', error)
        return []
    }
    return data
}

// Fetch addresses for a manager
export async function fetchAddresses(managerId) {
    if (!supabase) return []

    let query = supabase.from('addresses').select('*').order('created_at')

    if (managerId !== 'ALL') {
        query = query.eq('manager_id', managerId)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchAddresses error:', error)
        return []
    }
    return data
}

// Create a new address for a manager
export async function createAddress(managerId, name) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('addresses')
        .insert({ manager_id: managerId, name })
        .select()
        .single()
    if (error) throw error
    return data
}
