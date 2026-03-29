import { useEffect, useRef, useCallback } from 'react'
import { submitOrder } from '../services/orderService'
import { supabase } from '../lib/supabaseClient'

const PENDING_ORDERS_KEY = 'coffee_pending_orders'

export function getPendingOrders() {
    try {
        const raw = localStorage.getItem(PENDING_ORDERS_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function savePendingOrders(orders) {
    localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(orders))
}

export function addPendingOrder(orderItems, total) {
    const pending = getPendingOrders()
    pending.push({
        orderItems,
        total,
        createdAt: new Date().toISOString(),
    })
    savePendingOrders(pending)
}

export function useOfflineSync(onSyncComplete) {
    const isSyncing = useRef(false)

    const syncPending = useCallback(async () => {
        if (isSyncing.current || !supabase) return
        const pending = getPendingOrders()
        if (pending.length === 0) return

        isSyncing.current = true
        const failed = []

        for (const order of pending) {
            try {
                await submitOrder(order.orderItems, order.total)
            } catch (err) {
                console.error('Sync failed for order:', err)
                failed.push(order)
            }
        }

        savePendingOrders(failed)
        isSyncing.current = false

        if (failed.length < pending.length && onSyncComplete) {
            onSyncComplete()
        }
    }, [onSyncComplete])

    useEffect(() => {
        // Try syncing on mount
        syncPending()

        // Sync when coming back online
        const handleOnline = () => {
            syncPending()
        }

        window.addEventListener('online', handleOnline)
        return () => window.removeEventListener('online', handleOnline)
    }, [syncPending])

    return { syncPending, getPendingCount: () => getPendingOrders().length }
}
