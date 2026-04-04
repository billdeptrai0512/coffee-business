import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { fetchAddresses, createAddress as apiCreateAddress, updateAddress as apiUpdateAddress, deleteAddress as apiDeleteAddress, upsertSession } from '../services/authService'
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

        let addressOwnerId = null
        if (profile.role === 'admin') {
            addressOwnerId = 'ALL'
        } else if (profile.role === 'manager') {
            addressOwnerId = profile.id
        } else {
            addressOwnerId = profile.manager_id
        }

        if (!addressOwnerId && profile.role !== 'admin') {
            setLoading(false)
            return
        }

        if (addresses.length === 0) setLoading(true)
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
            if (profile?.id) {
                upsertSession(profile.id, addr.id)
                localStorage.setItem('pos_active_user_id', profile.id)
            }
        } else {
            localStorage.removeItem('pos_selected_address')
            localStorage.removeItem('pos_active_user_id')
        }
    }, [profile])

    const createNewAddress = useCallback(async (name) => {
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể tạo địa chỉ')
        const newAddr = await apiCreateAddress(profile.id, name)
        setAddresses(prev => [...prev, newAddr])
        return newAddr
    }, [profile])

    const renameAddress = useCallback(async (addressId, newName) => {
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể sửa địa chỉ')
        const updatedAddr = await apiUpdateAddress(addressId, newName)
        setAddresses(prev => prev.map(a => a.id === addressId ? updatedAddr : a))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(updatedAddr)
        }
        return updatedAddr
    }, [profile, selectedAddress])

    const removeAddress = useCallback(async (addressId) => {
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể xóa địa chỉ')
        await apiDeleteAddress(addressId)
        setAddresses(prev => prev.filter(a => a.id !== addressId))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(null)
            localStorage.removeItem('pos_selected_address')
        }
    }, [profile, selectedAddress])

    return (
        <AddressContext.Provider value={{
            addresses,
            selectedAddress,
            setSelectedAddress,
            createNewAddress,
            renameAddress,
            removeAddress,
            loading
        }}>
            <Outlet />
        </AddressContext.Provider>
    )
}
