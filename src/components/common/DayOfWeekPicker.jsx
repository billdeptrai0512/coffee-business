// 7 nút toggle thứ trong tuần — value là mảng SMALLINT theo convention EXTRACT(DOW) của
// Postgres (0=CN..6=T7, xem discountPrograms.js). Rỗng = không lọc theo thứ (mọi ngày).
const DAYS = [
    { dow: 1, label: 'T2' },
    { dow: 2, label: 'T3' },
    { dow: 3, label: 'T4' },
    { dow: 4, label: 'T5' },
    { dow: 5, label: 'T6' },
    { dow: 6, label: 'T7' },
    { dow: 0, label: 'CN' },
]

export default function DayOfWeekPicker({ value, onChange, disabled }) {
    function toggle(dow) {
        if (disabled) return
        onChange(value.includes(dow) ? value.filter(d => d !== dow) : [...value, dow].sort())
    }

    return (
        <div className="flex gap-1.5">
            {DAYS.map(({ dow, label }) => {
                const on = value.includes(dow)
                return (
                    <button
                        key={dow}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggle(dow)}
                        className={`flex-1 h-9 rounded-[10px] border font-bold text-[12px] transition-colors disabled:opacity-60 ${on
                            ? 'bg-primary text-bg border-primary shadow-sm'
                            : 'bg-surface-light text-text-secondary border-border/60 hover:text-text'
                            }`}
                    >
                        {label}
                    </button>
                )
            })}
        </div>
    )
}
