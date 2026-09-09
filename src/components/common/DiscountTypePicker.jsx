import { DISCOUNT_TYPE_LABELS } from '../../constants/discountTypes'

// 3 nút chọn kiểu chương trình giảm giá — dùng chung ở form tạo (DiscountProgramsPage) và
// form sửa (DiscountProgramDetailPage).
export default function DiscountTypePicker({ value, onChange, disabled }) {
    return (
        <div className="flex gap-2">
            {Object.entries(DISCOUNT_TYPE_LABELS).map(([t, label]) => (
                <button
                    key={t}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(t)}
                    className={`flex-1 py-2 rounded-[12px] border font-bold text-[12px] transition-colors disabled:opacity-60 ${value === t ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-bg border-border/60 text-text-secondary hover:text-text'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}
