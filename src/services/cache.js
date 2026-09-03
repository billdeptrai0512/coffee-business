// Tiny TTL cache for service-layer reads. Designed for the case where
// the user toggles between tabs/views that refetch the same endpoint —
// 30s lets repeated reads feel instant without holding stale data long.
//
// Mutations call invalidate(...) to drop stale entries before the next read.
//
// Usage:
//   const cache = createCache(30_000)
//   export async function fetchX(addressId) {
//       return cache.through(['x', addressId], () => actuallyFetch(addressId))
//   }
//   export function invalidateX(addressId) { cache.invalidate(['x', addressId]) }

function createCache(ttlMs) {
    // Map<string, { data, t }>
    const store = new Map()

    const keyOf = (parts) => parts.map(p => p == null ? '' : String(p)).join('|')

    function get(parts) {
        const k = keyOf(parts)
        const hit = store.get(k)
        if (!hit) return undefined
        if (Date.now() - hit.t >= ttlMs) {
            store.delete(k)
            return undefined
        }
        return hit.data
    }

    function set(parts, data) {
        store.set(keyOf(parts), { data, t: Date.now() })
    }

    // Drop every entry whose key starts with the given prefix parts.
    // Useful when a mutation invalidates a whole namespace (e.g. all
    // report reads for an addressId).
    function invalidatePrefix(parts) {
        const prefix = keyOf(parts) + '|'
        const exact = keyOf(parts)
        for (const k of store.keys()) {
            if (k === exact || k.startsWith(prefix)) store.delete(k)
        }
    }

    function clear() { store.clear() }

    // Read-through: returns cached value if fresh, else awaits fn() and caches the resolved value.
    // Rejections are NOT cached.
    async function through(parts, fn) {
        const cached = get(parts)
        if (cached !== undefined) return cached
        const data = await fn()
        set(parts, data)
        return data
    }

    return { invalidatePrefix, clear, through }
}

// ─── Shared instances ────────────────────────────────────────────────────────
// reportCache (30s) backs everything users see on Report / History pages:
// reports, orders/expenses by range, fixed costs, shift closings. Any mutation
// to those tables calls invalidateReportCache(addressId) so the next read goes
// to the network.
//
// historicalCache (5 min) backs immutable past data (last week / past days).
// Yesterday's rows don't mutate, so a longer TTL is safe.
export const reportCache = createCache(30_000)
export const historicalCache = createCache(5 * 60_000)

export function invalidateReportCache(addressId) {
    if (addressId) reportCache.invalidatePrefix([addressId])
    else reportCache.clear()
}

