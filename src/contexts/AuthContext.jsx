import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { signIn as authSignIn, signOut as authSignOut, signUp as authSignUp, fetchProfileByAuthId } from '../services/authService'

const AuthContext = createContext(null)

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)       // Supabase auth user
    const [profile, setProfile] = useState(null)  // User profile row (from 'users' table)
    const [loading, setLoading] = useState(true)

    // Load profile when auth user changes
    const loadProfile = useCallback(async (authUser) => {
        if (!authUser) {
            setProfile(null)
            return
        }

        // Retry fetching profile in case it's a new sign-up and the insert hasn't completed yet
        let pf = null
        let retries = 3
        while (!pf && retries > 0) {
            pf = await fetchProfileByAuthId(authUser.id)
            if (pf) break
            await new Promise(res => setTimeout(res, 500))
            retries--
        }

        setProfile(pf)
    }, [])

    // Initialize: check existing session
    useEffect(() => {
        if (!supabase) {
            setLoading(false)
            return
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            const authUser = session?.user ?? null
            setUser(authUser)
            if (authUser) {
                loadProfile(authUser).finally(() => setLoading(false))
            } else {
                setLoading(false)
            }
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const authUser = session?.user ?? null
            setUser(authUser)
            loadProfile(authUser)
        })

        return () => subscription.unsubscribe()
    }, [loadProfile])

    const signIn = useCallback(async (username, password) => {
        const data = await authSignIn(username, password)
        // Auth state change listener will handle setting user/manager
        return data
    }, [])

    const signOut = useCallback(async () => {
        await authSignOut()
        setUser(null)
        setProfile(null)
    }, [])

    const signUp = useCallback(async (username, password, name, role = 'staff', managerId = null) => {
        const data = await authSignUp(username, password, name, role, managerId)
        // Manually set state to bypass race conditions with onAuthStateChange
        setUser(data.user)
        setProfile(data.profile)
        return data
    }, [])

    const isManager = profile?.role === 'manager'
    const isStaff = profile?.role === 'staff'

    return (
        <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, isManager, isStaff }}>
            {children}
        </AuthContext.Provider>
    )
}
