import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { fetchAddresses, createAddress as apiCreateAddress } from '../services/authService'
import { Outlet } from 'react-router-dom'

const AddressContext = createContext(null)

export function useAddress() {
    const ctx = useContext(AddressContext)
    if (!ctx) throw new Error('useAddress must be used within AddressProvider')
    return ctx
}

export function AddressProvider() {
    const { profile } = useAuth()
    const [addresses, setAddresses] = useState([])
    const [selectedAddress, setSelectedAddressState] = useState(null)
    const [loading, setLoading] = useState(true)

    // Load addresses when profile is available
    useEffect(() => {
        if (!profile?.id) {
            setAddresses([])
            setLoading(false)
            return
        }

        const addressOwnerId = profile.role === 'manager' ? profile.id : profile.manager_id
        if (!addressOwnerId) {
            setLoading(false)
            return
        }

        setLoading(true)
        fetchAddresses(addressOwnerId).then(addrs => {
            setAddresses(addrs)

            // Restore previously selected address from localStorage
            const savedId = localStorage.getItem('pos_selected_address')
            const saved = addrs.find(a => a.id === savedId)
            if (saved) {
                setSelectedAddressState(saved)
            } else if (addrs.length === 1) {
                // Auto-select if only one address
                setSelectedAddressState(addrs[0])
                localStorage.setItem('pos_selected_address', addrs[0].id)
            }

            setLoading(false)
        })
    }, [profile])

    const setSelectedAddress = useCallback((addr) => {
        setSelectedAddressState(addr)
        if (addr) {
            localStorage.setItem('pos_selected_address', addr.id)
        } else {
            localStorage.removeItem('pos_selected_address')
        }
    }, [])

    const createNewAddress = useCallback(async (name) => {
        if (!profile?.id || profile.role !== 'manager') throw new Error('Chỉ quản lý mới có thể tạo địa chỉ')
        const newAddr = await apiCreateAddress(profile.id, name)
        setAddresses(prev => [...prev, newAddr])
        return newAddr
    }, [profile])

    return (
        <AddressContext.Provider value={{
            addresses,
            selectedAddress,
            setSelectedAddress,
            createNewAddress,
            loading
        }}>
            <Outlet />
        </AddressContext.Provider>
    )
}
