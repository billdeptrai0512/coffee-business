import { useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { ArrowLeft, Trash2, Check, Printer, ArrowRightLeft, Loader } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useProducts } from '../../contexts/ProductContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useAddress } from '../../contexts/AddressContext'
import { useMoveTarget } from '../../hooks/useMoveTarget'
import { formatVND, discountToPercent } from '../../utils'
import { printBillNative } from '../../lib/escposBitmap'
import { bumpOrderPrintCount } from '../../services/orderService'
import { timeStringVN, openedLabelVN, dateShortVN, isSameDayVN } from '../../utils/dateVN'
import { priceLineFor } from '../../utils/billLines'
import { Dialog, MODAL_PANEL, CHIP, CHIP_IDLE, TIME_PILL } from '../common/ModalShell'
import PrintBill from '../common/PrintBill'
import TableTargetPicker from './TableTargetPicker'

// Chi tiết một bàn — mở từ thẻ bàn trong lưới (TableModal).
//
// Thẻ bàn chỉ đủ chỗ cho tờ hoá đơn đã gộp; ở đây tách lại theo ĐỢT vì mọi thao tác
// đều nhắm vào một đợt cụ thể ("cái đợt 10g15 gọi nhầm", "đợt vừa rồi ra món chưa"),
// không nhắm vào dòng món đã gộp. Tính tiền cũng nằm ở đây chứ không ở thẻ: bấm tính
// tiền mà chưa đọc lại đợt nào của bàn là cách thu sai tiền dễ nhất.
//
// ponytail: in qua window.print() (xem PrintBill.jsx + @media print trong index.css),
// không SDK máy in nhiệt. Đổi khi quán có máy ESC/POS thật.

export default function TableDetailModal({ table, tableNames = [], onClose, onPick }) {
    const confirm = useConfirm()
    const { handleCloseTable, refreshTables, reopenRoundIntoCart, toggleServed, orderCount, showError } = useCart()
    const { handleDeleteOrder } = useHistory()
    const { products, productExtras } = useProducts()
    const { selectedAddress } = useAddress()
    const billRef = useRef(null)
    // Gộp bàn (chuyển hết đợt) và tách bàn (chuyển một đợt) dùng chung một màn hình
    // chọn bàn đích (TableTargetPicker) — orderIds là thứ duy nhất khác nhau giữa hai thao
    // tác. moving=null là màn bình thường; có giá trị là màn "chọn bàn đích" thay chỗ danh
    // sách đợt.
    // orderIds rỗng (mọi đợt đều offline chưa có id) thì không có gì để chuyển — cả hai nút
    // gọi startMove bên dưới (Gộp bàn, Chuyển đợt) đã tự ẩn ở nơi gọi trong trường hợp đó.
    const { moving, startMove, cancelMove } = useMoveTarget()
    // In native (html2canvas + gửi mạng) mất vài giây thật, không tức thì như
    // window.print() — thiếu cờ này thì bấm 2 lần liên tiếp trong lúc đang xử lý sẽ in/
    // tính tiền 2 lần, và người dùng không biết bấm có ăn hay chưa.
    const [billing, setBilling] = useState(false)

    const openedLabel = openedLabelVN
    const linesLabel = (lines) => lines.map(l => `${l.qty} ${l.name}`).join(', ')

    // Bill in: nhân viên hiện theo đợt gần nhất (người đang đứng thu tiền), không lặp lại
    // theo từng đợt vì bill in theo cả bàn. orderNo thường là 1 SỐ DUY NHẤT CHO CẢ BÀN —
    // mọi đợt của cùng 1 lần mở bàn dùng chung 1 số (gán ở đợt đầu, "gọi thêm" không sinh
    // số mới, xem bulk_create_orders trong migration 20260814_order_sequential_number).
    // find() lấy số đầu tiên tìm thấy nên cũng là lựa chọn hợp lý khi bàn vừa được GỘP từ
    // nơi khác (mỗi đợt gộp vào giữ nguyên số cũ, xem moveTableRounds — bill khi đó có thể
    // lẫn nhiều số, chấp nhận được vì số đã in/đọc cho khách trước lúc gộp).
    const lastStaff = table.rounds.at(-1)?.staffName || null
    // Đợt mang order_no cũng là đợt đại diện để đếm "In lần" — cả bàn chỉ có 1 tờ bill,
    // dồn số lần in vào đúng 1 dòng orders thay vì rải/không nhất quán qua nhiều đợt
    // (xem 20260908_order_print_count.sql).
    const printCountRound = table.rounds.find(r => r.orderNo != null)
    const orderNo = printCountRound?.orderNo ?? null
    const discountTotal = table.rounds.reduce((s, r) => s + (r.discountAmount || 0), 0)
    const subtotal = table.total + discountTotal
    const { pct: discountPct } = discountToPercent(subtotal, discountTotal)

    // Đơn giá/thành tiền từng dòng cho bill in: round.lines chỉ có tên+SL (giá không
    // lưu theo dòng, xem TableRound ở orderService.ts), nên tự tính lại từ giá món/topping
    // ĐANG hiệu lực trong menu (products/productExtras) — đúng cho bàn đang mở vì đơn vừa
    // gọi trong ca này, giá chưa kịp đổi. Gộp qua TẤT CẢ đợt (không tách theo round nữa,
    // bill không còn hiện nhãn "Đợt N"), nên 1 món gọi ở hai đợt khác nhau chỉ ra một dòng.
    // extras giữ riêng mảng (không nhét vào chuỗi tên như tableLineName) — bill in mỗi
    // topping xuống một dòng "* tên" riêng, gộp trùng phải tính theo tổ hợp món+topping.
    function priceLines(rounds) {
        const out = []
        for (const round of rounds) {
            for (const it of round.items) {
                const { name, extras, unitPrice } = priceLineFor(it, products, productExtras)
                const discountAmount = it.discountAmount || 0
                const baseKey = `${name}::${extras.map(e => e.id).sort().join(',')}`
                // Dòng có giảm giá riêng KHÔNG gộp qua các đợt khác — gộp sẽ chia trung bình
                // discount qua nhiều ly khác giá nhau (vd 1 ly full giá + 1 ly miễn phí gộp
                // thành 2 ly "nửa giá" trên bill, sai với thực tế). Chỉ món KHÔNG giảm giá
                // mới gộp theo tên+topping như cũ.
                const hit = discountAmount === 0 ? out.find(l => l.key === baseKey) : null
                if (hit) { hit.qty += it.qty; continue }
                out.push({
                    key: discountAmount === 0 ? baseKey : `${baseKey}::${round.id}::${out.length}`,
                    name, extras, qty: it.qty, unitPrice, discountAmount,
                })
            }
        }
        return out
    }

    async function handleEditRound(round) {
        // Cả chuỗi xoá-nạp-giỏ nằm trong POSContext (reopenRoundIntoCart) — ở đây chỉ
        // còn việc đóng modal và chọn bàn khi nó báo xong.
        if (await reopenRoundIntoCart(round)) onPick()
    }

    async function handleDeleteRound(round) {
        const ok = await confirm({
            title: `Xóa đợt ${openedLabel(round.createdAt)}?`,
            detail: `${linesLabel(round.lines)} — ${formatVND(round.total)}. Hành động này không thể hoàn tác!`,
            danger: true,
            confirmLabel: 'Xóa',
        })
        if (!ok) return
        // handleDeleteOrder tự đồng bộ lại lưới bàn; bàn hết đợt thì TableModal gỡ modal
        // này xuống, không cần tự đóng ở đây.
        await handleDeleteOrder(round.id)
    }

    // App native (Capacitor) + đã cấu hình IP máy in quầy: in bitmap thẳng qua mạng,
    // không dialog (xem setPrinters ở AddressContext, escposBitmap.js). Web hoặc chưa
    // cấu hình: mở hộp in của trình duyệt/hệ điều hành như cũ, CSS @media print
    // (index.css) lo phần chỉ hiện #print-bill — bill dựng sẵn trong DOM (PrintBill)
    // nên không có bước render lại nào giữa cú bấm và lệnh in.
    async function handlePrint() {
        if (Capacitor.isNativePlatform() && selectedAddress?.counter_printer_ip) {
            try {
                await printBillNative(billRef, selectedAddress.counter_printer_ip)
            } catch (e) {
                // Trước đây chỉ console.error — người bấm Tính tiền không thấy gì cả khi
                // máy in mất kết nối (IP đổi, mất mạng...), tưởng app đứng im. Bàn vẫn
                // đóng bình thường bên dưới (tiền đã tính, in chỉ là giấy tiện cho khách)
                // nhưng phải báo rõ để nhân viên biết mà in lại tay.
                showError(e, 'In hoá đơn')
            }
            return
        }
        await new Promise((resolve) => {
            // Safety valve: WebView native (Capacitor, chưa cấu hình IP máy in) không đảm bảo
            // bắn 'afterprint' sau window.print() — thiếu timeout thì Tính tiền treo vĩnh viễn,
            // bàn không bao giờ đóng. Cùng pattern loadingValve ở AddressStatsContext.jsx.
            // resolve() gọi 2 lần vô hại (Promise chỉ ăn lần đầu); { once } tự gỡ listener.
            window.addEventListener('afterprint', resolve, { once: true })
            setTimeout(resolve, 5000)
            billRef.current?.print()
        })
    }

    // Nút "In bill" ở header — KHÁC handleBill (Tính tiền, đã có billing chặn bấm đúp): trước
    // đây không có cờ nào chặn bấm lại trong lúc in native (vài giây thật qua mạng, không có
    // phản hồi tức thì nào cho người dùng thấy) — bấm 2 lần liên tiếp gọi captureImage() chồng
    // lên nhau, cùng mutate style/className của #print-bill, làm ảnh chụp lỡ dở/lỗi mà không
    // ném ra lỗi gì để bắt (xem captureChainRef ở PrintBill.jsx — đã chuỗi hoá phần đó làm
    // lưới an toàn cuối, nhưng chặn từ đây vẫn tốt hơn: khỏi phải xếp hàng chờ). Dùng lại đúng
    // cờ billing (không cần state riêng) — khoá luôn cả "Tính tiền" trong lúc đang in tay là
    // hợp lý, không nên đóng bàn giữa lúc in dở.
    async function handleHeaderPrint() {
        if (billing) return
        setBilling(true)
        try {
            await handlePrint()
        } finally {
            setBilling(false)
        }
    }

    async function handleBill() {
        if (billing) return
        setBilling(true)
        try {
            // Máy khác có thể vừa gửi thêm một đợt sau lần fetch gần nhất. Nhân viên thu
            // tiền theo đúng con số trong hộp này nên lấy lại số mới nhất ngay trước khi hỏi.
            const fresh = (await refreshTables()).find(x => x.name === table.name) || table
            const pending = fresh.rounds.filter(r => !r.servedAt).length
            // Chỉ hỏi xác nhận khi còn đợt chưa ra món — đây là trường hợp DUY NHẤT còn kịp
            // cảnh báo trước khi bàn (và đợt chưa ra món) biến mất khỏi lưới. Đã ra hết món
            // rồi thì hỏi thêm chỉ là 1 tap thừa, tính tiền + in thẳng luôn.
            if (pending > 0) {
                const ok = await confirm({
                    title: `Tính tiền ${fresh.name}?`,
                    detail: `${linesLabel(fresh.lines)} — ${formatVND(fresh.total)} · ${fresh.rounds.length} đợt từ ${openedLabel(fresh.openedAt)}\n⚠ Còn ${pending} đợt chưa ra món.`,
                    confirmLabel: 'Tính tiền',
                })
                if (!ok) return
            }
            // In TRƯỚC khi đóng bàn: TableModal render TableDetailModal theo detailTable
            // (tính lại từ openTables mỗi render, xem comment ở TableModal) — đóng bàn xong
            // là table biến mất khỏi openTables, modal (và #print-bill bên trong) bị THÁO
            // MOUNT ngay từ component cha, bất kể có gọi onClose() hay chưa. Đóng bàn trước
            // rồi mới in gần như chắc chắn in ra giấy trắng (đường window.print()) — handlePrint
            // tự đợi đúng việc cần đợi cho từng đường in (afterprint hoặc network gửi xong).
            await handlePrint()
            await handleCloseTable(fresh)
            onClose()
        } finally {
            setBilling(false)
        }
    }

    const otherTables = tableNames.filter(n => n !== table.name)
    // Đợt offline chưa có id thì không chuyển được (cùng lý do ẩn hàng nút Sửa/Xoá bên
    // dưới) — "Gộp bàn" ở header chỉ chuyển những đợt đã có id.
    const movableRoundIds = table.rounds.filter(r => r.id).map(r => r.id)

    if (moving) {
        return (
            <TableTargetPicker
                orderIds={moving.orderIds}
                label={moving.label}
                tableNames={otherTables}
                showTakeawayOption
                onBack={cancelMove}
                onClose={onClose}
            />
        )
    }

    return (
        <Dialog onClose={onClose} panelClassName={MODAL_PANEL}>
            <div className="shrink-0 flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border/40">
                {/* Mũi tên chứ không phải dấu X: đóng cái này là quay về lưới bàn, không
                    phải thoát ra POS. */}
                <button onClick={onClose} aria-label="Về lưới bàn" className="shrink-0 p-1.5 -ml-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                    <ArrowLeft size={18} />
                </button>
                <p className="min-w-0 flex-1 text-text font-black text-base leading-none uppercase tracking-wide truncate">{table.name}</p>
                {/* Gộp CẢ bàn sang bàn khác — tách một đợt riêng lẻ thì dùng "Chuyển bàn"
                    ở từng đợt bên dưới, cùng một màn chọn bàn đích (startMove). */}
                {movableRoundIds.length > 0 && (
                    <button
                        onClick={() => startMove(movableRoundIds, `cả ${table.name}`)}
                        aria-label="Gộp bàn"
                        className="shrink-0 w-[26px] h-[26px] rounded-full border bg-surface-light border-border/60 flex items-center justify-center text-text-secondary hover:text-primary transition-colors"
                    >
                        <ArrowRightLeft size={14} strokeWidth={2.25} />
                    </button>
                )}
                <button
                    onClick={handleHeaderPrint}
                    disabled={billing}
                    aria-label="In bill"
                    className="shrink-0 w-[26px] h-[26px] rounded-full border bg-surface-light border-border/60 flex items-center justify-center text-text-secondary hover:text-primary transition-colors disabled:opacity-60 disabled:pointer-events-none"
                >
                    <Printer size={14} strokeWidth={2.25} />
                </button>
                <span className="shrink-0 text-[17px] font-black tabular-nums text-primary">{formatVND(table.total)}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {table.rounds.map((round, i) => (
                    <div key={round.id || i} className="rounded-[16px] border border-border/40 bg-surface-light/40 px-4 py-3">
                        <div className="flex items-center justify-between gap-3 pb-2">
                            <div className="flex items-center gap-1.5">
                                {!isSameDayVN(new Date(round.createdAt), new Date()) && <span className={TIME_PILL}>{dateShortVN(new Date(round.createdAt))}</span>}
                                <span className={TIME_PILL}>{timeStringVN(new Date(round.createdAt))}</span>
                                {/* Tách đợt này sang bàn khác — cùng màn chọn bàn đích với nút
                                    "Gộp bàn" ở header, chỉ khác orderIds chỉ có mỗi đợt này. */}
                                {round.id && (
                                    <button
                                        onClick={() => startMove([round.id], `đợt ${openedLabel(round.createdAt)}`)}
                                        aria-label={`Chuyển đợt ${openedLabel(round.createdAt)} sang bàn khác`}
                                        className={`${CHIP_IDLE} shrink-0 w-[26px] flex items-center justify-center hover:text-text hover:border-primary/40`}
                                    >
                                        <ArrowRightLeft size={12} strokeWidth={2.25} />
                                    </button>
                                )}
                            </div>
                            <span className="text-[13px] font-black tabular-nums text-text">{formatVND(round.total)}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 border-t border-border/40 pt-2 pb-2 pl-2">
                            {round.lines.map(l => (
                                <span key={l.name} className="text-[13px] font-bold text-text leading-snug">
                                    {l.qty > 1 && <span className="tabular-nums text-text-secondary">{l.qty} </span>}{l.name}
                                </span>
                            ))}
                        </div>
                        {/* Đợt offline chưa có id trong DB → chưa sửa/xoá/đánh dấu được,
                            ẩn cả hàng nút thay vì để nút bấm vào không có gì xảy ra. */}
                        {round.id && (
                            <div className="flex items-center gap-2 border-t border-border/40 pt-2">
                                <button
                                    onClick={() => handleEditRound(round)}
                                    className={`${CHIP_IDLE} px-2.5 hover:text-text hover:border-primary/40`}
                                >
                                    Sửa
                                </button>
                                <button
                                    onClick={() => handleDeleteRound(round)}
                                    aria-label={`Xóa đợt ${openedLabel(round.createdAt)}`}
                                    className={`${CHIP_IDLE} shrink-0 w-[26px] flex items-center justify-center hover:text-danger`}
                                >
                                    <Trash2 size={14} strokeWidth={2.25} />
                                </button>
                                <button
                                    onClick={() => toggleServed(round)}
                                    className={`flex items-center gap-1.5 px-2.5 ml-auto ${round.servedAt
                                        ? `${CHIP} bg-success/10 border-success/40 text-success`
                                        : `${CHIP_IDLE} hover:text-text hover:border-primary/40`}`}
                                >
                                    {round.servedAt && <Check size={12} strokeWidth={3} />}
                                    {round.servedAt ? `Đã ra món ${timeStringVN(new Date(round.servedAt))}` : 'Chưa ra món'}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-border/40">
                <button
                    onClick={onPick}
                    className="flex-1 py-2.5 rounded-[12px] bg-surface-light border border-border/60 text-[12px] font-black uppercase tracking-wider text-text hover:border-primary/40 transition-colors"
                >
                    {orderCount > 0 ? `Gọi thêm ${orderCount} ly` : 'Gọi thêm'}
                </button>
                <button
                    onClick={handleBill}
                    disabled={billing}
                    className="flex-1 py-2.5 rounded-[12px] bg-primary text-bg text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-1.5"
                >
                    {billing ? <Loader size={14} className="animate-spin" /> : 'Tính tiền'}
                </button>
            </div>

            {/* Không còn hiện nhãn "Đợt N" trong bảng món — priceLines gộp món trùng tên
                qua mọi đợt thành 1 dòng, xem comment ở priceLines. */}
            <PrintBill
                ref={billRef}
                orderNo={orderNo}
                tableName={table.name}
                openedAt={table.openedAt}
                staffName={lastStaff}
                lines={priceLines(table.rounds)}
                subtotal={subtotal}
                discountTotal={discountTotal}
                discountPct={discountPct}
                total={table.total}
                printCount={printCountRound?.printCount ?? 0}
                onPrinted={() => bumpOrderPrintCount(printCountRound?.id ?? null, printCountRound?.printCount ?? 0)}
            />
        </Dialog>
    )
}
