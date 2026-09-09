export default function Toast({ toast }) {
    if (!toast) return null

    const colorClass = toast.type === 'success'
        ? 'bg-success-soft text-success border-success/20'
        : toast.type === 'error' || toast.type === 'danger'
            ? 'bg-danger-soft text-danger border-danger/20'
            : toast.type === 'warning'
                ? 'bg-warning-soft text-warning border-warning/20'
                : 'bg-surface text-text border-border/40'

    const icon = toast.type === 'success' ? '✓ '
        : toast.type === 'error' || toast.type === 'danger' ? '✕ '
        : toast.type === 'warning' ? '⚡ '
        : null

    // z-[300]: trên cả BottomSheet/ConfirmContext (z-[200]) — toast lỗi phải luôn thấy
    // được kể cả khi bắn ra trong lúc một modal/confirm đang mở (vd in bill lỗi trong
    // TableDetailModal), không bị modal che mất.
    return (
        <div className={`toast-in fixed top-5 left-1/2 -translate-x-1/2 z-[300] px-4 py-3 rounded-2xl text-[13px] font-semibold shadow-2xl max-w-[90vw] border backdrop-blur-sm flex flex-col items-center gap-1.5 ${colorClass}`}>
            <span className="text-center text-balance leading-snug">{icon}{toast.message}</span>
            {toast.action && (
                <button
                    onClick={toast.action.onClick}
                    className="text-[11px] font-bold underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
                >
                    {toast.action.label}
                </button>
            )}
        </div>
    )
}
