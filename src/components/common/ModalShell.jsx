// Shared overlay shell behind every bottom-sheet / centered-dialog modal in the
// app — the "fixed inset-0 + backdrop + panel" boilerplate was copy-pasted into
// 15+ files. Panel content/classes stay fully caller-owned (panelClassName);
// only the overlay + backdrop + dismiss-on-backdrop-click wiring is shared.

// Slides up from the bottom (mobile action-sheet style). Backdrop click closes;
// clicking the panel itself does not (stopPropagation), since the outer wrapper
// — not the backdrop — owns the close handler here.
export function BottomSheet({ onClose, zIndexClass = 'z-[100]', className = '', panelClassName, children }) {
    return (
        <div className={`fixed inset-0 ${zIndexClass} flex items-end justify-center ${className}`} onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className={`relative ${panelClassName}`} onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    )
}

// Centered dialog. The backdrop (not the wrapper) owns the close handler, so the
// panel needs no stopPropagation — it's a sibling, never a bubble target of a
// backdrop click.
export function Dialog({ onClose, zIndexClass = 'z-50', className = '', panelClassName, children }) {
    return (
        <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center ${className}`}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative ${panelClassName}`}>
                {children}
            </div>
        </div>
    )
}

// panelClassName dùng chung cho các Dialog kiểu "trang con có nút quay lại" (chọn bàn
// đích, danh sách đơn mang đi, chi tiết bàn) — cùng khung bottom-sheet-trên-desktop nên
// tách 1 lần thay vì mỗi modal tự khai lại chuỗi class.
export const MODAL_PANEL = 'w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden'

// Khuôn nút chip tròn (trạng thái ra món, nút hành động nhỏ trên mỗi đợt/đơn) — dùng ở
// TableDetailModal + TakeawayListModal.
export const CHIP = 'h-[26px] rounded-full border text-[11px] font-black uppercase tracking-wider transition-colors'
export const CHIP_IDLE = `${CHIP} bg-surface-light border-border/60 text-text-secondary`

// Pill ngày/giờ mở đợt/đơn — tách riêng ngày và giờ thành 2 pill cạnh nhau (thay vì 1
// chuỗi text) để dễ quét mắt hơn khi liệt kê nhiều đợt/đơn liên tiếp. Cùng h-[26px] với
// CHIP để pill và nút chip tròn đứng cạnh nhau (xem TableDetailModal) cao bằng nhau.
export const TIME_PILL = 'h-[26px] inline-flex items-center rounded-full bg-surface-light border border-border/60 px-2.5 text-[11px] font-bold text-text-secondary/70 leading-none'
