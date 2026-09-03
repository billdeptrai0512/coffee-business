import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Chỉ iOS: WKWebView có thể xoá localStorage khi hệ thống thiếu bộ nhớ (không phải
// storage bền như Keychain) → nhân viên bị đăng xuất âm thầm. Dùng @capacitor/preferences
// thay localStorage. KHÔNG áp dụng cho Android — WebView Android vốn đã đủ bền, và
// Supabase SDK đọc storage khá thường xuyên (multi-tab lock retry...): mỗi lần đọc phải
// qua cầu nối JS↔native (bridge) chậm hơn hẳn localStorage đồng bộ, đo thực tế trên máy
// gây delay 700ms-2s mỗi lần app kiểm tra session — làm chậm cả app một cách vô lý.
const nativeStorage = {
    getItem: (key) => Preferences.get({ key }).then((r) => r.value),
    setItem: (key, value) => Preferences.set({ key, value }),
    removeItem: (key) => Preferences.remove({ key }),
}

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, Capacitor.getPlatform() === 'ios'
        ? { auth: { storage: nativeStorage } }
        : undefined)
    : null
