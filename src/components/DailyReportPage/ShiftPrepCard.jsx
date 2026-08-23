import { Check, Plus, X, RotateCcw } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import CollapsibleCard from './CollapsibleCard'

// Checklist card dùng chung cho khu Tồn kho — dùng cho cả "Soạn cho hôm nay"
// (đưa hàng ra quầy) và "Chuẩn bị tồn kho" (đi chợ đắp kho). Mỗi dòng có ô tick
// + so sánh "Còn" (tồn hiện có) vs "Cần" (lượng cần thêm) + quy đổi ra bịch.
//
// items: [{ ingredient, have, need, needPacks, unit, packUnit }]
// Tick (checked/onToggle) + thu gọn (open/onToggleOpen) đều do parent (DailyReportPage) giữ.
export default function ShiftPrepCard({
    items = [],
    checked = {},
    onToggle,
    // Khi set → mỗi dòng đổi ô tick thành nút "+" mở phiếu Nhập kho (card "Chuẩn bị tồn
    // kho"). Bấm dòng gọi onRestock(ingredient). Không set → giữ hành vi tick như cũ.
    onRestock,
    // Khi set (card Soạn) → mỗi dòng thêm nút "bỏ qua" (✕): đánh dấu "đã xem, không cần
    // lấy" để vẫn hoàn tất ca; bấm lại (↩) để hủy. skipped: { [ingredient]: true }.
    skipped = {},
    onSkip,
    title,
    icon,
    // Nhãn cho số tồn ở dòng phụ: card Soạn = tồn quầy đầu ca ("Quầy"),
    // card Chuẩn bị kho = tổng tồn cho mai ("Tồn kho").
    haveLabel,
    emptyTitle,
    emptyHint = '',
    // Động từ CTA: "Lấy" (soạn ra quầy) / "Mua" (đi chợ). Dòng lớn = "<packVerb> N bịch"
    // nếu có pack_size, không thì "<packVerb> X <đơn vị>".
    packVerb,
    open = true,
    onToggleOpen,
}) {
    const restockMode = typeof onRestock === 'function'
    const skipMode = typeof onSkip === 'function'
    const doneCount = items.reduce((n, it) => n + ((checked[it.ingredient] || skipped[it.ingredient]) ? 1 : 0), 0)

    return (
        <CollapsibleCard
            icon={icon}
            title={title}
            count={items.length > 0 ? (restockMode ? String(items.length) : `${doneCount}/${items.length}`) : null}
            open={open}
            onToggle={onToggleOpen}
        >
            {items.length === 0 ? (
                <div className="py-3 text-center flex flex-col items-center gap-1">
                    <span className="text-[13px] font-bold text-success">{emptyTitle}</span>
                    {emptyHint && <span className="text-[11px] text-text-secondary">{emptyHint}</span>}
                </div>
            ) : (
                <div className="flex flex-col">
                    {items.map(it => {
                        const isDone = !!checked[it.ingredient]
                        const isSkipped = !isDone && !!skipped[it.ingredient]
                        const muted = isDone || isSkipped // đã xử lý (nhập hoặc bỏ qua) → mờ + gạch ngang
                        // Kho không đủ cho NHU CẦU hôm nay (kho < Cần) → tô đỏ: soạn hết kho vẫn
                        // thiếu, cần mua thêm. Đã xử lý rồi thì thôi cảnh báo.
                        const shortfall = !muted && !restockMode && it.warehouse != null && it.warehouse < it.need

                        const leadIcon = restockMode ? (
                            <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-primary bg-primary/10" title="Nhập kho">
                                <Plus size={16} strokeWidth={3} />
                            </span>
                        ) : (
                            <span className={`shrink-0 w-5 h-5 rounded-[7px] border flex items-center justify-center transition-colors ${
                                isDone ? 'bg-primary border-primary'
                                    : isSkipped ? 'bg-border/40 border-border'
                                        : 'bg-surface-light border-border'}`}>
                                {isDone && <Check size={13} className="text-black" strokeWidth={3} />}
                                {isSkipped && <Check size={13} className="text-text-dim" strokeWidth={3} />}
                            </span>
                        )

                        const nameDesc = (
                            <div className="flex-1 min-w-0">
                                <span className={`block text-[14px] font-bold leading-tight ${muted ? 'text-text-dim line-through' : 'text-text'}`}>
                                    {ingredientLabel(it.ingredient)}
                                </span>
                                <div className="text-[11px] text-text-dim mt-0.5">
                                    {it.warehouse != null && (
                                        <span className="block">Tồn kho: {it.warehouse} {it.unit}</span>
                                    )}
                                    <span className="block">
                                        {haveLabel}: {it.tare > 0 && <>{it.tare} + </>}{it.have} {it.unit}
                                    </span>
                                    {it.boughtToday > 0 && (
                                        <span className="block text-success">
                                            Đã mua hôm nay: {it.boughtToday} {it.unit}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )

                        // Không cấu hình pack_size (mua rời, vd Ống hút) → đếm theo đơn vị gốc.
                        const ctaText = (
                            <div className="flex flex-col items-end shrink-0">
                                <span className={`text-[12px] font-black leading-tight text-right ${muted ? 'text-text-dim line-through' : 'text-primary'}`}>
                                    {packVerb} {it.needPacks > 0 ? `${it.needPacks} ${it.packUnit || ''}` : `${it.need} ${it.unit}`}
                                </span>
                            </div>
                        )

                        // Card Soạn (skipMode): nút bỏ qua (✕/↩) nằm ngay cạnh tên nguyên liệu;
                        // ô tick ở cuối dòng, cạnh CTA "Lấy N …" — tick nằm ngay chỗ mắt vừa đọc
                        // xong CTA. Span (không phải button) để tránh lồng button trong button.
                        if (skipMode) {
                            return (
                                <button
                                    key={it.ingredient}
                                    type="button"
                                    onClick={() => onToggle?.(it.ingredient)}
                                    className={`flex items-start gap-3 py-2.5 border-b border-border/20 last:border-0 text-left active:scale-[0.99] transition ${isSkipped ? 'opacity-60' : ''}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className={`text-[14px] font-bold leading-tight ${muted ? 'text-text-dim line-through' : 'text-text'}`}>
                                                {ingredientLabel(it.ingredient)}
                                            </span>
                                            <span
                                                onClick={(e) => { e.stopPropagation(); onSkip(it.ingredient) }}
                                                title={isSkipped ? 'Hoàn tác bỏ qua' : 'Bỏ qua — không cần lấy'}
                                                className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-lg active:scale-95 transition ${isSkipped ? 'text-primary hover:bg-primary/10' : 'text-text-dim hover:text-text hover:bg-border/40'}`}
                                            >
                                                {isSkipped ? <RotateCcw size={13} /> : <X size={13} />}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-text-dim mt-0.5">
                                            {it.warehouse != null && (
                                                <span className={`block ${shortfall ? 'text-danger font-bold' : ''}`}>
                                                    Tồn kho: {it.warehouse} {it.unit}
                                                </span>
                                            )}
                                            <span className="block">
                                                {haveLabel}: {it.tare > 0 && <>{it.tare} + </>}{it.have} {it.unit}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                                        {ctaText}
                                        {leadIcon}
                                    </div>
                                </button>
                            )
                        }

                        // Còn lại là card "Chuẩn bị tồn kho" (restockMode) — bấm dòng mở phiếu Nhập kho.
                        return (
                            <button
                                key={it.ingredient}
                                type="button"
                                onClick={() => onRestock(it.ingredient, it.needPacks > 0 ? it.needPacks : it.need)}
                                className="flex items-start gap-3 py-2.5 border-b border-border/20 last:border-0 text-left active:scale-[0.99] transition"
                            >
                                {nameDesc}
                                <div className="flex flex-col items-center gap-1.5 shrink-0">
                                    {ctaText}
                                    {leadIcon}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </CollapsibleCard>
    )
}
