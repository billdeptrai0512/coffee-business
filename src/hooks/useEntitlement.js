import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { ALL_TIER } from '../constants/monetization'
import { onTabReturn } from '../utils/tabVisibility'

// ─── Client kill switch (build-time) ─────────────────────────────────────────
//   Master capability. Build với false → monetization TẮT CỨNG, không hỏi server.
//   Build với true  → bật/tắt thực tế do SERVER quyết (app_config.monetization_enabled).
//   → Hiệu lực = client(build) AND server(runtime). Khớp rollout phases (MONETIZATION.md §9).
const CLIENT_MONETIZATION_ENABLED = import.meta.env.VITE_MONETIZATION_ENABLED === 'true'

// ─── Server kill switch (runtime, app_config) ────────────────────────────────
//   Đọc 1 lần, cache module-level → mọi hook share chung 1 request (không spam DB).
//   _serverFlag: undefined = chưa đọc; true/false = đã rõ.
//   Lỗi đọc config → false (fail-open: KHÔNG gate ai, tránh khoá nhầm khách đã trả
//   khi mạng/DB chập chờn). Flip ON/OFF = UPDATE app_config, KHÔNG cần redeploy.
//   Lỗi trả `undefined` (≠ false "đã đọc, đang tắt") và KHÔNG cache promise hỏng:
//   1 lần đọc lỗi mà cache lại thì cả phiên chạy như monetization tắt — badge gói
//   biến mất trên mọi card và sort địa chỉ theo gói sai, tới khi user tự reload.
let _serverFlag
let _serverFlagPromise = null
function loadServerFlag() {
    if (_serverFlagPromise) return _serverFlagPromise
    _serverFlagPromise = supabase
        .from('app_config')
        .select('value')
        .eq('key', 'monetization_enabled')
        .maybeSingle()
        .then(({ data, error }) => {
            if (error) throw error
            _serverFlag = data?.value === 'true'
            return _serverFlag
        })
        .catch(() => { _serverFlagPromise = null; return undefined })
    return _serverFlagPromise
}

/**
 * Trạng thái bật/tắt monetization HIỆU LỰC = client(build) AND server(app_config).
 * Dùng cho mọi quyết định hiển thị gate/badge/route monetization.
 * @returns {{ enabled: boolean, loading: boolean }}
 */
export function useMonetizationEnabled() {
    const [flag, setFlag] = useState(CLIENT_MONETIZATION_ENABLED ? _serverFlag : false)

    useEffect(() => {
        if (!CLIENT_MONETIZATION_ENABLED) return
        // loadServerFlag() trả promise đã cache → nếu đã đọc xong, .then resolve ngay
        // với giá trị cũ (React bỏ qua nếu không đổi). Không setState đồng bộ trong effect.
        let cancelled = false
        let retryId
        const apply = (retry) => (v) => {
            if (cancelled) return
            // undefined = đọc lỗi → thử lại ĐÚNG 1 lần (promise hỏng đã bỏ cache ở trên).
            // Mạng chết hẳn thì dừng ở đây, không quay vòng gọi DB.
            if (v === undefined) {
                if (retry) retryId = setTimeout(() => loadServerFlag().then(apply(false)), 2000)
            } else setFlag(v)
        }
        loadServerFlag().then(apply(true))
        // "Thử lại đúng 1 lần" ở trên chỉ cứu lần đọc đầu — hook này gắn ở các Provider
        // mount 1 lần cho cả phiên (vd AddressStatsProvider bọc mọi route sau login),
        // nên nếu cả 2 lần đó đều rớt mạng thì flag kẹt undefined/false SUỐT PHIÊN, không
        // gì tự sửa (badge gói biến mất khỏi mọi card). Thêm onTabReturn để mỗi lần quay
        // lại app là 1 cơ hội đọc lại, không cần đợi F5.
        const offTabReturn = onTabReturn(() => loadServerFlag().then(apply(true)))
        return () => { cancelled = true; clearTimeout(retryId); offTabReturn() }
    }, [])

    const loading = CLIENT_MONETIZATION_ENABLED && flag === undefined
    const enabled = CLIENT_MONETIZATION_ENABLED && flag === true
    return { enabled, loading }
}

/**
 * Hook trả về quyền truy cập báo cáo của address đang chọn — 1 gói all-access
 * duy nhất (xem docs/MONETIZATION.md §1: mô hình multi-module đã bỏ 2026-06-09),
 * nên chỉ cần 1 boolean, không phải danh sách module.
 *
 * Bypass (hasAccess:true, không query) khi:
 *   - monetization OFF (client build OFF hoặc server app_config OFF), HOẶC
 *   - đang ở guest mode (Khách ghé thăm xem full tính năng), HOẶC
 *   - đang ở "Mẫu mặc định" (id: null, admin-only playground) — không phải địa
 *     chỉ trả phí thật nên không có (và không cần) hàng entitlement nào cho nó.
 *
 * Khi ON + không guest → query RPC get_address_entitlement, hasAccess = có
 * hàng tier='all' còn hạn không.
 *
 * Trong lúc còn đọc server flag (configLoading) → trả loading:true (coi như có
 * quyền) để KHÔNG nháy gate trước khi biết trạng thái thật.
 *
 * ⚠️ Rules of Hooks: hooks LUÔN được gọi — bypass chỉ bỏ qua effect logic,
 *    KHÔNG return sớm trước hooks.
 */
export function useEntitlement() {
    const { selectedAddress } = useAddress()
    const { isGuest } = useAuth()
    const { enabled, loading: configLoading } = useMonetizationEnabled()

    // selectedAddress?.id === null (not undefined) ⇒ "Mẫu mặc định" đang được chọn
    // (object có id, id=null) — phân biệt với "chưa chọn địa chỉ" (selectedAddress
    // chính nó null/undefined ⇒ ?.id trả undefined).
    const isDefaultTemplate = selectedAddress?.id === null
    const bypass = !enabled || isGuest || isDefaultTemplate

    const [state, setState] = useState({ hasAccess: false, loading: true })

    useEffect(() => {
        // Không query khi bypass, hoặc khi chưa biết server flag (tránh query thừa).
        if (bypass || configLoading) return

        if (!selectedAddress?.id) {
            // Intentional reset when no address is selected — nothing to fetch.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setState({ hasAccess: false, loading: false })
            return
        }

        setState(prev => ({ ...prev, loading: true }))

        supabase
            .rpc('get_address_entitlement', { p_address_id: selectedAddress.id })
            .then(({ data, error }) => {
                if (error) {
                    console.error('[useEntitlement] RPC error:', error)
                    // Fail-open: lỗi mạng → không gate user (không phạt oan)
                    setState({ hasAccess: true, loading: false })
                    return
                }
                // RPC trả về rows { tier, valid_to } — 1 row tier='all' còn hạn = có quyền.
                const rows = Array.isArray(data) ? data : (data ? [data] : [])
                setState({ hasAccess: rows.some(r => r.tier === ALL_TIER), loading: false })
            })
    }, [bypass, configLoading, selectedAddress?.id])

    // Bypass (monetization OFF hoặc guest) → có quyền.
    // Khi đang load server flag → loading:true để KHÔNG nháy gate.
    if (bypass) {
        return { hasAccess: true, loading: configLoading, enabled }
    }

    return { ...state, enabled }
}

