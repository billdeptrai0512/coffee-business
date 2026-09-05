import { useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Percent, Trash2, Printer } from 'lucide-react'
import { formatVND, computeDiscount, discountToPercent, NO_DISCOUNT } from '../../utils'
import { dateShortVN, timeStringVN } from '../../utils/dateVN'
import { priceLineFor } from '../../utils/billLines'
import { useDiscountEditing } from '../../hooks/useDiscountEditing'
import { usePrintArmed } from '../../hooks/usePrintArmed'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useProducts } from '../../contexts/ProductContext'
import DiscountEditor from '../POSPage/DiscountEditor'
import PrintBill from '../common/PrintBill'

// Nút icon tròn trên thẻ đơn (in, xoá) — cùng một khuôn, tách ra để đổi kiểu
// một lần. Cùng kích thước với hàng nút trong TableDetailModal.
const ICON_BTN = 'shrink-0 w-[26px] h-[26px] rounded-full border bg-surface-light border-border/60 flex items-center justify-center transition-colors'

// Pill nhỏ dùng cho giờ/mã đơn/tên bàn/tên nhân viên trên thẻ đơn — cùng khuôn
// nền/viền/bo tròn, ghép thêm modifier riêng (uppercase, tabular-nums, truncate...) tại
// chỗ dùng. PILL_LG = pill hàng footer, to hơn 1 chút so với pill header (đã yêu cầu).
const PILL = 'shrink-0 bg-surface-light border border-border/60 rounded-full px-2 py-0.5 text-[11px] font-bold text-text-secondary'
const PILL_LG = 'shrink-0 bg-surface-light border border-border/60 rounded-full px-2.5 py-1 text-[11px] font-bold text-text-secondary'

export default function OrdersList({
    orders, runningTotals, isLoading, isTodayScope,
    pendingOrders, isSyncing, onRetrySync, onDeleteOffline,
    onDeleteOrder, onUpdateDiscount, deletingId, setDeletingId,
    justArrivedIds, dineIn,
}) {
    return (
        <main className="flex-1 overflow-y-auto px-4 py-5 pb-4 space-y-3 bg-bg">
            {pendingOrders.length > 0 && (
                <div className="bg-warning/10 border border-warning/40 rounded-[14px] px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0">
                        <span className="text-[13px] font-black text-warning">{pendingOrders.length} đơn chờ đồng bộ</span>
                        <span className="text-[11px] text-text-dim mt-0.5">Đơn offline chưa lên hệ thống</span>
                    </div>
                    <button
                        onClick={onRetrySync}
                        disabled={isSyncing}
                        className="shrink-0 bg-warning text-bg text-[12px] font-black px-3 py-1.5 rounded-lg disabled:opacity-60"
                    >
                        {isSyncing ? 'Đang sync...' : 'Thử lại'}
                    </button>
                </div>
            )}

            {isLoading ? (
                /* Skeleton giữ chỗ theo hình dáng OrderCard — cùng pattern ExpensePanel/DailyReport */
                <div className="flex flex-col gap-3 animate-pulse">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="bg-surface-light rounded-[20px] h-32 w-full" />
                    ))}
                </div>
            ) : orders.length === 0 ? (
                <div className="flex justify-center py-10">
                    <span className="text-text-secondary font-medium">{isTodayScope ? 'Chưa có đơn hàng nào hôm nay.' : 'Không có đơn hàng trong khoảng này.'}</span>
                </div>
            ) : (
                orders.map(order => (
                    <OrderCard
                        key={order.id}
                        order={order}
                        runningTotal={runningTotals.get(order.id) || 0}
                        isDeleting={deletingId === order.id}
                        setDeletingId={setDeletingId}
                        onDeleteOrder={onDeleteOrder}
                        onUpdateDiscount={onUpdateDiscount}
                        onDeleteOffline={onDeleteOffline}
                        isNew={justArrivedIds?.has(order.id) || false}
                        dineIn={dineIn}
                    />
                ))
            )}
        </main>
    )
}

// memo + per-card isDeleting (not the raw shared deletingId, which would change
// for every card whenever ANY order starts/stops deleting) — otherwise deleting
// one order re-renders the entire day's order list.
const OrderCard = memo(function OrderCard({ order, runningTotal, isDeleting, setDeletingId, onDeleteOrder, onUpdateDiscount, onDeleteOffline, isNew, dineIn }) {
    const navigate = useNavigate()
    const confirm = useConfirm()
    const { products, productExtras } = useProducts()
    // Cùng pattern CartListModal (giỏ hàng chưa gửi), áp cho đơn ĐÃ CHỐT.
    const { editingId: editingItemId, preview, setPreview, toggleEditing } = useDiscountEditing()
    const date = new Date(order.createdAt)
    const time = timeStringVN(date)

    const discountAmount = order.discountAmount || 0
    const subtotal = order.total + discountAmount   // pre-discount price (cho tổng gạch ngang + bill in)
    const { pct: discountPct } = discountToPercent(subtotal, discountAmount)
    // Online, non-deleted orders are the only ones we can edit/discount against the DB.
    const editable = !order.deletedAt && !order.isOffline

    // Mang đi (!dineIn) mỗi đơn đúng 1 món (POSContext chốt ngay khi chạm) nên dòng "Tổng
    // cộng" chỉ lặp lại giá món ngay trên — ẩn cho gọn. Vẫn hiện nếu đơn có >1 món dù địa
    // chỉ đang tắt Bàn ngồi: đơn cũ từ hồi còn bật Bàn ngồi (toggle không đụng dữ liệu đã
    // ghi, xem BranchGrid) vẫn cần tổng.
    const showOrderTotal = dineIn || (order.items?.length || 0) > 1

    // In bill: mọi đơn (mang đi lẫn đơn bàn) đều in được riêng lẻ từ Nhật ký — đơn bàn
    // còn đang mở thì in gộp cả bàn qua TableDetailModal, còn đơn đã lên Nhật ký thì in
    // đúng 1 lượt gọi món đó. Chỉ khi địa chỉ có bật "Bàn ngồi" (dine_in) — tắt thì chưa
    // có hạ tầng in bill cho quán đó.
    const canPrint = dineIn && !order.deletedAt
    const { billRef, printArmed, arm } = usePrintArmed()

    // Đơn giá bán từng dòng — order_items không lưu giá, tính lại từ giá món/topping
    // ĐANG hiệu lực trong menu (giống bill in) — dùng chung cho hiển thị lẫn sửa giảm
    // giá theo dòng ở dưới.
    function lineSubtotal(item) {
        return priceLineFor(item, products, productExtras).unitPrice * item.quantity
    }

    // Giá + trạng thái giảm giá hiển thị của 1 dòng — dùng chung cho danh sách món (đơn
    // nhiều món/dine-in) VÀ header rút gọn (đơn 1 món mang đi, xem showOrderTotal/firstItem
    // bên dưới) để không tính lặp 2 lần cùng một dòng.
    function deriveItem(item) {
        const { name: itemName, extras: itemExtras, unitPrice } = priceLineFor(item, products, productExtras)
        const itemSubtotal = unitPrice * item.quantity
        const committedAmount = item.discountAmount || 0
        const { pct: itemPct, exact: itemPctExact } = discountToPercent(itemSubtotal, committedAmount)
        const seedDiscount = !committedAmount
            ? NO_DISCOUNT
            : itemPctExact ? { type: 'percent', value: itemPct } : { type: 'amount', value: committedAmount }
        const editing = editable && editingItemId === item.id
        const displayDiscount = editing && preview ? preview : seedDiscount
        const { discountAmount: liveDiscount, finalTotal: liveFinal } = computeDiscount(itemSubtotal, displayDiscount)
        return { itemName, itemExtras, itemSubtotal, seedDiscount, editing, displayDiscount, liveDiscount, liveFinal }
    }

    // Mang đi 1 món (!showOrderTotal): giá + nút giảm giá của món đó lên thẳng header thay
    // vì mã đơn (#orderNo vô nghĩa với khách mang đi) — tránh lặp lại giá ở danh sách món
    // bên dưới (xem showOrderTotal chi phối cả hai chỗ này).
    const firstItem = order.items?.[0]
    const firstItemInfo = !showOrderTotal && firstItem ? deriveItem(firstItem) : null

    const billLines = useMemo(() => {
        if (!canPrint) return []
        return (order.items || []).map(it => ({
            key: it.id ?? it.text, qty: it.quantity, discountAmount: it.discountAmount || 0,
            ...priceLineFor(it, products, productExtras),
        }))
    }, [canPrint, order.items, products, productExtras])

    const deletedTimeStr = order.deletedAt ? (() => {
        const d = new Date(order.deletedAt)
        return `${timeStringVN(d)} ${dateShortVN(d)}`
    })() : ''

    async function handleDelete() {
        if (isDeleting) return
        const text = order.items?.map(i => i.text).join(', ') || ''
        if (await confirm({ title: `Xóa đơn ${text} (${formatVND(order.total)})?`, detail: 'Hành động này không thể hoàn tác!', danger: true, confirmLabel: 'Xóa' })) {
            setDeletingId(order.id)
            onDeleteOrder(order.id).finally(() => setDeletingId(null))
        }
    }

    // Giảm giá riêng dòng `item` — ghi lại dòng đó VÀ tổng đơn (cộng dồn tất cả dòng)
    // trong một lệnh (xem update_order_discount RPC) để không lệch giữa chừng.
    function handleItemDiscount(item, d) {
        const itemDiscount = computeDiscount(lineSubtotal(item), d).discountAmount
        const nextItems = (order.items || []).map(it => it.id === item.id ? { ...it, discountAmount: itemDiscount } : it)
        const grossTotal = nextItems.reduce((sum, it) => sum + lineSubtotal(it), 0)
        const nextDiscountTotal = nextItems.reduce((sum, it) => sum + (it.discountAmount || 0), 0)
        onUpdateDiscount(order.id, grossTotal - nextDiscountTotal, nextDiscountTotal, [{ id: item.id, discount_amount: itemDiscount }])
        toggleEditing(item.id)
    }

    return (
        <div className={`bg-surface border rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-shadow duration-[1500ms] ${isNew ? 'border-primary shadow-[0_0_16px_rgba(255,107,53,0.45)]' : 'border-border/60'}`}>
            {/* Đơn vừa nhận realtime từ máy khác — glow cam vài giây rồi tự tắt (justArrivedIds ở POSContext) để nhân viên quầy nhận ra ngay, không phải nhìn chằm chằm danh sách */}
            {order.deletedAt && (
                <div className="absolute top-0 left-0 bg-danger/10 text-danger text-[10px] font-bold px-3 py-1.5 rounded-br-[14px] border-r border-b border-danger/10 flex items-center gap-1.5 uppercase tracking-wider z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    <span>Đã xóa{order.deletedBy ? ` bởi ${order.deletedBy}` : ''} · {deletedTimeStr}</span>
                </div>
            )}
            {order.isOffline && !order.deletedAt && (
                <div className="absolute top-0 right-0 bg-warning/20 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                    Offline
                </div>
            )}

            <div className={`flex flex-col gap-2 ${order.deletedAt ? 'opacity-40 grayscale select-none' : ''}`}>
                {/* Đơn bàn: giờ + tên bàn/mang đi bên trái, luỹ kế bên phải — tổng riêng của
                    ĐỢT này thử bỏ (đã có trong hoá đơn in, và đọc được từ danh sách món ngay
                    dưới), xem còn thiếu không trước khi quyết giữ hay bỏ hẳn. Mã đơn (#id) dồn
                    xuống hàng footer chung với tên nhân viên — chỉ để tra cứu/đối chiếu. */}
                {showOrderTotal ? (
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className={`${PILL} tabular-nums`}>{time}</span>
                                {order.tableName ? (
                                    // Bàn còn đang mở (openTables) thì bấm nhảy thẳng tới modal chi tiết của
                                    // bàn đó ở /pos — bàn đã tính tiền/đóng thì chỉ mở lưới chọn bàn (TableModal
                                    // tự bỏ qua "detail" không khớp openTables, không lỗi).
                                    <button
                                        type="button"
                                        onClick={() => navigate('/pos', { state: { openTableDetail: order.tableName } })}
                                        className={`${PILL} uppercase tracking-wide hover:text-primary hover:border-primary/40 transition-colors`}
                                    >
                                        {order.tableName}
                                    </button>
                                ) : (
                                    <span className={`${PILL} uppercase tracking-wide`}>Mang đi</span>
                                )}
                            </div>
                            {!order.deletedAt && (
                                <span className="shrink-0 text-success leading-none text-[14px] font-bold tabular-nums">
                                    {formatVND(runningTotal)}
                                </span>
                            )}
                        </div>
                        <div className="border-t border-border/40 my-1.5" />
                    </div>
                ) : (
                    <div className="flex justify-between items-start mb-1 gap-2">
                        {firstItemInfo && (
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className="shrink-0 font-black text-[14px] text-primary">+ {formatVND(firstItemInfo.liveFinal)}</span>
                                {firstItemInfo.liveDiscount > 0 && (
                                    <span className="shrink-0 text-text-secondary/60 text-[12px] font-bold line-through tabular-nums">{formatVND(firstItemInfo.itemSubtotal)}</span>
                                )}
                                {editable && firstItem.id && (
                                    <button
                                        onClick={() => toggleEditing(firstItem.id)}
                                        aria-label={`Giảm giá ${firstItem.text}`}
                                        className={`shrink-0 h-[22px] min-w-[22px] px-2 rounded-full border flex items-center justify-center transition-colors ${firstItemInfo.liveDiscount > 0 ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/60 text-text-secondary hover:text-text'}`}
                                    >
                                        {firstItemInfo.liveDiscount > 0
                                            ? <span className="text-[11px] font-black tabular-nums">-{firstItemInfo.displayDiscount.type === 'percent' ? `${firstItemInfo.displayDiscount.value}%` : formatVND(firstItemInfo.displayDiscount.value)}</span>
                                            : <Percent size={12} strokeWidth={2.5} />}
                                    </button>
                                )}
                            </div>
                        )}
                        {!order.deletedAt && (
                            <span className="shrink-0 text-success leading-none text-[14px] font-bold tabular-nums">
                                {formatVND(runningTotal)}
                            </span>
                        )}
                    </div>
                )}
                {firstItemInfo?.editing && (
                    <div className="pb-1">
                        <DiscountEditor
                            discount={firstItemInfo.seedDiscount}
                            onPreview={setPreview}
                            secondaryLabel="Hủy"
                            onSecondary={() => toggleEditing(firstItem.id)}
                            onApply={(d) => handleItemDiscount(firstItem, d)}
                        />
                    </div>
                )}
                <div className="pl-2 flex flex-col gap-1.5">
                    {order.items?.length > 0 ? order.items.map((item, idx) => {
                            // Đơn 1 món mang đi (!showOrderTotal) đã hiện giá + nút giảm giá ở
                            // header (firstItemInfo) — ở đây chỉ còn tên + extras, khỏi lặp lại.
                            const { itemName, itemExtras, itemSubtotal, seedDiscount, editing, displayDiscount, liveDiscount, liveFinal } = deriveItem(item)

                            return (
                                <div key={item.id ?? idx} className="flex flex-col gap-1.5 w-full">
                                    <div className="flex items-start gap-2 w-full">
                                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                            <span className={`text-[14px] leading-snug font-medium whitespace-pre-wrap text-text ${order.deletedAt ? 'line-through' : ''}`}>{item.quantity} {itemName}</span>
                                            {itemExtras.map(e => (
                                                <span key={e.id} className={`pl-2.5 text-[12px] leading-snug text-text-secondary/70 ${order.deletedAt ? 'line-through' : ''}`}>• {e.name}</span>
                                            ))}
                                        </div>
                                        {showOrderTotal && (
                                            <>
                                                <span className="shrink-0 flex items-center gap-1.5">
                                                    {liveDiscount > 0 && (
                                                        <span className="text-[10px] font-bold text-text-secondary/60 line-through tabular-nums">{formatVND(itemSubtotal)}</span>
                                                    )}
                                                    <span className="text-[12px] font-bold tabular-nums text-text"> {formatVND(liveFinal)}</span>
                                                </span>
                                                {editable && item.id && (
                                                    <button
                                                        onClick={() => toggleEditing(item.id)}
                                                        aria-label={`Giảm giá ${item.text}`}
                                                        className={`shrink-0 h-[22px] min-w-[22px] px-2 rounded-full border flex items-center justify-center transition-colors ${liveDiscount > 0 ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/60 text-text-secondary hover:text-text'}`}
                                                    >
                                                        {liveDiscount > 0
                                                            ? <span className="text-[11px] font-black tabular-nums">-{displayDiscount.type === 'percent' ? `${displayDiscount.value}%` : formatVND(displayDiscount.value)}</span>
                                                            : <Percent size={12} strokeWidth={2.5} />}
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    {showOrderTotal && editing && (
                                        <div className="pb-2 space-y-3">
                                            <DiscountEditor
                                                discount={seedDiscount}
                                                onPreview={setPreview}
                                                secondaryLabel="Hủy"
                                                onSecondary={() => toggleEditing(item.id)}
                                                onApply={(d) => handleItemDiscount(item, d)}
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        }) : (
                            <span className="text-text text-[14px] leading-snug font-medium whitespace-pre-wrap">Không có chi tiết</span>
                        )}
                </div>

                <div className="border-t border-border/40 pt-2 flex justify-between items-center gap-3 leading-none">
                    {/* showOrderTotal: giờ đã lên đầu thẻ (header), mã đơn dồn xuống đây chung
                        với người tạo — cả hai đều là thông tin tra cứu, không cần nổi bật riêng
                        một hàng ở trên. Cùng kiểu pill (border+background) với giờ/tên bàn ở
                        header để đồng bộ, không lẫn với text thường của các đơn không phải bàn. */}
                    {showOrderTotal ? (
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            {order.orderNo != null && (
                                <span className={`${PILL_LG} tabular-nums`}>#{order.orderNo}</span>
                            )}
                            {order.staffName && (
                                <span className={`${PILL_LG} truncate`}>{order.staffName}</span>
                            )}
                        </div>
                    ) : (
                        <span className="text-text-secondary/70 text-[12px] font-bold truncate min-w-0 leading-none">
                            {time}{order.staffName ? ` · ${order.staffName}` : ''}
                        </span>
                    )}
                    <div className="shrink-0 flex items-center gap-2">
                        {canPrint && (
                            <button
                                onClick={arm}
                                aria-label="In bill"
                                className={`${ICON_BTN} text-text-secondary hover:text-primary`}
                            >
                                <Printer size={14} strokeWidth={2.25} />
                            </button>
                        )}
                        {/* Đơn offline chưa lên DB thì xoá bằng đường khác (hàng chờ), còn lại
                            y hệt nhau — một nút, hai nguồn dữ liệu. */}
                        {!order.deletedAt && (
                            <button
                                onClick={order.isOffline ? () => onDeleteOffline(order.createdAt_key) : handleDelete}
                                disabled={!order.isOffline && isDeleting}
                                aria-label={order.isOffline ? 'Xóa đơn offline' : 'Xóa đơn'}
                                className={`${ICON_BTN} ${order.isOffline ? 'text-warning/70' : 'text-text-secondary'} hover:text-danger disabled:opacity-50`}
                            >
                                <Trash2 size={14} strokeWidth={2.25} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Chỉ mount khi đang in (printArmed) — nếu mount thường trực ở MỌI thẻ mang
                đi thì nhiều thẻ cùng có id="print-bill" một lúc, CSS @media print (index.css)
                chọn theo id sẽ hiện chồng hết lên nhau. */}
            {printArmed && (
                <PrintBill
                    ref={billRef}
                    orderNo={order.orderNo}
                    tableName={order.tableName}
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
})
