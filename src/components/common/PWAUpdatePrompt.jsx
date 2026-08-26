import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
    const [updating, setUpdating] = useState(false)
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, r) {
            // Check for updates every 30 minutes
            if (r) {
                const check = () => r.update().catch(() => {}) // ponytail: nuốt lỗi mạng, tránh unhandled rejection bắn noise lên Sentry
                setInterval(check, 30 * 60 * 1000)
                // setInterval bị iOS Safari treo khi PWA standalone chạy nền — app đóng
                // lâu rồi mở lại (không phải cold-start) sẽ không bao giờ chạm interval.
                // Bù bằng cách check lại mỗi lần app quay lại foreground.
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') check()
                })
            }
        },
        onRegisterError(error) {
            console.error('SW registration error:', error)
        },
    })

    if (!needRefresh) return null

    return (
        <div className="pwa-update-banner">
            <div className="pwa-update-content">
                <div className="pwa-update-header">
                    <span className="pwa-update-text">Đã có phiên bản mới !</span>
                </div>
                <div className="pwa-update-actions">
                    <button
                        className="pwa-update-btn"
                        disabled={updating}
                        onClick={() => { setUpdating(true); updateServiceWorker(true) }}
                    >
                        {updating ? 'Đang cập nhật…' : 'Cập nhật'}
                    </button>
                </div>
            </div>
        </div>
    )
}
