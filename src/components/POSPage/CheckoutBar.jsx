import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Percent } from 'lucide-react'
import { formatVND } from '../../utils'
import TableModal from './TableModal'
import CartListModal from './CartListModal'

// Thanh chốt bàn — chỉ render ở địa chỉ dine_in (xem addresses.dine_in).
// Đường 1-chạm mang đi không mount component này, nên POS mặc định không đổi gì.
export default function CheckoutBar({
    discountAmount, finalTotal,
    cart, onItemDiscount,
    tableName, onConfirm, disabled,
}) {
    // "BÀN 3" trong Nhật ký nhảy tới /pos kèm state này — mở thẳng lưới bàn (TableModal
    // tự đọc lại state này để seed "detail" cho đúng bàn đó, xem TableModal.jsx).
    const { state } = useLocation()
    const [showDiscount, setShowDiscount] = useState(false)
    const [showTables, setShowTables] = useState(!!state?.openTableDetail)

    return (
        <footer className="shrink-0 bg-surface border-t border-border/80 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-3 mb-3">
                {/* Một con số duy nhất: số khách phải trả. Có giảm giá hay không thì đọc ở
                    nút % ngay cạnh (sáng lên khi đang giảm), không cần thêm số thứ hai. */}
                <div className="min-w-0 flex items-baseline gap-2">
                    <span className="text-[14px] font-black uppercase tracking-wider text-text-secondary">Tổng:</span>
                    <span className="text-[17px] font-black text-text tabular-nums">{formatVND(finalTotal)}</span>
                </div>
                {/* Giỏ rỗng thì không có gì để giảm — ẩn hẳn thay vì để nút mờ, đỡ một
                    món đồ chết trên thanh mà nhân viên vẫn thử bấm. */}
                {!disabled && (
                    <button
                        onClick={() => setShowDiscount(true)}
                        className={`shrink-0 w-[30px] h-[30px] rounded-[25px] border flex items-center justify-center transition-colors ${discountAmount > 0 ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/60 text-text'}`}
                    >
                        <Percent size={15} strokeWidth={2.5} />
                    </button>
                )}
                {/* Ô bàn mở lưới bàn thay vì gõ tay: bàn là một tab còn mở nhiều đợt,
                    gõ lại tên mỗi đợt thì sai chính tả một lần là tách thành hai bàn.
                    Chỉ tên bàn — tổng đang chạy của bàn nằm trên thẻ trong lưới, để đây
                    thì hai con số tiền cạnh nhau (tổng bàn vs tổng đợt) rất dễ đọc nhầm.
                    Ở dine-split, lưới bàn (.pos-table-pane, xem POSPage.jsx) đã hiện sẵn
                    ngay cạnh — hỏi thẳng DOM có đang hiện nó không thay vì tự đoán lại
                    breakpoint bằng một chuỗi media-query chép tay riêng, dễ lệch với
                    @custom-variant dine-split (index.css) mỗi lần một bên đổi mà quên bên kia. */}
                <button
                    type="button"
                    onClick={() => {
                        const tablePane = document.querySelector('.pos-table-pane')
                        if (getComputedStyle(tablePane).display === 'none') setShowTables(true)
                    }}
                    className="min-w-[92px] shrink-0 ml-auto bg-surface-light border border-border/60 rounded-[12px] px-1.5 py-1.5 text-center focus:outline-none focus:border-primary/40 hover:border-primary/40 transition-colors"
                >
                    {/* Không chọn bàn = mang đi, đó là một trạng thái thật chứ không phải
                        "chưa chọn" — hiện đúng tên nó để không ai đi tìm nút mang đi. */}
                    <span className="block text-[12px] font-bold uppercase tracking-wider text-text">
                        {tableName || 'Mang đi'}
                    </span>
                </button>
            </div>

            <button
                onClick={() => onConfirm(discountAmount, tableName)}
                disabled={disabled}
                className="w-full py-2.5 rounded-[12px] bg-primary text-bg text-[14px] font-black uppercase tracking-wider hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Tạo đơn
            </button>

            {/* 1 dòng thì tự mở thẳng ô sửa của dòng đó (xem CartListModal). */}
            {showDiscount && (
                <CartListModal cart={cart} onClose={() => setShowDiscount(false)} onItemDiscount={onItemDiscount} />
            )}

            {showTables && <TableModal onClose={() => setShowTables(false)} />}
        </footer>
    )
}
