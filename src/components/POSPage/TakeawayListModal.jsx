import { ArrowLeft, Check, Printer, ArrowRightLeft, Trash2 } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useProducts } from '../../contexts/ProductContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useMoveTarget } from '../../hooks/useMoveTarget'
import { formatVND, discountToPercent } from '../../utils'
import { timeStringVN, openedLabelVN, dateShortVN, isSameDayVN } from '../../utils/dateVN'
import { priceLineFor } from '../../utils/billLines'
import { usePrintArmed } from '../../hooks/usePrintArmed'
import { Dialog, MODAL_PANEL, CHIP, CHIP_IDLE, TIME_PILL } from '../common/ModalShell'
import PrintBill from '../common/PrintBill'
import TableTargetPicker from './TableTargetPicker'

// Đơn mang đi chưa ra món, gộp từ chính bucket name=null trong openTables (xem
// fetchOpenTables) — mở từ thẻ "Mang đi" trong TableModal khi có đơn đang chờ. Khác
// TableDetailModal: mỗi đơn độc lập (đã trả tiền lúc tạo) nên không có "Tính tiền", và in
// từng đơn riêng thay vì gộp cả nhóm thành 1 bill.

export default function TakeawayListModal({ orders, tableNames, onClose, onPick }) {
    const { toggleServed } = useCart()
    const { handleDeleteOrder } = useHistory()
    const confirm = useConfirm()
    const { moving, startMove, cancelMove } = useMoveTarget()

    if (moving) {
        return (
            <TableTargetPicker
                orderIds={moving.orderIds}
                label={moving.label}
                tableNames={tableNames}
                onBack={cancelMove}
                onClose={onClose}
            />
        )
    }

    async function handleDelete(order) {
        const ok = await confirm({
            title: `Xóa đơn ${openedLabelVN(order.createdAt)} (${formatVND(order.total)})?`,
            detail: 'Hành động này không thể hoàn tác!',
            danger: true,
            confirmLabel: 'Xóa',
        })
        if (!ok) return
        await handleDeleteOrder(order.id)
    }

    return (
        <Dialog onClose={onClose} panelClassName={MODAL_PANEL}>
            <div className="shrink-0 flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border/40">
                <button onClick={onClose} aria-label="Về lưới bàn" className="shrink-0 p-1.5 -ml-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                    <ArrowLeft size={18} />
                </button>
                <p className="min-w-0 flex-1 text-text font-black text-base leading-none uppercase tracking-wide truncate">Mang đi</p>
                <span className="shrink-0 text-[13px] font-bold text-text-secondary">{orders.length} đơn</span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {orders.map(order => (
                    <TakeawayRow
                        key={order.id}
                        order={order}
                        onToggleServed={() => toggleServed(order)}
                        onMove={() => startMove([order.id], `đơn ${openedLabelVN(order.createdAt)}`)}
                        onDelete={() => handleDelete(order)}
                    />
                ))}
            </div>

            <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-border/40">
                <button
                    onClick={onPick}
                    className="w-full py-2.5 rounded-[12px] bg-primary text-bg text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 active:bg-primary/80 transition-colors"
                >
                    Đơn mang đi mới
                </button>
            </div>
        </Dialog>
    )
}

function TakeawayRow({ order, onToggleServed, onMove, onDelete }) {
    const { products, productExtras } = useProducts()
    const { billRef, printArmed, arm } = usePrintArmed()

    const discountAmount = order.discountAmount || 0
    const subtotal = order.total + discountAmount
    const { pct: discountPct } = discountToPercent(subtotal, discountAmount)
    const billLines = order.items.map((it, idx) => ({
        key: `${it.productId}:${idx}`, qty: it.qty, discountAmount: it.discountAmount || 0,
        ...priceLineFor(it, products, productExtras),
    }))
    const createdAt = new Date(order.createdAt)

    return (
        <div className="rounded-[16px] border border-border/40 bg-surface-light/40 px-4 py-3">
            <div className="flex items-center justify-between gap-3 pb-2">
                <div className="flex items-center gap-1.5">
                    {/* Nhiều đơn cùng giờ (khách gọi liên tục) thì pill giờ không phân biệt
                        được — số đơn là thứ duy nhất chắc chắn khác nhau. Có thể null (đơn cũ
                        trước khi có order_no, hoặc offline chưa đồng bộ) → ẩn luôn thay vì hiện
                        "#null". */}
                    {order.orderNo != null && <span className={TIME_PILL}>#{order.orderNo}</span>}
                    {!isSameDayVN(createdAt, new Date()) && <span className={TIME_PILL}>{dateShortVN(createdAt)}</span>}
                    <span className={TIME_PILL}>{timeStringVN(createdAt)}</span>
                    <button
                        onClick={onMove}
                        aria-label="Chuyển vào bàn"
                        className={`${CHIP_IDLE} shrink-0 w-[26px] flex items-center justify-center hover:text-text hover:border-primary/40`}
                    >
                        <ArrowRightLeft size={12} strokeWidth={2.25} />
                    </button>
                </div>
                <span className="text-[13px] font-black tabular-nums text-text">{formatVND(order.total)}</span>
            </div>
            <div className="flex flex-col gap-0.5 border-t border-border/40 pt-2 pb-2 pl-1">
                {order.lines.map(l => (
                    <span key={l.name} className="text-[13px] font-bold text-text leading-snug">
                        {l.qty > 1 && <span className="tabular-nums text-text-secondary">{l.qty} </span>}{l.name}
                    </span>
                ))}
            </div>
            <div className="flex items-center gap-2 border-t border-border/40 pt-2">
                <button
                    onClick={arm}
                    aria-label="In bill"
                    className={`${CHIP_IDLE} shrink-0 w-[26px] flex items-center justify-center hover:text-primary`}
                >
                    <Printer size={13} strokeWidth={2.25} />
                </button>
                <button
                    onClick={onDelete}
                    aria-label={`Xóa đơn ${openedLabelVN(order.createdAt)}`}
                    className={`${CHIP_IDLE} shrink-0 w-[26px] flex items-center justify-center hover:text-danger`}
                >
                    <Trash2 size={13} strokeWidth={2.25} />
                </button>
                <button
                    onClick={onToggleServed}
                    className={`flex items-center gap-1.5 px-2.5 ml-auto ${order.servedAt
                        ? `${CHIP} bg-success/10 border-success/40 text-success`
                        : `${CHIP_IDLE} hover:text-text hover:border-primary/40`}`}
                >
                    {order.servedAt && <Check size={12} strokeWidth={3} />}
                    {order.servedAt ? `Đã ra món ${timeStringVN(new Date(order.servedAt))}` : 'Chưa ra món'}
                </button>
            </div>
            {printArmed && (
                <PrintBill
                    ref={billRef}
                    orderNo={order.orderNo}
                    tableName={null}
                    openedAt={order.createdAt}
                    staffName={order.staffName}
                    lines={billLines}
                    subtotal={subtotal}
                    discountTotal={discountAmount}
                    discountPct={discountPct}
                    total={order.total}
                />
            )}
        </div>
    )
}
