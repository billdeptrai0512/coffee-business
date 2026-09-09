import { useState, useRef, useCallback } from 'react'

// navigator.clipboard fails in non-secure contexts and inside iframes without
// `allow="clipboard-write"`. Falls back to the legacy execCommand path which
// works in both. Returns true on success.
async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch { /* fall through to legacy path */ }
    try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '0'
        ta.style.left = '0'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, text.length)
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
    } catch { return false }
}

export function useToast(duration = 3500) {
    const [toast, setToast] = useState(null)
    const timer = useRef(null)

    // Stable identity so consumers can safely list these in effect/callback deps
    // without refiring on every render (they used to be plain functions, recreated
    // every render, which made that unsafe).
    const showToast = useCallback((message, type = 'info', action = null) => {
        if (timer.current) clearTimeout(timer.current)
        setToast({ message, type, action })
        timer.current = setTimeout(() => setToast(null), duration)
    }, [duration])

    const showError = useCallback((err, actionLabel) => {
        const errMsg = err?.message || String(err) || 'Lỗi không xác định'
        const errCode = err?.code ? `\nCode: ${err.code}` : ''
        const errDetails = err?.details ? `\nDetails: ${err.details}` : ''
        // err.stage: vài nơi gọi (vd escposBitmap.js) gắn thêm bước xảy ra lỗi (capture DOM
        // hay gửi mạng...) — debug từ xa không cần đoán mò từ 1 message chung chung.
        const errStage = err?.stage ? `\nStage: ${err.stage}` : ''
        const copy = [
            `[${new Date().toLocaleString('vi-VN')}]`,
            `Thao tác: ${actionLabel}`,
            `Lỗi: ${errMsg}${errCode}${errDetails}${errStage}`,
            `Trang: ${window.location.pathname}`
        ].join('\n')

        console.error(`[${actionLabel}]`, err)
        // err.expected = validation/guard-rail message, không phải lỗi thật (đã biết
        // trước có thể xảy ra) — không đáng báo Sentry, chỉ cần console + toast.
        if (!err?.expected) {
            // Dynamic import (thay vì static) — useToast được import ở gần như mọi
            // context/page, nên import tĩnh @sentry/react ở đây từng kéo cả SDK vào
            // bundle đầu tiên y hệt vấn đề bên main.jsx. No-op khi Sentry chưa init
            // (dev) — tag `action` để lọc lỗi theo thao tác, `stage` nếu có để lọc sâu hơn.
            import('@sentry/react')
                .then(Sentry => Sentry.captureException(err, { tags: { action: actionLabel, ...(err?.stage ? { stage: err.stage } : {}) } }))
                .catch(() => { })
        }
        showToast('Có lỗi xảy ra', 'error', {
            label: 'Sao chép lỗi',
            onClick: async () => {
                const ok = await copyText(copy)
                showToast(ok ? 'Đã sao chép lỗi' : 'Không sao chép được — copy thủ công từ console', ok ? 'success' : 'warning')
            }
        })
    }, [showToast])

    return { toast, showToast, showError }
}
