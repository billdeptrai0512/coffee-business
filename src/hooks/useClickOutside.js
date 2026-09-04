import { useEffect } from 'react'

// Đóng dropdown/popover/menu khi bấm ra ngoài `ref`. active=false tắt hẳn listener
// (dùng khi panel đang đóng, đỡ gắn/gỡ listener lúc không cần theo dõi gì cả — truyền
// true nếu panel luôn theo dõi bất kể trạng thái mở). escape=true thêm phím Esc cũng đóng.
export function useClickOutside(ref, onOutside, { active = true, escape = false } = {}) {
    useEffect(() => {
        if (!active) return
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside() }
        document.addEventListener('pointerdown', onDown)
        const onKey = escape ? (e) => { if (e.key === 'Escape') onOutside() } : null
        if (onKey) document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('pointerdown', onDown)
            if (onKey) document.removeEventListener('keydown', onKey)
        }
    }, [active, escape, ref, onOutside])
}
