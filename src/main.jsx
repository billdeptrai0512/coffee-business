import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Capacitor } from '@capacitor/core'
import App from './App.jsx'
import PWAUpdatePrompt from './components/common/PWAUpdatePrompt.jsx'
import PWAInstallPrompt from './components/common/PWAInstallPrompt.jsx'

// App native (Capacitor) không cần service worker/banner cài PWA/Analytics web —
// 3 thứ này chỉ có ý nghĩa khi chạy trong trình duyệt.
const isNative = Capacitor.isNativePlatform()

// DSN không phải secret (nằm trong bundle client). Chỉ bật ở production để dev/tunnel
// không bắn lỗi giả lên dashboard. tracesSampleRate=0 → chỉ theo dõi lỗi, không tốn
// hạn ngạch performance. release = commit mới nhất (đã có trong vite.config.js).
// Dynamic import: @sentry/react không nhỏ, và trước đây import tĩnh khiến nó luôn
// nằm trong bundle đầu tiên (kể cả /pos, trang load đầu khi mở app trên điện thoại).
// Không await — không cần chặn render để chờ monitoring SDK tải xong.
if (import.meta.env.PROD) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: 'https://53998493c765f2153e300936a8e7b9ef@o4511676122988544.ingest.us.sentry.io/4511676137865216',
      tracesSampleRate: 0,
      release: __APP_UPDATE_LOG__,
      // ponytail: chặn noise không phải lỗi app — script Zalo in-app browser tiêm vào trang,
      // và cơ chế tự phục hồi lock đa-tab của Supabase auth (không ảnh hưởng đăng nhập)
      ignoreErrors: [
        'isReCreate is not defined',
        'zaloJSV2 is not defined',
        'Lock was stolen by another request',
      ],
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      {/* Trong Router vì banner chỉ được phép hiện ở /login (xem PWAInstallPrompt) —
          nhưng vẫn mount toàn cục để không bỏ lỡ event beforeinstallprompt, thứ chỉ
          bắn 1 lần ngay sau khi tải trang. */}
      {!isNative && <PWAInstallPrompt />}
    </BrowserRouter>
    {/* Not rendered at all (not just hidden) khi native — useRegisterSW bên trong
        PWAUpdatePrompt tự đăng ký service worker ngay lúc component được gọi, nên
        early-return bên trong nó vẫn không tránh được side effect này. */}
    {!isNative && <PWAUpdatePrompt />}
    {!isNative && <Analytics />}
  </StrictMode>,
)
