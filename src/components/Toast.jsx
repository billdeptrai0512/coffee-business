export default function Toast({ toast }) {
    if (!toast) return null

    return (
        <div className={`toast-in fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl text-[13px] font-semibold shadow-2xl max-w-[90vw] text-center border backdrop-blur-sm ${toast.type === 'success'
            ? 'bg-success-soft text-success border-success/20'
            : toast.type === 'error'
                ? 'bg-danger-soft text-danger border-danger/20'
                : toast.type === 'warning'
                    ? 'bg-warning-soft text-warning border-warning/20'
                    : 'bg-surface text-text border-border/40'
            }`}>
            {toast.type === 'success' && '✓ '}
            {toast.type === 'error' && '✕ '}
            {toast.type === 'warning' && '⚡ '}
            {toast.message}
        </div>
    )
}
